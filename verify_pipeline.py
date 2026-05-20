import os
import sys
import time
import subprocess
import requests
import cv2
import numpy as np

# Configuration
API_URL = "http://127.0.0.1:8000"
SERVICES = {
    "upload": ("services/upload/main.py", 8000),
    "tts": ("services/tts/main.py", 8001),
    "lipsync": ("services/lipsync/main.py", 8002),
    "render": ("services/render/main.py", 8003)
}

processes = []

def generate_dummy_assets():
    """Generates a 3-second dummy MP4 video and a script TXT file for pipeline testing."""
    print("[Test Setup] Creating dummy assets...")
    video_path = "test_video.mp4"
    script_path = "test_script.txt"
    
    # 1. Create a 3-second dummy video using OpenCV (24 fps)
    width, height = 640, 480
    fps = 24
    duration = 4.3
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(video_path, fourcc, fps, (width, height))
    
    for i in range(int(duration * fps)):
        # Create a simple frame with a changing text counter
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        # Background gradient
        frame[:, :, 0] = 30  # Blue
        frame[:, :, 1] = 20  # Green
        frame[:, :, 2] = 20  # Red
        
        # Draw a moving mouth-like shape to simulate speaking
        mouth_y = 300 + int(15 * np.sin(i * 0.5))
        cv2.ellipse(frame, (320, mouth_y), (40, 20), 0, 0, 360, (0, 0, 255), -1)
        
        # Add visual context
        cv2.putText(frame, "AUTOMATED PIPELINE TEST", (100, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.putText(frame, f"Visual Frame: {i}", (220, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (168, 85, 247), 2)
        out.write(frame)
        
    out.release()
    print(f"[Test Setup] Generated video asset: {video_path}")
    
    # 2. Create a script file
    with open(script_path, "w", encoding="utf-8") as f:
        f.write("Welcome to the test.")
    print(f"[Test Setup] Generated script asset: {script_path}")
    
    return video_path, script_path

def start_services():
    """Checks for running services, starting them if missing."""
    print("[Test Setup] Checking microservice availability...")
    for name, (path, port) in SERVICES.items():
        try:
            resp = requests.get(f"http://127.0.0.1:{port}/health", timeout=1)
            if resp.status_code == 200:
                print(f"[Test Setup] Service '{name}' is already running on port {port}.")
                continue
        except requests.RequestException:
            pass
            
        print(f"[Test Setup] Starting '{name}' on port {port}...")
        # Run python process in background, redirecting stdout/stderr to devnull to avoid cluttering test run
        p = subprocess.Popen(
            [sys.executable, path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=os.environ.copy()
        )
        processes.append(p)
        
    # Wait for services to bootstrap
    print("[Test Setup] Waiting 5 seconds for services to initialize...")
    time.sleep(5)

def run_e2e_test(video_path, script_path):
    """Submits job and polls orchestrator for completion."""
    print("\n========================================================")
    print("           Executing E2E Pipeline Verification")
    print("========================================================\n")
    
    # Post files to /upload
    upload_url = f"{API_URL}/upload"
    payload = {
        "language": "en",
        "voice_gender": "male",
        "sync_mode": "scene",  # Default scene alignment for speed
        "watermark_text": "E2E VERIFIED"
    }
    
    with open(video_path, "rb") as vid_f, open(script_path, "rb") as scr_f:
        files = {
            "video": vid_f,
            "script": scr_f
        }
        print("[Test Client] Sending files to Upload Coordinator Service...")
        resp = requests.post(upload_url, data=payload, files=files)
        
    if resp.status_code != 200:
        print(f"[Test Failure] Upload failed with status code {resp.status_code}: {resp.text}")
        return False
        
    job_data = resp.json()
    job_id = job_data["job_id"]
    print(f"[Test Client] Job queued successfully! Job ID: {job_id}")
    
    # Poll job status
    status_url = f"{API_URL}/job/{job_id}"
    max_retries = 24  # 2 minutes maximum
    retry_interval = 5
    
    print("[Test Client] Polling job state...")
    for attempt in range(max_retries):
        status_resp = requests.get(status_url)
        if status_resp.status_code != 200:
            print(f"[Test Warning] Failed to fetch job status: {status_resp.text}")
            time.sleep(retry_interval)
            continue
            
        job = status_resp.json()
        print(f" -> Attempt {attempt+1}: Status={job['status']} | Progress={job['progress']}%")
        
        if job["status"] == "COMPLETED":
            print("\n[Test Success] Job completed successfully!")
            print(f" -> Output Video URL: {job['final_video_url']}")
            
            # Verify final video locally
            output_filename = f"{job_id}_final.mp4"
            # Map back static path (storage/output/{job_id}_final.mp4)
            storage_output_path = os.path.join("storage", "output", output_filename)
            
            if os.path.exists(storage_output_path):
                file_size = os.path.getsize(storage_output_path)
                print(f" -> Local file verified: {storage_output_path} ({file_size} bytes)")
                if file_size > 0:
                    return True
            else:
                print(f"[Test Failure] Output file missing from local path: {storage_output_path}")
                return False
                
        elif job["status"] == "FAILED":
            print(f"\n[Test Failure] Pipeline reported job failure: {job['error_message']}")
            return False
            
        time.sleep(retry_interval)
        
    print("\n[Test Failure] Job timed out before completion.")
    return False

def cleanup(video_path, script_path):
    """Terminates background servers and deletes test assets."""
    print("\n[Cleanup] Tearing down resources...")
    for p in processes:
        print(f"[Cleanup] Terminating background process PID {p.pid}")
        p.terminate()
        p.wait()
        
    if os.path.exists(video_path):
        os.remove(video_path)
        print(f"[Cleanup] Removed {video_path}")
    if os.path.exists(script_path):
        os.remove(script_path)
        print(f"[Cleanup] Removed {script_path}")
    print("[Cleanup] Completed!")

def main():
    video_path = ""
    script_path = ""
    success = False
    try:
        video_path, script_path = generate_dummy_assets()
        start_services()
        success = run_e2e_test(video_path, script_path)
    except Exception as e:
        print(f"[Critical Error] Test threw exception: {e}")
    finally:
        cleanup(video_path, script_path)
        
    if success:
        print("\nTest Status: PASSED\n")
        sys.exit(0)
    else:
        print("\nTest Status: FAILED\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
