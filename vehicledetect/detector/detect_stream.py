from ultralytics import YOLO
import cv2
import numpy as np
import subprocess
import time
import requests
import io
import threading
from datetime import datetime

# Konfigurasi API
API_CCTV_URL = "http://localhost:8000/api/cctv/"
API_DETECTION_URL = "http://localhost:8000/api/detections/"
CCTV_ID = 1  # Ganti sesuai ID CCTV di database

# Ambil RTSP dari API
def get_cctv_info(cctv_id):
    try:
        response = requests.get(f"{API_CCTV_URL}{cctv_id}/")
        response.raise_for_status()
        data = response.json()
        return data.get("rtsp_url"), data.get("type")  # contoh field "type": "unv" atau "axis"
    except Exception as e:
        print("Gagal ambil info CCTV:", e)
        return None, None


# Kirim hasil deteksi ke API
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
            files = {
                'frame_image': ('frame.jpg', frame_bytes, 'image/jpeg')
            }

            r = requests.post(API_DETECTION_URL, data=data, files=files)
            if r.status_code != 201:
                print("POST gagal:", r.status_code, r.text)
            else:
                print("POST berhasil:", r.status_code)
        except Exception as e:
            print("Gagal kirim deteksi:", e)

    # Jalankan di thread terpisah
    threading.Thread(target=send).start()

# Stream RTSP via ffmpeg
def ffmpeg_reader(rtsp_url):
    command = [
        "ffmpeg", '-rtsp_transport', 'tcp', '-i', rtsp_url,
        '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-vf', 'scale=1280:720', '-'
    ]
    pipe = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10**8)
    width, height = 1280, 720
    frame_size = width * height * 3

    while True:
        raw_frame = pipe.stdout.read(frame_size)
        if len(raw_frame) != frame_size:
            break
        frame = np.frombuffer(raw_frame, np.uint8).reshape((height, width, 3))
        yield frame
    pipe.terminate()

def opencv_reader(rtsp_url):
    cap = cv2.VideoCapture(rtsp_url)
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        # Resize frame ke 1280x720
        frame = cv2.resize(frame, (1280, 720))
        yield frame
    cap.release()

# Fungsi utama
def main():
    rtsp_url, cctv_type = get_cctv_info(CCTV_ID)
    if not rtsp_url:
        print("RTSP URL tidak ditemukan.")
        return

    # Pilih reader sesuai jenis CCTV
    if cctv_type == "unv":
        reader = ffmpeg_reader
    else:
        reader = opencv_reader

    prev_time = time.time()
    line_position = 420
    tracked_objects = {}

    class_names = {2: "Mobil", 3: "Motor", 5: "Bus", 7: "Truk"}
    counter_in = {cls: 0 for cls in class_names}
    counter_out = {cls: 0 for cls in class_names}

    for frame in reader(rtsp_url):
        results = model.track(frame, persist=True, classes=list(class_names.keys()))
        frame_copy = frame.copy()

        if results[0].boxes.id is not None:
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
                        post_detection(CCTV_ID, class_name, "OUT", frame_copy)
                    elif prev_cy > line_position and cy <= line_position:
                        counter_in[cls_id] += 1
                        post_detection(CCTV_ID, class_name, "IN", frame_copy)

                cv2.rectangle(frame_copy, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.circle(frame_copy, (cx, cy), 5, (0, 0, 255), -1)
                cv2.putText(frame_copy, f'ID:{int(obj_id)} {class_name}', (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)

        # Garis & FPS
        cv2.line(frame_copy, (0, line_position), (frame_copy.shape[1], line_position), (255, 0, 0), 2)
        current_time = time.time()
        fps = 1 / (current_time - prev_time) if prev_time else 0
        prev_time = current_time
        cv2.putText(frame_copy, f"FPS: {fps:.2f}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        # Panel statistik
        panel_width = 400
        panel_info = np.zeros((frame_copy.shape[0], panel_width, 3), dtype=np.uint8)
        y_offset = 50
        for cls_id, name in class_names.items():
            masuk = counter_in[cls_id]
            keluar = counter_out[cls_id]
            cv2.putText(panel_info, f'{name}', (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
            cv2.putText(panel_info, f'Masuk : {masuk}', (20, y_offset + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
            cv2.putText(panel_info, f'Keluar: {keluar}', (20, y_offset + 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            y_offset += 100

        combined = cv2.hconcat([frame_copy, panel_info])
        cv2.imshow("Deteksi Kendaraan + Statistik", combined)
        if cv2.waitKey(1) & 0xFF == 27:
            break

    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
