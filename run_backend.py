import subprocess
import sys
import os
import time

SERVICES = {
    "upload": ("services/upload/main.py", 8000),
    "tts": ("services/tts/main.py", 8001),
    "lipsync": ("services/lipsync/main.py", 8002),
    "render": ("services/render/main.py", 8003)
}

processes = []

try:
    print("Starting all backend services...")
    for name, (path, port) in SERVICES.items():
        print(f"Starting {name} on port {port}...")
        # Run python process in background, using sys.executable
        p = subprocess.Popen(
            [sys.executable, path],
            env=os.environ.copy()
        )
        processes.append((name, p))
    
    print("All backend services started! Keep this script running to keep them alive.")
    # Periodically check health and print status
    while True:
        time.sleep(5)
        # Check if any process has exited
        for name, p in processes:
            ret = p.poll()
            if ret is not None:
                print(f"[Warning] Service {name} exited with code {ret}. Restarting...")
                p_new = subprocess.Popen(
                    [sys.executable, SERVICES[name][0]],
                    env=os.environ.copy()
                )
                # Replace process in list
                idx = [x[0] for x in processes].index(name)
                processes[idx] = (name, p_new)
except KeyboardInterrupt:
    print("Stopping backend services...")
finally:
    for name, p in processes:
        print(f"Terminating {name}...")
        try:
            p.terminate()
            p.wait(timeout=3)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
