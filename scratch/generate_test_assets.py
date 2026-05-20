import cv2
import numpy as np

def generate_dummy_assets():
    print("[Test Setup] Creating dummy assets...")
    video_path = "test_video.mp4"
    script_path = "test_script.txt"
    
    # Create a 3-second dummy video using OpenCV (24 fps)
    width, height = 640, 480
    fps = 24
    duration = 3
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(video_path, fourcc, fps, (width, height))
    
    for i in range(duration * fps):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[:, :, 0] = 30  # Blue
        frame[:, :, 1] = 20  # Green
        frame[:, :, 2] = 20  # Red
        cv2.putText(frame, "E2E BROWSER TEST VIDEO", (100, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        out.write(frame)
        
    out.release()
    print(f"[Test Setup] Generated video asset: {video_path}")
    
    with open(script_path, "w", encoding="utf-8") as f:
        f.write("Welcome to the automated single click visual sync verification test.")
    print(f"[Test Setup] Generated script asset: {script_path}")

if __name__ == "__main__":
    generate_dummy_assets()
