import subprocess
import numpy as np
import cv2

# --- KONFIGURASI ---
RTSP_URL = "rtsp://admin:D%21p4t1nangor@10.67.18.248/media/video0"
RESOLUTION = (1280, 720)

# --- COMMAND FFMPEG ---
cmd = [
    "ffmpeg",
    "-rtsp_transport", "tcp",
    "-i", RTSP_URL,
    "-f", "rawvideo",
    "-pix_fmt", "bgr24",
    "-vf", f"scale={RESOLUTION[0]}:{RESOLUTION[1]}",
    "-"
]

print("[INFO] Memulai stream dari RTSP...")
pipe = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10**8)

w, h = RESOLUTION
frame_size = w * h * 3

try:
    while True:
        raw_frame = pipe.stdout.read(frame_size)
        if len(raw_frame) != frame_size:
            print("[WARNING] Gagal ambil frame. Mungkin stream terputus.")
            break

        frame = np.frombuffer(raw_frame, np.uint8).reshape((h, w, 3))
        cv2.imshow("RTSP Stream", frame)

        # Tekan 'q' untuk keluar
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

except KeyboardInterrupt:
    print("\n[INFO] Dihentikan oleh pengguna.")
finally:
    pipe.terminate()
    pipe.wait()
    cv2.destroyAllWindows()
    print("[INFO] Stream selesai.")
