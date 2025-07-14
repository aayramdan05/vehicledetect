import os
import cv2
from ultralytics import YOLO
from tqdm import tqdm

VIDEO_DIR = r"C:\Users\YOLO\Desktop\Exported Videos"
IMAGE_OUT_DIR = r"C:\Car Detection\vehicledetect\dataset\v2\images"
LABEL_OUT_DIR = r"C:\Car Detection\vehicledetect\dataset\v2\labels"
FRAME_INTERVAL_SEC = 2  # ambil 1 frame tiap 2 detik
MODEL_PATH = "yolov8l.pt"

os.makedirs(IMAGE_OUT_DIR, exist_ok=True)
os.makedirs(LABEL_OUT_DIR, exist_ok=True)

model = YOLO(MODEL_PATH)
video_files = [f for f in os.listdir(VIDEO_DIR) if f.lower().endswith(".avi")]

for video_file in tqdm(video_files, desc="Processing videos"):
    video_path = os.path.join(VIDEO_DIR, video_file)
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        print(f"❌ Gagal buka {video_path}")
        continue

    fps = cap.get(cv2.CAP_PROP_FPS)
    interval = int(fps * FRAME_INTERVAL_SEC)
    frame_count = 0
    save_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_count % interval == 0:
            filename = f"{os.path.splitext(video_file)[0]}_{save_count:04}.jpg"
            image_path = os.path.join(IMAGE_OUT_DIR, filename)
            label_path = os.path.join(LABEL_OUT_DIR, filename.replace(".jpg", ".txt"))

            # Simpan frame
            cv2.imwrite(image_path, frame)

            # Deteksi dengan YOLOv8
            results = model.predict(source=frame, save=False, conf=0.3, iou=0.5)[0]

            with open(label_path, "w") as f:
                for box in results.boxes:
                    cls_id = int(box.cls[0])
                    x1, y1, x2, y2 = box.xyxy[0]
                    h, w = frame.shape[:2]
                    x_center = ((x1 + x2) / 2) / w
                    y_center = ((y1 + y2) / 2) / h
                    box_width = (x2 - x1) / w
                    box_height = (y2 - y1) / h
                    f.write(f"{cls_id} {x_center:.6f} {y_center:.6f} {box_width:.6f} {box_height:.6f}\n")

            save_count += 1

        frame_count += 1

    cap.release()

print("✅ Auto-labeling selesai.")
