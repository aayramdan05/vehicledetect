import cv2
import numpy as np
import subprocess
import time
import requests
import io
import threading
from datetime import datetime
from ultralytics import YOLO
import os
import tkinter as tk

# Konfigurasi API
API_CCTV_URL = "http://localhost:8000/api/cctv/"
API_DETECTION_URL = "http://localhost:8000/api/detections/"

# Class kendaraan yang dideteksi
class_names = {2: "Mobil", 3: "Motor", 5: "Bus", 7: "Truk"}

def post_detection(cctv_id, vehicle_type, direction, frame):
    def send():
        try:
            _, buffer = cv2.imencode('.jpg', frame)
            frame_bytes = io.BytesIO(buffer).getvalue()

            data = {
                "cctv": cctv_id,
                "vehicle_type": vehicle_type,
                "direction": direction,
                "timestamp": datetime.now().isoformat()
            }
            files = {'frame_image': ('frame.jpg', frame_bytes, 'image/jpeg')}

            r = requests.post(API_DETECTION_URL, data=data, files=files)
            if r.status_code != 201:
                print(f"[{cctv_id}] POST gagal:", r.status_code, r.text)
            else:
                print(f"[{cctv_id}] POST berhasil:", r.status_code)
        except Exception as e:
            print(f"[{cctv_id}] Gagal kirim deteksi:", e)
    threading.Thread(target=send).start()

def ffmpeg_reader(rtsp_url):
    command = [
        "ffmpeg", '-rtsp_transport', 'tcp', '-i', rtsp_url,
        '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-vf', 'scale=640:360', '-'
    ]
    pipe = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10**8)
    width, height = 640, 360
    frame_size = width * height * 3

    while True:
        raw_frame = pipe.stdout.read(frame_size)
        if len(raw_frame) != frame_size:
            break
        frame = np.frombuffer(raw_frame, np.uint8).reshape((height, width, 3))
        yield frame
    pipe.terminate()

def opencv_reader(rtsp_url):
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 3)
    cap.set(cv2.CAP_PROP_FPS, 15)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.resize(frame, (640, 360))
        yield frame
    cap.release()

def run_stream(cctv_id, rtsp_url, line_position, reader_fn, on_fail_callback):
    try:
        model = YOLO('yolov8n.pt').to('cuda')
    except Exception as e:
        print(f"[{cctv_id}] Gagal load model YOLO:", e)
        on_fail_callback(cctv_id)
        return

    tracked_objects = {}
    counter_in = {cls: 0 for cls in class_names}
    counter_out = {cls: 0 for cls in class_names}
    prev_time = time.time()

    try:
        reader = reader_fn(rtsp_url)
        for frame in reader:
            results = model.track(frame, persist=True, classes=list(class_names.keys()))
            frame_copy = frame.copy()
            line_color = (0, 0, 255)  # merah awal
            line_crossed = False

            if results[0].boxes.id is not None:
                # Ganti bagian dalam loop run_stream:
                for box, obj_id, cls_id in zip(results[0].boxes.xyxy, results[0].boxes.id, results[0].boxes.cls):
                    x1, y1, x2, y2 = map(int, box)
                    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                    cls_id = int(cls_id)
                    class_name = class_names.get(cls_id, "Unknown")

                    prev_cy = tracked_objects.get(int(obj_id), None)
                    tracked_objects[int(obj_id)] = cy

                    if prev_cy is not None:
                        if prev_cy < line_position and cy >= line_position:
                            counter_out[cls_id] += 1
                            post_detection(cctv_id, class_name, "OUT", frame_copy)
                            line_color = (0, 255, 0)
                            line_crossed = True
                        elif prev_cy > line_position and cy <= line_position:
                            counter_in[cls_id] += 1
                            post_detection(cctv_id, class_name, "IN", frame_copy)
                            line_color = (0, 255, 0)
                            line_crossed = True

                    # Warna per kelas (contoh gradasi warna)
                    color_map = {
                        "Mobil": (0, 204, 255),
                        "Motor": (255, 153, 0),
                        "Bus": (255, 51, 51),
                        "Truk": (102, 255, 102)
                    }
                    color = color_map.get(class_name, (255, 255, 255))

                    # Gambar bounding box tipis & label kecil
                    cv2.rectangle(frame_copy, (x1, y1), (x2, y2), color, 1)  # thinner line
                    cv2.circle(frame_copy, (cx, cy), 3, (0, 0, 255), -1)
                    label = f'{class_name} #{int(obj_id)}'
                    font_scale = 0.4
                    font = cv2.FONT_HERSHEY_SIMPLEX
                    (tw, th), _ = cv2.getTextSize(label, font, font_scale, 1)
                    cv2.rectangle(frame_copy, (x1, y1 - th - 4), (x1 + tw + 4, y1), color, -1)
                    cv2.putText(frame_copy, label, (x1 + 2, y1 - 2), font, font_scale, (0, 0, 0), 1)

            height, width = frame.shape[:2]
            cv2.line(frame_copy, (0, line_position - 25), (width, line_position + 25), line_color, 1)
            # reset warna
            if line_crossed:
                line_color = (0, 0, 255)
                line_crossed = False
            panel_info = np.zeros((frame.shape[0], 350, 3), dtype=np.uint8)
            y_offset = 50
            for cls_id, name in class_names.items():
                masuk = counter_in[cls_id]
                keluar = counter_out[cls_id]
                cv2.putText(panel_info, f'{name}', (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
                cv2.putText(panel_info, f'IN : {masuk}', (20, y_offset + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.putText(panel_info, f'OUT: {keluar}', (20, y_offset + 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                y_offset += 90

            combined = cv2.hconcat([frame_copy, panel_info])
            cv2.imshow(f'CCTV {cctv_id}', combined)
            if cv2.waitKey(1) & 0xFF == 27:
                break
    except Exception as e:
        print(f"[{cctv_id}] Gagal stream: {e}")
        on_fail_callback(cctv_id)

    cv2.destroyAllWindows()

def main():
    window = tk.Tk()
    window.title("CCTV Monitor")
    window.geometry("500x400")

    status_text = tk.StringVar()
    status_text.set("Memuat daftar CCTV...")

    label = tk.Label(window, textvariable=status_text, wraplength=400, justify="center")
    label.pack(pady=10)

    buttons_frame = tk.Frame(window)
    buttons_frame.pack()

    def restart_stream(cctv_id, rtsp_url, line_pos, reader_fn, btn):
        status_text.set(f"Memulai ulang CCTV {cctv_id}...")
        btn.config(state=tk.DISABLED)
        threading.Thread(target=run_stream, args=(cctv_id, rtsp_url, line_pos, reader_fn, lambda cid=cctv_id: on_fail(cid, btn))).start()

    def on_fail(cctv_id, btn):
        status_text.set(f"CCTV {cctv_id} gagal diakses. Klik restart.")
        btn.config(state=tk.NORMAL)

    try:
        response = requests.get(API_CCTV_URL)
        response.raise_for_status()
        cameras = response.json()
    except Exception as e:
        status_text.set("Gagal ambil daftar CCTV: " + str(e))
        return

    if not cameras:
        status_text.set("Tidak ada data CCTV ditemukan.")
        return

    for cam in cameras:
        cctv_id = cam["id"]
        rtsp_url = cam.get("rtsp_url")
        line_pos = cam.get("line_position", 420)
        cctv_type = cam.get("type", "unv").lower()
        reader = ffmpeg_reader if cctv_type == "unv" else opencv_reader

        if not rtsp_url:
            continue

        # Buat tombol restart untuk masing-masing stream
        btn = tk.Button(buttons_frame, text=f"Restart CCTV {cctv_id}", state=tk.DISABLED)
        btn.pack(pady=5)

        btn.config(command=lambda cid=cctv_id, url=rtsp_url, pos=line_pos, rdr=reader, b=btn: restart_stream(cid, url, pos, rdr, b))

        # Jalankan stream langsung
        threading.Thread(target=run_stream, args=(cctv_id, rtsp_url, line_pos, reader, lambda cid=cctv_id: on_fail(cid, btn))).start()

    window.mainloop()

if __name__ == "__main__":
    main()