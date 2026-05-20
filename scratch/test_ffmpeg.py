import subprocess
import time

cmd = [
    "ffmpeg", "-y",
    "-i", "test_video.mp4",
    "-i", "storage/audio/d1537738-9310-4149-8241-eec50f9c9bab.mp3",
    "-filter_complex", "[0:v]setpts=2.016*PTS[v]",
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-crf", "16",
    "-preset", "medium",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "320k",
    "-shortest",
    "-progress", "-",
    "storage/synced_videos/test_out.mp4"
]

print("Starting FFmpeg subprocess...")
p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)

print("Reading stdout line-by-line...")
count = 0
while True:
    line = p.stdout.readline()
    if not line:
        print("Got EOF (empty line)!")
        break
    count += 1
    if "out_time_us=" in line:
        print(f"[{count}] {line.strip()}")

print("Waiting for process to exit...")
ret = p.wait()
print(f"Process exited with return code: {ret}")
