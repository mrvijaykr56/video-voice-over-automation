import os
import uuid
import datetime
import time
import requests
import logging
from typing import Dict, List
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, String, Float, DateTime, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("upload-service")

app = FastAPI(title="Upload & Coordination Service")

# Allow CORS for React frontend (on port 5173 by default)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Resolve storage and database
STORAGE_DIR = os.getenv("STORAGE_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "../../storage")))
os.makedirs(STORAGE_DIR, exist_ok=True)
RAW_VIDEOS_DIR = os.path.join(STORAGE_DIR, "raw_videos")
SCRIPTS_DIR = os.path.join(STORAGE_DIR, "scripts")
BGM_DIR = os.path.join(STORAGE_DIR, "bgm")
os.makedirs(RAW_VIDEOS_DIR, exist_ok=True)
os.makedirs(SCRIPTS_DIR, exist_ok=True)
os.makedirs(BGM_DIR, exist_ok=True)

# Mount static files to serve raw inputs and final outputs
app.mount("/static", StaticFiles(directory=STORAGE_DIR), name="static")

# Database setup
DATABASE_URL = f"sqlite:///{os.path.join(STORAGE_DIR, 'jobs.db')}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Job(Base):
    __tablename__ = "jobs"
    id = Column(String, primary_key=True, index=True)
    status = Column(String, default="PENDING")
    progress = Column(Float, default=0.0)
    language = Column(String)
    voice_gender = Column(String)
    sync_mode = Column(String)
    watermark_text = Column(String, nullable=True)
    caption_style = Column(String, default="active_word")
    font_size = Column(Float, default=24.0)
    job_type = Column(String, default="video_sync")
    bgm_volume = Column(Float, default=0.1)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    error_message = Column(String, nullable=True)
    final_video_url = Column(String, nullable=True)

Base.metadata.create_all(bind=engine)

# Run schema migrations for sqlite safely on startup
try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE jobs ADD COLUMN caption_style TEXT DEFAULT 'active_word'"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE jobs ADD COLUMN font_size REAL DEFAULT 24.0"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE jobs ADD COLUMN job_type TEXT DEFAULT 'video_sync'"))
except Exception:
    pass

try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE jobs ADD COLUMN bgm_volume REAL DEFAULT 0.1"))
except Exception:
    pass

TTS_URL = os.getenv("TTS_URL", "http://127.0.0.1:8001/generate_audio")
SYNC_URL = os.getenv("SYNC_URL", "http://127.0.0.1:8002/sync_audio_video")
RENDER_URL = os.getenv("RENDER_URL", "http://127.0.0.1:8003/render_video")

# WebSocket Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, job_id: str, websocket: WebSocket):
        await websocket.accept()
        if job_id not in self.active_connections:
            self.active_connections[job_id] = []
        self.active_connections[job_id].append(websocket)
        logger.info(f"WebSocket client connected to job {job_id}")

    def disconnect(self, job_id: str, websocket: WebSocket):
        if job_id in self.active_connections:
            self.active_connections[job_id].remove(websocket)
            if not self.active_connections[job_id]:
                del self.active_connections[job_id]
            logger.info(f"WebSocket client disconnected from job {job_id}")

    async def broadcast_to_job(self, job_id: str, message: dict):
        if job_id in self.active_connections:
            dead_connections = []
            for connection in self.active_connections[job_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending socket message: {e}")
                    dead_connections.append(connection)
            for dead in dead_connections:
                self.disconnect(job_id, dead)

manager = ConnectionManager()

def update_job_db(job_id: str, status: str, progress: float, error_message: str = None, final_video_url: str = None):
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = status
            job.progress = progress
            if error_message:
                job.error_message = error_message
            if final_video_url:
                job.final_video_url = final_video_url
            db.commit()
    except Exception as e:
        logger.error(f"Database update failed for job {job_id}: {e}")
    finally:
        db.close()

async def run_pipeline_orchestration(
    job_id: str,
    video_path: str,
    script_path: str,
    language: str,
    voice_gender: str,
    sync_mode: str,
    watermark_text: str,
    caption_style: str = "active_word",
    font_name: str = "Arial",
    font_size: float = 24.0,
    bgm_path: str = None,
    bgm_volume: float = 0.1,
    tts_engine: str = "edge-tts",
    elevenlabs_key: str = "",
    polish_script: bool = True
):
    logger.info(f"Starting orchestration pipeline for job {job_id}")
    
    # helper for notifications
    async def update_status(status_str: str, progress_val: float, err: str = None, video_url: str = None):
        update_job_db(job_id, status_str, progress_val, err, video_url)
        await manager.broadcast_to_job(job_id, {
            "job_id": job_id,
            "status": status_str,
            "progress": progress_val,
            "error_message": err,
            "final_video_url": video_url
        })
        
    try:
        # Step 1: Generate TTS Audio
        await update_status("GENERATING_TTS", 10.0)
        logger.info(f"Job {job_id}: Requesting TTS audio...")
        
        with open(script_path, "r", encoding="utf-8") as f:
            script_text = f.read()

        # Step 0: Optional AI Script Polishing via Gemini LLM
        gemini_api_key = os.getenv("GEMINI_API_KEY")
        if polish_script and gemini_api_key:
            await update_status("POLISHING_SCRIPT", 5.0)
            logger.info(f"Job {job_id}: GEMINI_API_KEY found. Polishing script using LLM...")
            try:
                import google.generativeai as genai
                genai.configure(api_key=gemini_api_key)
                model = genai.GenerativeModel('gemini-1.5-flash')
                prompt = (
                    "You are an expert scriptwriter and copyeditor. Clean up, correct spelling/grammar, format, and optimize the following script for high-retention video narration. "
                    "Keep the exact core message and meaning, but improve delivery, pacing, and flow. "
                    "Respond ONLY with the polished script text. Do not include any introductions, explanations, or markdown formatting.\n\n"
                    f"Script:\n{script_text}"
                )
                # Run the model asynchronously to avoid blocking the FastAPI event loop
                response = await model.generate_content_async(prompt)
                polished_text = response.text.strip()
                if polished_text:
                    script_text = polished_text
                    # Save back to file so next microservices (TTS) can read it
                    with open(script_path, "w", encoding="utf-8") as f:
                        f.write(script_text)
                    logger.info(f"Job {job_id}: Script polished successfully!")
            except Exception as e:
                logger.error(f"Job {job_id}: AI Script polishing failed: {e}. Proceeding with original script.")
            
        tts_req = {
            "text": script_text,
            "language": language,
            "voice_gender": voice_gender,
            "job_id": job_id,
            "tts_engine": tts_engine,
            "elevenlabs_key": elevenlabs_key
        }
        
        import anyio
        
        tts_resp = await anyio.to_thread.run_sync(lambda: requests.post(TTS_URL, json=tts_req, timeout=600))
        if tts_resp.status_code != 200:
            raise Exception(f"TTS service failed: {tts_resp.text}")
            
        tts_data = tts_resp.json()
        audio_path = tts_data["audio_path"]
        alignment_path = tts_data["alignment_path"]
        logger.info(f"Job {job_id}: Generated audio at {audio_path} with alignment metadata at {alignment_path}")
        
        # Check original uploaded video length vs tts generated audio length
        video_dur = get_duration(video_path)
        audio_dur = get_duration(audio_path)
        logger.info(f"Job {job_id}: Duration check - Original Video = {video_dur:.2f}s, Generated TTS Audio = {audio_dur:.2f}s")
        
        # In scene sync mode, the video's speed is adjusted dynamically to match the audio.
        # Otherwise, check that the voice-over audio fits inside the video.
        if sync_mode != "scene":
            if video_dur > 0 and audio_dur > video_dur:
                raise Exception(
                    f"Voice-over duration ({audio_dur:.1f}s) is longer than the video ({video_dur:.1f}s). "
                    f"Please shorten your script to fit the video."
                )
        
        # Step 2: Synchronize Audio with Video (Lip-Sync or Scene Alignment)
        await update_status("SYNCING", 40.0)
        logger.info(f"Job {job_id}: Syncing video with audio ({sync_mode})...")
        
        sync_req = {
            "video_path": video_path,
            "audio_path": audio_path,
            "job_id": job_id,
            "sync_mode": sync_mode
        }
        
        sync_resp = await anyio.to_thread.run_sync(lambda: requests.post(SYNC_URL, json=sync_req, timeout=600))
        if sync_resp.status_code != 200:
            raise Exception(f"Sync service failed: {sync_resp.text}")
            
        synced_video_path = sync_resp.json()["synced_video_path"]
        logger.info(f"Job {job_id}: Generated synced video at {synced_video_path}")
        
        # Step 3: Final Rendering & Encoding
        await update_status("RENDERING", 70.0)
        logger.info(f"Job {job_id}: Rendering final output...")
        
        render_req = {
            "synced_video_path": synced_video_path,
            "audio_path": audio_path,
            "alignment_path": alignment_path,
            "job_id": job_id,
            "watermark_text": watermark_text,
            "caption_style": caption_style,
            "font_name": font_name,
            "font_size": font_size,
            "bgm_path": bgm_path,
            "bgm_volume": bgm_volume
        }
        
        render_resp = await anyio.to_thread.run_sync(lambda: requests.post(RENDER_URL, json=render_req, timeout=600))
        if render_resp.status_code != 200:
            raise Exception(f"Render service failed: {render_resp.text}")
            
        output_video_path = render_resp.json()["output_video_path"]
        logger.info(f"Job {job_id}: Final render completed at {output_video_path}")
        
        # Map filesystem output path back to web URL accessible via our static server
        # Storage format: storage/output/{job_id}_final.mp4
        final_filename = os.path.basename(output_video_path)
        final_video_url = f"http://127.0.0.1:8000/static/output/{final_filename}"
        
        # Final success broadcast
        await update_status("COMPLETED", 100.0, video_url=final_video_url)
        logger.info(f"Job {job_id}: Pipeline finished successfully!")
        
    except Exception as e:
        logger.error(f"Job {job_id} Pipeline Failure: {e}")
        await update_status("FAILED", 100.0, err=str(e))

async def run_audio_only_orchestration(
    job_id: str,
    script_path: str,
    language: str,
    voice_gender: str,
    tts_engine: str = "edge-tts",
    elevenlabs_key: str = ""
):
    logger.info(f"Starting audio-only orchestration pipeline for job {job_id}")
    
    # helper for notifications
    async def update_status(status_str: str, progress_val: float, err: str = None, audio_url: str = None):
        update_job_db(job_id, status_str, progress_val, err, audio_url)
        await manager.broadcast_to_job(job_id, {
            "job_id": job_id,
            "status": status_str,
            "progress": progress_val,
            "error_message": err,
            "final_video_url": audio_url
        })
        
    try:
        # Step 1: Generate TTS Audio
        await update_status("GENERATING_TTS", 20.0)
        logger.info(f"Job {job_id}: Requesting TTS audio...")
        
        with open(script_path, "r", encoding="utf-8") as f:
            script_text = f.read()
            
        tts_req = {
            "text": script_text,
            "language": language,
            "voice_gender": voice_gender,
            "job_id": job_id,
            "tts_engine": tts_engine,
            "elevenlabs_key": elevenlabs_key
        }
        
        import anyio
        tts_resp = await anyio.to_thread.run_sync(lambda: requests.post(TTS_URL, json=tts_req, timeout=600))
        if tts_resp.status_code != 200:
            raise Exception(f"TTS service failed: {tts_resp.text}")
            
        tts_data = tts_resp.json()
        audio_path = tts_data["audio_path"]
        logger.info(f"Job {job_id}: Generated audio at {audio_path}")
        
        # Final audio URL
        final_filename = os.path.basename(audio_path)
        final_audio_url = f"http://127.0.0.1:8000/static/audio/{final_filename}"
        
        # Done!
        await update_status("COMPLETED", 100.0, audio_url=final_audio_url)
        logger.info(f"Job {job_id}: Audio pipeline finished successfully!")
    except Exception as e:
        logger.error(f"Job {job_id} Audio Pipeline Failure: {e}")
        await update_status("FAILED", 100.0, err=str(e))

def cleanup_temporary_files():
    temp_dirs = [
        os.path.join(STORAGE_DIR, "raw_videos"),
        os.path.join(STORAGE_DIR, "scripts"),
        os.path.join(STORAGE_DIR, "audio"),
        os.path.join(STORAGE_DIR, "synced_videos"),
        os.path.join(STORAGE_DIR, "bgm")
    ]
    logger.info("Auto-cleanup triggered. Cleaning old temporary files (excluding output folder)...")
    cutoff_time = time.time() - (2 * 3600)  # Only delete files older than 2 hours
    for directory in temp_dirs:
        if os.path.exists(directory):
            try:
                for filename in os.listdir(directory):
                    file_path = os.path.join(directory, filename)
                    if os.path.isfile(file_path):
                        if os.path.getmtime(file_path) < cutoff_time:
                            try:
                                os.remove(file_path)
                                logger.info(f"Auto-deleted old temporary file: {file_path}")
                            except Exception as e:
                                logger.warning(f"Could not delete temporary file {file_path} (it may be in use): {e}")
            except Exception as e:
                logger.error(f"Error during temporary file cleanup in {directory}: {e}")

def get_duration(file_path: str) -> float:
    """Gets duration of media file using ffprobe."""
    import subprocess
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", file_path
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True, timeout=600)
        return float(result.stdout.strip())
    except Exception as e:
        logger.error(f"Failed to probe duration for {file_path}: {e}")
        return 0.0

@app.post("/upload")
async def upload_job(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    script: UploadFile = File(...),
    language: str = Form("en"),
    voice_gender: str = Form("male"),
    sync_mode: str = Form("scene"),
    watermark_text: str = Form(""),
    caption_style: str = Form("active_word"),
    font_name: str = Form("Arial"),
    font_size: float = Form(24.0),
    bgm_file: UploadFile = File(None),
    bgm_name: str = Form("none"),
    bgm_volume: float = Form(0.1),
    tts_engine: str = Form("edge-tts"),
    elevenlabs_key: str = Form(""),
    polish_script: bool = Form(True)
):
    cleanup_temporary_files()
    job_id = str(uuid.uuid4())
    
    # Save the raw uploaded video
    video_ext = os.path.splitext(video.filename)[1] or ".mp4"
    saved_video_path = os.path.join(RAW_VIDEOS_DIR, f"{job_id}{video_ext}")
    with open(saved_video_path, "wb") as buffer:
        buffer.write(await video.read())
        
    # Save the script text file
    script_ext = os.path.splitext(script.filename)[1] or ".txt"
    saved_script_path = os.path.join(SCRIPTS_DIR, f"{job_id}{script_ext}")
    with open(saved_script_path, "wb") as buffer:
        buffer.write(await script.read())
        
    # Insert job into SQLite
    db = SessionLocal()
    try:
        new_job = Job(
            id=job_id,
            status="PENDING",
            progress=0.0,
            language=language,
            voice_gender=voice_gender,
            sync_mode=sync_mode,
            watermark_text=watermark_text,
            caption_style=caption_style,
            font_size=font_size,
            bgm_volume=bgm_volume
        )
        db.add(new_job)
        db.commit()
    finally:
        db.close()
    
    # Save bgm if provided or select from library
    saved_bgm_path = None
    if bgm_name and bgm_name != "none" and bgm_name != "custom":
        library_bgm_path = os.path.join(STORAGE_DIR, "bgm_library", f"{bgm_name}.mp3")
        if os.path.exists(library_bgm_path):
            saved_bgm_path = library_bgm_path
    elif bgm_file:
        bgm_ext = os.path.splitext(bgm_file.filename)[1] or ".mp3"
        saved_bgm_path = os.path.join(BGM_DIR, f"{job_id}{bgm_ext}")
        with open(saved_bgm_path, "wb") as buffer:
            buffer.write(await bgm_file.read())
            
    # Queue orchestrator run in the background
    background_tasks.add_task(
        run_pipeline_orchestration,
        job_id,
        os.path.abspath(saved_video_path),
        os.path.abspath(saved_script_path),
        language,
        voice_gender,
        sync_mode,
        watermark_text,
        caption_style,
        font_name,
        font_size,
        os.path.abspath(saved_bgm_path) if saved_bgm_path else None,
        bgm_volume,
        tts_engine,
        elevenlabs_key,
        polish_script
    )
    
    return {"status": "queued", "job_id": job_id}

@app.post("/upload_audio")
async def upload_audio_job(
    background_tasks: BackgroundTasks,
    script: UploadFile = File(None),
    script_text: str = Form(None),
    language: str = Form("en"),
    voice_gender: str = Form("male"),
    tts_engine: str = Form("edge-tts"),
    elevenlabs_key: str = Form("")
):
    cleanup_temporary_files()
    if not script and not script_text:
        raise HTTPException(status_code=400, detail="Either script file or script text must be provided.")
        
    job_id = str(uuid.uuid4())
    
    # Resolve script text
    text_content = ""
    if script:
        text_content = (await script.read()).decode("utf-8")
    elif script_text:
        text_content = script_text
        
    # Save the script text file
    saved_script_path = os.path.join(SCRIPTS_DIR, f"{job_id}.txt")
    with open(saved_script_path, "w", encoding="utf-8") as f:
        f.write(text_content)
        
    # Insert job into SQLite
    db = SessionLocal()
    try:
        new_job = Job(
            id=job_id,
            status="PENDING",
            progress=0.0,
            language=language,
            voice_gender=voice_gender,
            job_type="audio_only",
            sync_mode="none"
        )
        db.add(new_job)
        db.commit()
    finally:
        db.close()
    
    # Queue orchestrator run in the background
    background_tasks.add_task(
        run_audio_only_orchestration,
        job_id,
        os.path.abspath(saved_script_path),
        language,
        voice_gender,
        tts_engine,
        elevenlabs_key
    )
    
    return {"status": "queued", "job_id": job_id}

@app.get("/jobs")
def get_jobs():
    db = SessionLocal()
    try:
        jobs = db.query(Job).order_by(Job.created_at.desc()).all()
        return jobs
    finally:
        db.close()

@app.get("/job/{job_id}")
def get_job(job_id: str):
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job
    finally:
        db.close()

@app.websocket("/ws/job/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await manager.connect(job_id, websocket)
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
    finally:
        db.close()
    
    # Send initial status
    if job:
        await websocket.send_json({
            "job_id": job.id,
            "status": job.status,
            "progress": job.progress,
            "error_message": job.error_message,
            "final_video_url": job.final_video_url
        })
        
    try:
        while True:
            # Keep connection alive; discard any text inputs from client
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(job_id, websocket)
    except Exception as e:
        logger.error(f"WebSocket error for job {job_id}: {e}")
        manager.disconnect(job_id, websocket)

@app.get("/health")
def health():
    return {"status": "ok", "service": "upload"}

class LiveProgressUpdateRequest(BaseModel):
    status: str
    progress: float
    error_message: str | None = None
    final_video_url: str | None = None

from pydantic import BaseModel as PydanticBaseModel
class ProgressUpdate(PydanticBaseModel):
    status: str
    progress: float
    error_message: str | None = None
    final_video_url: str | None = None

@app.post("/job/{job_id}/progress")
async def update_job_progress(job_id: str, request: ProgressUpdate):
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = request.status
            job.progress = request.progress
            if request.error_message is not None:
                job.error_message = request.error_message
            if request.final_video_url is not None:
                job.final_video_url = request.final_video_url
            db.commit()
            
            # Broadcast via WebSocket
            await manager.broadcast_to_job(job_id, {
                "job_id": job_id,
                "status": request.status,
                "progress": request.progress,
                "error_message": request.error_message,
                "final_video_url": request.final_video_url
            })
            return {"status": "ok"}
        else:
            raise HTTPException(status_code=404, detail="Job not found")
    except Exception as e:
        logger.error(f"Failed live progress update for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
