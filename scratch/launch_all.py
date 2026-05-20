import os
import sys
import time
import subprocess

SERVICES = {
    "upload": ("services/upload/main.py", 8000),
    "tts": ("services/tts/main.py", 8001),
    "lipsync": ("services/lipsync/main.py", 8002),
    "render": ("services/render/main.py", 8003)
}

processes = []

def main():
    print("[Launcher] Starting python microservices...")
    for name, (path, port) in SERVICES.items():
        abs_path = os.path.abspath(path)
        print(f"[Launcher] Starting {name} on port {port}...")
        p = subprocess.Popen(
            [sys.executable, abs_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=os.environ.copy()
        )
        processes.append((name, p))
        
    print("[Launcher] Starting React Vite dev server...")
    frontend_dir = os.path.abspath("services/frontend")
    
    # We run npm run dev inside the frontend directory
    # On Windows, we need shell=True to execute npm.cmd
    p_fe = subprocess.Popen(
        "npm run dev",
        cwd=frontend_dir,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=os.environ.copy()
    )
    processes.append(("frontend", p_fe))
    
    print("[Launcher] All services started. Keeping them alive. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("[Launcher] Shutting down...")
    finally:
        for name, p in processes:
            print(f"[Launcher] Terminating {name}...")
            p.terminate()
            p.wait()
        print("[Launcher] Clean shutdown completed!")

if __name__ == "__main__":
    main()
