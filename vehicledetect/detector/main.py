# main.py (Integrasi Detektor)

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import asyncio
import numpy as np
import threading
import time
import requests
import io
import imageio_ffmpeg # Pastikan ini terinstall: pip install imageio-ffmpeg
from datetime import datetime, timedelta
from ultralytics import YOLO
import os
import subprocess

app = FastAPI()

# --- KONFIGURASI UNTUK DJANGO BACKEND ---
DJANGO_API_BASE_URL = "http://10.69.69.52:8000" # Asumsi Django berjalan di port 8000 Anda

# Konfigurasi CORS agar frontend Next.js bisa mengakses API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://10.69.69.52:3000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global Dictionaries dan Locks ---
cctv_streams_info = {}
yolo_models = {}

# Perbarui class_names sesuai dengan training model 'best.pt' Anda
# Contoh: {0: "Mobil", 1: "Motor", 2: "Bus", 3: "Truk"}
# Pastikan ini cocok dengan output model YOLO Anda
class_names = {0: "Mobil", 1: "Motor", 2: "Bus", 3: "Truk"}


# --- Fungsi untuk Posting Deteksi ke Backend (Django) ---
# FUNGSI INI HANYA AKAN DIPANGGIL SECARA INTERNAL OLEH SERVER FASTAPI
def post_detection_to_backend(cctv_id, vehicle_type, direction, frame):
    def send():
        try:
            # Jika Anda TIDAK ingin mengirim gambar frame, cukup biarkan baris di bawah dikomentari
            # Jika Anda ingin mengirim gambar, uncomment kembali
            # _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            # frame_bytes = io.BytesIO(buffer).getvalue()

            data = {
                "cctv": cctv_id,
                "vehicle_type": vehicle_type,
                "direction": direction,
                "timestamp": datetime.now().isoformat()
            }
            # files = {'frame_image': ('frame.jpg', frame_bytes, 'image/jpeg')} # Uncomment jika mengirim gambar

            API_DETECTION_URL = f"{DJANGO_API_BASE_URL}/api/detections/"
            # r = requests.post(API_DETECTION_URL, data=data, files=files) # Uncomment jika mengirim gambar
            r = requests.post(API_DETECTION_URL, data=data) # Tetap ini jika TIDAK mengirim gambar
            if r.status_code != 201:
                print(f"[{cctv_id}] POST gagal: {r.status_code}, {r.text}")
            else:
                print(f"[{cctv_id}] POST berhasil: {r.status_code}")
        except Exception as e:
            print(f"[{cctv_id}] Gagal kirim deteksi: {e}")
    threading.Thread(target=send).start()


# --- Fungsi Pembaca Video (FFmpeg dan OpenCV) ---
# Tidak ada perubahan besar di sini, saya hanya sedikit membersihkan logging
def ffmpeg_reader_generator(rtsp_url, resolution=(640, 360), reconnect_attempts=3):
    print(f"[FFMPEG] Memulai stream dari {rtsp_url}...")

    w, h = resolution
    frame_size = w * h * 3

    def start_pipe():
        return subprocess.Popen([
            "ffmpeg",
            "-rtsp_transport", "tcp",
            "-i", rtsp_url,
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-vf", f"scale={w}:{h}",
            "-threads", "1",
            "-fflags", "nobuffer", # Kurangi buffering untuk low-latency
            "-flags", "low_delay", # Kurangi delay
            "-an",  # disable audio
            "-preset", "ultrafast", # Preset encoding jika ada re-encoding
            "-", # Output ke stdout
        ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10**8) # Buffer lebih besar untuk ffmpeg

    pipe = None
    try:
        pipe = start_pipe()
        retries = 0
        while retries < reconnect_attempts:
            raw_frame = pipe.stdout.read(frame_size)

            if not raw_frame or len(raw_frame) != frame_size:
                print(f"[FFMPEG] Gagal ambil frame dari {rtsp_url} (retries={retries+1}). Mencoba reconnect...")
                retries += 1
                if pipe:
                    pipe.terminate()
                    pipe.wait(timeout=3) # Pastikan pipe ditutup
                time.sleep(2) # Beri jeda sebelum mencoba lagi
                pipe = start_pipe() # Coba mulai pipe baru
                continue # Lanjut ke iterasi berikutnya untuk membaca frame

            frame = np.frombuffer(raw_frame, np.uint8).reshape((h, w, 3))
            yield frame
            retries = 0 # Reset retries on successful frame read

    except Exception as e:
        print(f"[FFMPEG] Kesalahan fatal saat membaca stream dari {rtsp_url}: {e}")
    finally:
        if pipe:
            pipe.terminate()
            pipe.wait(timeout=3)
        print(f"[FFMPEG] Reader untuk {rtsp_url} selesai.")


def opencv_reader_generator(rtsp_url, resolution=(640, 360), reconnect_attempts=3):
    print(f"[OPENCV] Memulai stream dari {rtsp_url}...")
    w, h = resolution
    
    cap = None
    retries = 0
    
    def connect_cap():
        nonlocal cap # agar bisa mengubah 'cap' dari scope luar
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            print(f"[OPENCV] Gagal membuka koneksi VideoCapture dari {rtsp_url}.")
            return False
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 3) # Buffer kecil untuk latensi rendah
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        print(f"[OPENCV] VideoCapture dimulai untuk {rtsp_url}. Resolusi: {cap.get(cv2.CAP_PROP_FRAME_WIDTH)}x{cap.get(cv2.CAP_PROP_FRAME_HEIGHT)}")
        return True

    if not connect_cap():
        print(f"[OPENCV] Gagal koneksi awal untuk {rtsp_url}. Thread mungkin akan berhenti.")
        return # Keluar dari generator jika gagal koneksi awal

    while retries < reconnect_attempts:
        ret, frame = cap.read()
        if ret:
            # Resize jika resolusi bukan yang diharapkan
            if frame.shape[1] != w or frame.shape[0] != h:
                frame = cv2.resize(frame, (w, h))
            yield frame
            retries = 0 # Reset retries on successful frame read
        else:
            print(f"[OPENCV] Gagal membaca frame dari {rtsp_url} (retries={retries+1}). Mencoba reconnect...")
            retries += 1
            if cap:
                cap.release()
            time.sleep(2) # Beri jeda
            if not connect_cap(): # Coba connect lagi
                if retries >= reconnect_attempts:
                    print(f"[OPENCV] Gagal reconnect setelah {reconnect_attempts} percobaan. Menghentikan stream untuk {rtsp_url}.")
                    break # Keluar dari loop jika gagal total
            else:
                continue # Lanjut ke iterasi berikutnya untuk membaca frame

    if cap:
        cap.release()
    print(f"[OPENCV] Reader untuk {rtsp_url} selesai.")

def imageio_reader_generator(rtsp_url, resolution=(640, 360), reconnect_attempts=3):
    print(f"[IMAGEIO] Memulai stream dari {rtsp_url}...")
    w, h = resolution
    frame_size = w * h * 3

    def start_pipe():
        return subprocess.Popen(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-f", "rawvideo",
                "-pix_fmt", "bgr24",
                "-vf", f"scale={w}:{h}",
                "-threads", "1",
                "-fflags", "nobuffer",
                "-flags", "low_delay",
                "-an",
                "-preset", "ultrafast",
                "-",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=10**8
        )

    pipe = None
    try:
        pipe = start_pipe()
        retries = 0
        while retries < reconnect_attempts:
            raw_frame = pipe.stdout.read(frame_size)
            if not raw_frame or len(raw_frame) != frame_size:
                print(f"[IMAGEIO] Gagal ambil frame dari {rtsp_url} (retries={retries+1}). Mencoba reconnect...")
                retries += 1
                if pipe:
                    pipe.terminate()
                    pipe.wait(timeout=3)
                time.sleep(2)
                pipe = start_pipe()
                continue

            frame = np.frombuffer(raw_frame, np.uint8).reshape((h, w, 3))
            yield frame
            retries = 0

    except Exception as e:
        print(f"[IMAGEIO] Kesalahan fatal saat membaca stream dari {rtsp_url}: {e}")
    finally:
        if pipe:
            pipe.terminate()
            pipe.wait(timeout=3)
        print(f"[IMAGEIO] Reader untuk {rtsp_url} selesai.")


# --- Fungsi Utama untuk Menjalankan Deteksi dan Memperbarui Buffer Frame ---
def run_detection_and_update_frame_buffer(cctv_name: str):
    cctv_info = cctv_streams_info[cctv_name]
    cctv_id = cctv_info['id']
    rtsp_url = cctv_info['rtsp_url']
    direction_mode = cctv_info.get("direction_mode", "BOTH").upper()
    p1 = cctv_info["line_start"]
    p2 = cctv_info["line_end"]
    brand = cctv_info.get('brand', 'unv').lower()

    # Pilih reader berdasarkan brand (atau type)
    if brand == 'axis':
        reader_fn = opencv_reader_generator
    elif brand == 'hikvision':
        reader_fn = imageio_reader_generator
    else: # Default ke FFmpeg reader untuk brand lain/unv
        reader_fn = ffmpeg_reader_generator

    def is_crossing_line(prev_point, curr_point, a, b):
        def side(p, a, b):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        # Periksa apakah kedua titik berada di sisi yang berbeda dari garis
        return side(prev_point, a, b) * side(curr_point, a, b) < 0

    print(f"Starting detection for CCTV: {cctv_name} (ID: {cctv_id}) from {rtsp_url}")

    try:
        if cctv_name not in yolo_models:
            print(f"[{cctv_name}] Loading YOLO model 'best.pt'...")
            # PENTING: Jika Anda ingin YOLO berjalan di CPU, gunakan .to('cpu')
            # yolo_models[cctv_name] = YOLO('best.pt').to('cpu')
            yolo_models[cctv_name] = YOLO('best.pt').to('cuda') # Sesuaikan dengan hardware Anda
            print(f"[{cctv_name}] YOLO model loaded.")
        model = yolo_models[cctv_name]
    except Exception as e:
        print(f"[{cctv_name}] Gagal load model YOLO: {e}")
        with cctv_info["lock"]:
            cctv_info["is_running"] = False
            cctv_info["latest_frame"] = None
        return

    tracked_objects = {}
    counter_in = {cls: 0 for cls in class_names.keys()}
    counter_out = {cls: 0 for cls in class_names.keys()}

    while cctv_info["is_running"]: # Loop utama untuk menjaga thread tetap hidup
        try:
            reader = reader_fn(rtsp_url)
            # Loop untuk mencoba mendapatkan frame dan memproses
            for frame in reader:
                if not cctv_info["is_running"]:
                    print(f"[{cctv_name}] Stopping detection thread as requested.")
                    break # Keluar dari inner loop

                results = model.track(frame, persist=True, classes=list(class_names.keys()), conf=0.3, iou=0.7, verbose=False) # verbose=False untuk mengurangi log YOLO
                frame_copy = frame.copy()
                line_color = (0, 0, 255) # Default Red

                if results and results[0].boxes.id is not None:
                    for box, obj_id_tensor, cls_id_tensor in zip(results[0].boxes.xyxy, results[0].boxes.id, results[0].boxes.cls):
                        x1, y1, x2, y2 = map(int, box)
                        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                        obj_id = int(obj_id_tensor)
                        cls_id = int(cls_id_tensor)
                        class_name = class_names.get(cls_id, "Unknown")

                        prev_point = tracked_objects.get(obj_id)
                        curr_point = (cx, cy)
                        tracked_objects[obj_id] = curr_point

                        if prev_point and is_crossing_line(prev_point, curr_point, p1, p2):
                            line_color = (0, 255, 0) # Green for crossing
                            if direction_mode in ["IN", "BOTH"]:
                                counter_in[cls_id] += 1
                                post_detection_to_backend(cctv_id, class_name, "IN", frame_copy)
                            if direction_mode in ["OUT", "BOTH"]:
                                counter_out[cls_id] += 1
                                post_detection_to_backend(cctv_id, class_name, "OUT", frame_copy)



                        color_map = {
                            "Mobil": (0, 204, 255), # Light blue
                            "Motor": (255, 153, 0), # Orange
                            "Bus": (255, 51, 51),    # Red
                            "Truk": (102, 255, 102)  # Light green
                        }
                        color = color_map.get(class_name, (255, 255, 255)) # Default white

                        # Gambar bounding box & label
                        cv2.rectangle(frame_copy, (x1, y1), (x2, y2), color, 1) # Ketebalan bounding box
                        cv2.circle(frame_copy, (cx, cy), 3, (0, 0, 255), -1) # Titik tengah
                        label = f'{class_name}'
                        font_scale = 0.3
                        font = cv2.FONT_HERSHEY_SIMPLEX
                        (tw, th), _ = cv2.getTextSize(label, font, font_scale, 1)
                        cv2.rectangle(frame_copy, (x1, y1 - th - 5), (x1 + tw + 5, y1), color, -1)
                        cv2.putText(frame_copy, label, (x1 + 2, y1 - 2), font, font_scale, (0, 0, 0), 1)

                cv2.line(frame_copy, p1, p2, line_color, 1) # Gambar garis dengan ketebalan 2

                # Perbarui latest_frame di cctv_streams_info
                with cctv_info["lock"]:
                    cctv_info["latest_frame"] = frame_copy

                time.sleep(0.01) # Sesuaikan jika CPU tinggi

            # Jika loop reader berakhir, coba reconnect
            if cctv_info["is_running"]: # Hanya coba reconnect jika thread belum diminta berhenti
                print(f"[{cctv_name}] Stream ended unexpectedly. Attempting to reconnect...")
                time.sleep(2) # Tunggu sebentar sebelum mencoba lagi
            else:
                break # Keluar dari outer loop jika diminta berhenti

        except Exception as e:
            print(f"[{cctv_name}] General error in detection loop: {e}")
            if cctv_info["is_running"]:
                time.sleep(2) # Tunggu sebelum mencoba lagi
            else:
                break
        finally:
            print(f"[{cctv_name}] Detection thread fully terminated and cleaned up.")
            with cctv_info["lock"]:
                cctv_info["is_running"] = False
                cctv_info["latest_frame"] = None


# --- Endpoint FastAPI untuk Streaming Video ---
@app.get("/video_feed/{cctv_name}")
async def video_feed(cctv_name: str):
    """
    Endpoint FastAPI untuk streaming video MJPEG.
    """
    if cctv_name not in cctv_streams_info:
        raise HTTPException(status_code=404, detail="CCTV not found or not initialized.")

    cctv_info = cctv_streams_info[cctv_name]

    async def generate_frames_for_http():
        while cctv_info["is_running"]:
            with cctv_info["lock"]:
                frame = cctv_info["latest_frame"]

            if frame is None:
                await asyncio.sleep(0.1)
                continue

            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ret:
                print(f"Error encoding frame for {cctv_name} in streaming response. Retrying...")
                await asyncio.sleep(0.05)
                continue

            frame_bytes = buffer.tobytes()

            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n'
                   b'Content-Length: ' + f"{len(frame_bytes)}".encode() + b'\r\n'
                   b'\r\n' + frame_bytes + b'\r\n')

            await asyncio.sleep(0.03)


    try:
        # Jika thread deteksi belum berjalan, mulai.
        # Ini akan memicu koneksi ulang jika stream terputus
        if not cctv_info["is_running"]:
            print(f"Starting detection thread for {cctv_name} as it was not running.")
            cctv_info["is_running"] = True
            threading.Thread(target=run_detection_and_update_frame_buffer, args=(cctv_name,)).start()
            await asyncio.sleep(1) # Beri waktu agar thread mulai mengisi buffer

        return StreamingResponse(
            generate_frames_for_http(),
            media_type="multipart/x-mixed-replace; boundary=frame"
        )
    except Exception as e:
        print(f"Error during video streaming for {cctv_name}: {e}")
        raise HTTPException(status_code=500, detail="Error streaming video")

# --- Endpoint API Proxy ke Django (READ-ONLY untuk client web) ---
# Endpoint ini tetap untuk GET (membaca data) dari Django
@app.get("/api/detections/")
async def get_detections(start_date: str = None, end_date: str = None, vehicle_type: str = None, direction: str = None, cctv_name: str = None):
    try:
        params = {}
        if start_date: params["start_date"] = start_date
        if end_date: params["end_date"] = end_date
        if vehicle_type: params["vehicle_type"] = vehicle_type
        if direction: params["direction"] = direction
        if cctv_name: params["cctv_name"] = cctv_name

        response = requests.get(f"{DJANGO_API_BASE_URL}/api/detections/", params=params)
        response.raise_for_status()
        return JSONResponse(content=response.json())
    except requests.exceptions.RequestException as e:
        print(f"Error fetching detections from Django: {e}")
        raise HTTPException(status_code=500, detail="Could not fetch detections from Django backend.")

@app.get("/api/cctv/")
async def get_all_cctv():
    try:
        response = requests.get(f"{DJANGO_API_BASE_URL}/api/cctv/")
        response.raise_for_status()
        return JSONResponse(content=response.json())
    except requests.exceptions.RequestException as e:
        print(f"Error fetching CCTV data from Django: {e}")
        raise HTTPException(status_code=500, detail="Could not fetch CCTV data from Django backend.")

# --- Startup Event Handler ---
@app.on_event("startup")
async def startup_event():
    print("FastAPI starting up...")
    try:
        response = requests.get(f"{DJANGO_API_BASE_URL}/api/cctv/")
        response.raise_for_status()
        cameras_config = response.json()

        for cam in cameras_config:
            cctv_name = cam["name"]
            cctv_streams_info[cctv_name] = {
                "id": cam["id"],
                "rtsp_url": cam["rtsp_url"],
                "brand": cam.get("brand", "unv"),
                "direction_mode": cam.get("direction_mode", "BOTH"),
                "line_start": (cam.get("line_start_x", 0), cam.get("line_start_y", 0)),
                "line_end": (cam.get("line_end_x", 640), cam.get("line_end_y", 360)),
                "is_running": False,
                "latest_frame": None,
                "lock": threading.Lock()
            }
            print(f"Initialized CCTV config for: {cctv_name}")
            # --- MULAI THREAD DETEKSI UNTUK SETIAP CCTV SAAT STARTUP SERVER ---
            # Ini memastikan server secara otomatis mulai memproses semua CCTV
            # tanpa menunggu permintaan dari frontend.
            print(f"Starting detection thread for {cctv_name} on startup...")
            cctv_streams_info[cctv_name]["is_running"] = True
            threading.Thread(target=run_detection_and_update_frame_buffer, args=(cctv_name,)).start()

    except requests.exceptions.RequestException as e:
        print(f"Error fetching CCTV config from Django on startup: {e}")
        print("Pastikan Django backend berjalan dan dapat diakses di:", DJANGO_API_BASE_URL)
    except Exception as e:
        print(f"An unexpected error occurred during startup: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="10.69.69.52", port=8001)