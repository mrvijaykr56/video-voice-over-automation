import os
import asyncio
import logging
import json
import subprocess
import requests
import re
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel
import edge_tts
from gtts import gTTS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-service")

app = FastAPI(title="TTS Generation Service")

VOICE_MAPPING = {
    ("hi", "female"): "hi-IN-SwaraNeural",
    ("hi", "male"): "hi-IN-MadhurNeural",
    ("en", "female"): "en-US-AriaNeural",
    ("en", "male"): "en-US-GuyNeural",
    ("en-in", "female"): "en-IN-NeerjaExpressiveNeural",
    ("en-in", "male"): "en-IN-PrabhatNeural",
}

ELEVENLABS_VOICE_MAPPING = {
    ("hi", "female"): "pFZP5JQG7iQjIQuC4Bku", # Example ID 
    ("hi", "male"): "pNInz6obbfDQGcgMyIGb",
    ("en", "female"): "EXAVITQu4vr4xnSDxMaL",
    ("en", "male"): "VR6AewLTigWG4xSOukaG",
    ("en-in", "female"): "EXAVITQu4vr4xnSDxMaL",
    ("en-in", "male"): "VR6AewLTigWG4xSOukaG"
}

STORAGE_DIR = os.getenv("STORAGE_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "../../storage")))
AUDIO_DIR = os.path.join(STORAGE_DIR, "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

class TTSRequest(BaseModel):
    text: str
    language: str
    voice_gender: str
    job_id: str
    tts_engine: str = "edge-tts"
    elevenlabs_key: str = ""

class TTSResponse(BaseModel):
    status: str
    audio_path: str
    alignment_path: str
    voice_used: str
    method_used: str

def get_audio_duration(file_path: str) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", file_path
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return float(result.stdout.strip())
    except Exception as e:
        logger.error(f"Failed to probe duration for {file_path}: {e}")
        return 5.0

async def generate_gtts_fallback(request: TTSRequest, output_path: str, alignment_path: str, lang: str):
    logger.info("Falling back to gTTS...")
    loop = asyncio.get_event_loop()
    gtts_lang = lang if lang in ["hi", "en"] else "en"
    
    def run_gtts():
        tts = gTTS(text=request.text, lang=gtts_lang)
        tts.save(output_path)
        
    await loop.run_in_executor(None, run_gtts)
    logger.info("gTTS fallback generation succeeded.")
    
    words = request.text.split()
    duration = get_audio_duration(output_path)
    word_duration = duration / max(len(words), 1)
    alignment_data = []
    for i, word in enumerate(words):
        alignment_data.append({
            "word": word,
            "start": i * word_duration,
            "end": (i + 1) * word_duration
        })
        
    with open(alignment_path, "w", encoding="utf-8") as f:
        json.dump(alignment_data, f, indent=2)
        
    return "gTTS", f"gTTS-{gtts_lang}"

async def generate_edge_tts(request: TTSRequest, voice: str, output_path: str, alignment_path: str):
    logger.info(f"Using edge-tts generation for {voice}...")
    communicate = edge_tts.Communicate(request.text, voice, boundary="WordBoundary")
    submaker = edge_tts.SubMaker()
    
    async def stream_and_save():
        with open(output_path, "wb") as f:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    submaker.feed(chunk)
                    
    await asyncio.wait_for(stream_and_save(), timeout=90.0)
    
    alignment_data = []
    for cue in submaker.cues:
        alignment_data.append({
            "word": cue.content,
            "start": cue.start.total_seconds(),
            "end": cue.end.total_seconds()
        })
        
    with open(alignment_path, "w", encoding="utf-8") as f:
        json.dump(alignment_data, f, indent=2)
        
    return "edge-tts", voice

async def generate_edge_dynamic(request: TTSRequest, voice: str, output_path: str, alignment_path: str):
    logger.info("Using edge-dynamic chunking...")
    # Split text by punctuation
    chunks = re.split(r'([.?!])', request.text)
    
    combined_audio = b""
    alignment_data = []
    current_time = 0.0
    
    for i in range(0, len(chunks), 2):
        text_chunk = chunks[i].strip()
        if not text_chunk:
            continue
        punct = chunks[i+1] if i+1 < len(chunks) else "."
        
        rate = "+0%"
        pitch = "+0Hz"
        
        if punct == "!":
            rate = "+10%"
            pitch = "+15Hz"
        elif punct == "?":
            pitch = "+10Hz"
            
        full_chunk = text_chunk + punct
        
        communicate = edge_tts.Communicate(full_chunk, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
        submaker = edge_tts.SubMaker()
        
        chunk_audio = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunk_audio += chunk["data"]
            elif chunk["type"] == "WordBoundary":
                submaker.feed(chunk)
                
        combined_audio += chunk_audio
        
        if submaker.cues:
            chunk_duration = submaker.cues[-1].end.total_seconds()
        else:
            chunk_duration = 0.5
            
        for cue in submaker.cues:
            alignment_data.append({
                "word": cue.content,
                "start": current_time + cue.start.total_seconds(),
                "end": current_time + cue.end.total_seconds()
            })
            
        current_time += chunk_duration
        
    with open(output_path, "wb") as f:
        f.write(combined_audio)
        
    with open(alignment_path, "w", encoding="utf-8") as f:
        json.dump(alignment_data, f, indent=2)
        
    return "edge-dynamic", voice

async def generate_elevenlabs(request: TTSRequest, voice_id: str, output_path: str, alignment_path: str):
    logger.info(f"Using ElevenLabs with voice {voice_id}...")
    api_key = request.elevenlabs_key or os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise Exception("ElevenLabs API Key is missing. Please provide it in the UI or environment.")
        
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
    headers = {
        "Accept": "application/json",
        "xi-api-key": api_key,
        "Content-Type": "application/json"
    }
    data = {
        "text": request.text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }
    
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, lambda: requests.post(url, json=data, headers=headers, timeout=30))
    
    if response.status_code != 200:
        raise Exception(f"ElevenLabs API Error: {response.text}")
        
    resp_data = response.json()
    audio_base64 = resp_data.get("audio_base64")
    alignment = resp_data.get("alignment")
    
    if not audio_base64 or not alignment:
        raise Exception("Invalid response from ElevenLabs with-timestamps endpoint.")
        
    import base64
    audio_bytes = base64.b64decode(audio_base64)
    with open(output_path, "wb") as f:
        f.write(audio_bytes)
        
    # Convert character alignments to word alignments
    alignment_data = []
    chars = alignment["characters"]
    starts = alignment["character_start_times_seconds"]
    ends = alignment["character_end_times_seconds"]
    
    current_word = ""
    word_start = -1
    for i, char in enumerate(chars):
        if char.strip():
            if word_start == -1:
                word_start = starts[i]
            current_word += char
        else:
            if current_word:
                alignment_data.append({
                    "word": current_word,
                    "start": word_start,
                    "end": ends[i-1] if i > 0 else ends[i]
                })
                current_word = ""
                word_start = -1
                
    if current_word:
        alignment_data.append({
            "word": current_word,
            "start": word_start,
            "end": ends[-1]
        })
        
    with open(alignment_path, "w", encoding="utf-8") as f:
        json.dump(alignment_data, f, indent=2)
        
    return "elevenlabs", voice_id


@app.post("/generate_audio", response_model=TTSResponse)
async def generate_audio(request: TTSRequest):
    lang = request.language.lower().strip()
    gender = request.voice_gender.lower().strip()
    
    output_filename = f"{request.job_id}.mp3"
    output_path = os.path.join(AUDIO_DIR, output_filename)
    alignment_filename = f"{request.job_id}_alignment.json"
    alignment_path = os.path.join(AUDIO_DIR, alignment_filename)
    
    try:
        if request.tts_engine == "elevenlabs":
            voice_key = (lang, gender)
            voice_id = ELEVENLABS_VOICE_MAPPING.get(voice_key, ELEVENLABS_VOICE_MAPPING[("en", "male")])
            method, voice = await generate_elevenlabs(request, voice_id, output_path, alignment_path)
            
        elif request.tts_engine == "edge-dynamic":
            voice_key = (lang, gender)
            voice = VOICE_MAPPING.get(voice_key, VOICE_MAPPING[("en", "male")])
            method, voice = await generate_edge_dynamic(request, voice, output_path, alignment_path)
            
        else:
            voice_key = (lang, gender)
            voice = VOICE_MAPPING.get(voice_key, VOICE_MAPPING[("en", "male")])
            method, voice = await generate_edge_tts(request, voice, output_path, alignment_path)
            
    except Exception as e:
        logger.error(f"Primary engine {request.tts_engine} failed: {e}. Attempting fallback...")
        try:
            method, voice = await generate_gtts_fallback(request, output_path, alignment_path, lang)
        except Exception as ge:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"TTS generation failed completely. Primary error: {str(e)}. Fallback error: {str(ge)}"
            )
            
    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Generated audio file is missing or empty."
        )
        
    return TTSResponse(
        status="success",
        audio_path=os.path.abspath(output_path),
        alignment_path=os.path.abspath(alignment_path),
        voice_used=voice,
        method_used=method
    )

@app.get("/health")
def health():
    return {"status": "ok", "service": "tts"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)
