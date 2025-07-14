import os
import cv2
from ultralytics import YOLO
from tqdm import tqdm # Tetap digunakan untuk progress bar yang bagus, meski hanya satu file

# --- KONFIGURASI PATH ---
VIDEO_DIR = r"C:\Users\YOLO\Desktop\Exported Videos"
# Definisikan nama file video spesifik yang ingin diproses
SPECIFIC_VIDEO_FILE = "Gerbang D - Camera 1 - 1920 x 1080 - 5fps_20250626_070100.avi" 

IMAGE_OUT_DIR = r"C:\Car Detection\vehicledetect\dataset\v3\images"
LABEL_OUT_DIR = r"C:\Car Detection\vehicledetect\dataset\v3\labels"
FRAME_INTERVAL_SEC = 2   # ambil 1 frame tiap 2 detik
MODEL_PATH = "yolov8l.pt" # Pastikan model ini sudah dilatih dengan kelas yang benar

# Buat direktori output jika belum ada
os.makedirs(IMAGE_OUT_DIR, exist_ok=True)
os.makedirs(LABEL_OUT_DIR, exist_ok=True)

# Muat model YOLO
model = YOLO(MODEL_PATH)

# --- FOKUS PADA SATU VIDEO SPESIFIK ---
video_to_process = os.path.join(VIDEO_DIR, SPECIFIC_VIDEO_FILE)

# Verifikasi apakah file video yang ditargetkan ada
if not os.path.exists(video_to_process):
    print(f"❌ File video tidak ditemukan: {video_to_process}")
    print("Pastikan nama file dan path sudah benar.")
else:
    print(f"Mulai auto-labeling untuk video: {SPECIFIC_VIDEO_FILE}")
    
    cap = cv2.VideoCapture(video_to_process)

    if not cap.isOpened():
        print(f"❌ Gagal buka {video_to_process}")
    else:
        fps = cap.get(cv2.CAP_PROP_FPS)
        # Pastikan fps tidak nol untuk menghindari ZeroDivisionError
        if fps == 0:
            print(f"❌ FPS untuk video {SPECIFIC_VIDEO_FILE} adalah 0. Tidak dapat melanjutkan.")
            cap.release()
        else:
            interval = int(fps * FRAME_INTERVAL_SEC)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            frame_count = 0
            save_count = 0

            # Gunakan tqdm untuk progress bar berdasarkan total_frames
            with tqdm(total=total_frames, desc=f"Processing {SPECIFIC_VIDEO_FILE}") as pbar:
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break

                    if frame_count % interval == 0:
                        # Nama file output berdasarkan nama video asli + urutan frame
                        filename_base = os.path.splitext(SPECIFIC_VIDEO_FILE)[0]
                        filename = f"{filename_base}_{save_count:04}.jpg"
                        image_path = os.path.join(IMAGE_OUT_DIR, filename)
                        label_path = os.path.join(LABEL_OUT_DIR, filename.replace(".jpg", ".txt"))

                        # Simpan frame
                        cv2.imwrite(image_path, frame)

                        # Deteksi dengan YOLOv8
                        # Note: `source=frame` menerima numpy array. `predict` akan secara otomatis memprosesnya.
                        # `imgsz=1080` atau resolusi lain yang sesuai jika model dilatih pada resolusi tersebut
                        results = model.predict(source=frame, save=False, conf=0.3, iou=0.5, imgsz=1920)[0] 
                        # Sesuaikan imgsz dengan resolusi asli video Anda atau resolusi model Anda
                        # Dalam kasus ini video 1920x1080, jadi imgsz=1920 akan menskalakan ke 1920x1920 (padded)

                        with open(label_path, "w") as f:
                            # Iterasi melalui setiap bounding box yang terdeteksi
                            for box in results.boxes:
                                cls_id = int(box.cls[0])
                                # Pastikan hanya kelas yang relevan yang disimpan jika perlu filtering
                                # Contoh: if cls_id in [0, 1, 2, 3]: # Mobil, Motor, Bus, Truk sesuai class_names Anda
                                x1, y1, x2, y2 = box.xyxy[0].tolist() # Convert tensor ke list
                                
                                # Dapatkan dimensi frame yang sebenarnya setelah resize oleh YOLO predict jika imgsz digunakan
                                # Jika imgsz digunakan, frame akan diubah ukurannya sebelum prediksi.
                                # bbox koordinat output dari YOLO predict adalah dalam skala gambar input ke model
                                # Untuk annotasi Yolo format (normalized), kita butuh dimensi frame
                                # yang digunakan saat prediksi (yaitu, frame yang di-resize oleh YOLO)
                                # Namun, karena kita tidak resize frame secara manual di sini,
                                # h dan w adalah dimensi frame_copy asli.
                                h_frame, w_frame = frame.shape[:2] # Ambil tinggi dan lebar frame asli

                                x_center = ((x1 + x2) / 2) / w_frame
                                y_center = ((y1 + y2) / 2) / h_frame
                                box_width = (x2 - x1) / w_frame
                                box_height = (y2 - y1) / h_frame

                                # Tulis anotasi dalam format YOLO (class_id x_center y_center width height)
                                f.write(f"{cls_id} {x_center:.6f} {y_center:.6f} {box_width:.6f} {box_height:.6f}\n")

                        save_count += 1

                    frame_count += 1
                    pbar.update(1) # Update progress bar

            cap.release()
            print(f"✅ Auto-labeling selesai untuk {SPECIFIC_VIDEO_FILE}.")