import subprocess
import numpy as np
import cv2
import os
import time
from datetime import datetime

# --- KONFIGURASI ---
# RTSP_URL = "rtsp://root:D!p4t1nangor@10.67.20.164/axis-media/media.amp?resolution=640x360"  # Encode '!' → %21
RTSP_URL = "rtsp://admin:D!p4t1nangor@10.67.20.158/media/video1"  # Encode '!' → %21
SAVE_DIR = "dataset/cctv_capture"
INTERVAL_SECONDS = 2
RESOLUTION = (640, 360)

# --- PERSIAPAN DIREKTORI ---
os.makedirs(SAVE_DIR, exist_ok=True)

# --- SETUP FFMPEG COMMAND ---
cmd = [
    "ffmpeg",
    "-rtsp_transport", "tcp",
    "-i", RTSP_URL,
    "-f", "rawvideo",
    "-pix_fmt", "bgr24",
    "-vf", f"scale={RESOLUTION[0]}:{RESOLUTION[1]}",
    "-"
]

# --- MULAI SUBPROSES FFMPEG ---
pipe = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10**8)
w, h = RESOLUTION
frame_size = w * h * 3

print("[INFO] Memulai capture frame...")

try:
    while True:
        raw_frame = pipe.stdout.read(frame_size)
        if len(raw_frame) != frame_size:
            print("[WARNING] Gagal baca frame (mungkin stream putus atau selesai).")
            break

        # Ubah byte ke frame image
        frame = np.frombuffer(raw_frame, np.uint8).reshape((h, w, 3))

        # Format nama file
        now = datetime.now()
        folder = os.path.join(SAVE_DIR, now.strftime("%Y-%m-%d"))
        os.makedirs(folder, exist_ok=True)
        filename = os.path.join(folder, now.strftime("%H%M%S") + ".jpg")

        # Simpan frame sebagai JPG
        cv2.imwrite(filename, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        print(f"[SAVED] {filename}")

        time.sleep(INTERVAL_SECONDS)

except KeyboardInterrupt:
    print("\n[INFO] Dihentikan oleh pengguna.")
finally:
    pipe.terminate()
    pipe.wait()
    print("[INFO] Capture selesai.")
