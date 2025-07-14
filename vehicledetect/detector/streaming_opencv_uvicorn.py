from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
import cv2
import asyncio

app = FastAPI()

# Ganti dengan RTSP kamu
RTSP_URL = "rtsp://admin:D!p4t1nangor@10.67.18.248/media/video0"  # isi sesuai kebutuhan

# Fungsi generator frame
def generate_frames():
    cap = cv2.VideoCapture(RTSP_URL, cv2.CAP_FFMPEG)

    if not cap.isOpened():
        raise RuntimeError("Cannot open RTSP stream")

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    while True:
        success, frame = cap.read()
        if not success:
            break
        # JPEG encode
        ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ret:
            continue
        frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

    cap.release()

# Endpoint video streaming
@app.get("/video_feed")
async def video_feed():
    return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

# Halaman HTML sederhana untuk test
@app.get("/", response_class=HTMLResponse)
async def root():
    return """
    <html>
        <head>
            <title>RTSP Stream</title>
        </head>
        <body>
            <h2>Streaming dari CCTV</h2>
            <img src="/video_feed" width="720" />
        </body>
    </html>
    """
