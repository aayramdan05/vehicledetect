from ultralytics import YOLO
import os

def main():
    # Hindari fragmentasi memori CUDA (opsional, tapi disarankan)
    os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

    # Gunakan model ringan + konfigurasi efisien
    model = YOLO("yolov8n.pt")
    model.train(
        data="dataset/BigVehicle/data.yaml",
        epochs=100,
        imgsz=640,          # lebih ringan dari 640
        batch=16,            # sebelumnya 16 -> terlalu besar
        project="runs",
        name="yolo-big-vehicle-detection",
        device="cuda",      # gunakan GPU
        exist_ok=True,
        save_dir="runs/train_model_yolo"
    )

if __name__ == '__main__':
    main()
