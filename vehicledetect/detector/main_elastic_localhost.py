# main.py

from fastapi import FastAPI, Request, HTTPException, Depends, Query # Tambahkan Depends
from typing import Optional, List, Dict, Any
from fastapi.responses import StreamingResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import asyncio
import numpy as np
import threading
import time
import requests
import io
import imageio_ffmpeg
import traceback
from datetime import datetime, timedelta, timezone # Tambahkan date, timedelta
from ultralytics import YOLO
import os
import subprocess
import json # <--- PENTING: Tambahkan ini

# --- Import Elasticsearch client ---
from elasticsearch import Elasticsearch, AsyncElasticsearch, NotFoundError # <--- PENTING: Import AsyncElasticsearch juga

app = FastAPI()

# --- KONFIGURASI UNTUK DJANGO BACKEND ---
DJANGO_API_BASE_URL = "http://10.69.69.52:8000"
# --- KONFIGURASI UNTUK ELASTICSEARCH ---
ELASTICSEARCH_HOST = "https://10.69.69.52:9200"
ELASTICSEARCH_INDEX_PREFIX = "logs-iot.vehicle-counter"
ELASTICSEARCH_USERNAME = "elastic"
ELASTICSEARCH_PASSWORD = "DKH+22*+mtmIO2YRnS=X"

# HAPUS inisialisasi es_client global di sini, karena akan menggunakan Dependency Injection
# es_client = Elasticsearch(...)

# Konfigurasi CORS agar frontend Next.js bisa mengakses API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://10.69.69.52:3000", "http://localhost:3000", "https://10.69.69.52:9200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Dependency untuk Elasticsearch Client Asinkron ---
# Ini akan digunakan oleh endpoint FastAPI yang bersifat async
async def get_async_es_client():
    es_async_client = AsyncElasticsearch(
        ELASTICSEARCH_HOST,
        basic_auth=(ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD),
        verify_certs=False # Gunakan ini dengan HATI-HATI jika ada masalah sertifikat, idealnya diselesaikan dengan sertifikat CA yang benar.
    )
    try:
        yield es_async_client
    finally:
        # Pastikan koneksi ditutup dengan baik setelah request selesai
        await es_async_client.close()


# --- Global Dictionaries dan Locks ---
cctv_streams_info = {}
yolo_models = {}

# Perbarui class_names sesuai dengan training model 'best.pt' Anda
class_names = {0: "Mobil", 1: "Motor", 2: "Bus", 3: "Truk"}


# --- Fungsi untuk Posting Deteksi ke Backend (Elasticsearch) ---
# Fungsi ini dijalankan di thread terpisah, sehingga harus menggunakan klien Elasticsearch SINKRON
def post_detection_to_backend(cctv_name_from_detection: str, vehicle_type: str, direction: str, frame=None):
    def send():
        # Inisialisasi klien sinkron di dalam thread ini
        # Ini penting karena thread ini tidak berada dalam event loop asyncio FastAPI
        local_es_client = Elasticsearch(
            ELASTICSEARCH_HOST,
            basic_auth=(ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD),
            verify_certs=False
        )
        try:
            cctv_info = cctv_streams_info.get(cctv_name_from_detection)
            if not cctv_info:
                print(f"[{cctv_name_from_detection}] ERROR: Informasi CCTV tidak ditemukan untuk deteksi ini. Melewatkan pengiriman ke ES.")
                return

            cctv_id_for_es = cctv_info["id"]
            cctv_brand_for_es = cctv_info.get("brand", "unknown")
            location_for_es = cctv_info.get("location_description", "Unknown Location")

            # Menggunakan ELASTICSEARCH_INDEX_PREFIX yang baru
            elastic_index_name = f"{ELASTICSEARCH_INDEX_PREFIX}" # Ini sudah benar untuk data stream
            
            # Gunakan datetime.now() tanpa timezone, lalu tambahkan 'Z' agar sesuai format ISO 8601 UTC
            timestamp_iso = datetime.now().isoformat(timespec='milliseconds') + 'Z' 

            data = {
                "@timestamp": timestamp_iso, 
                "cctv": cctv_id_for_es,
                "cctv_name": cctv_name_from_detection, 
                "brand": cctv_brand_for_es, 
                "location": location_for_es, 
                "vehicle_type": vehicle_type,
                "direction": direction,
            }

            # Mengirim data ke Elasticsearch menggunakan klien Python SINKRON
            response = local_es_client.index(index=elastic_index_name, document=data)
            
            if response['result'] in ['created', 'updated']:
                print(f"[{cctv_name_from_detection}] POST ke Elasticsearch BERHASIL: {response['result']}")
            else:
                print(f"[{cctv_name_from_detection}] POST ke Elasticsearch GAGAL: {response}")
        except Exception as e:
            print(f"[{cctv_name_from_detection}] Gagal kirim deteksi ke Elasticsearch: {e}")
        finally:
            # Pastikan untuk menutup klien sinkron setelah digunakan
            local_es_client.close() 
        
    threading.Thread(target=send).start()


# --- Fungsi Pembaca Video (FFmpeg dan OpenCV) ---
# ... (ffmpeg_reader_generator, opencv_reader_generator, imageio_reader_generator tetap sama) ...
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
            "-fflags", "nobuffer", 
            "-flags", "low_delay", 
            "-an", 
            "-preset", "ultrafast", 
            "-", 
        ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10**8)

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
                    pipe.wait(timeout=3)
                time.sleep(2)
                pipe = start_pipe()
                continue

            frame = np.frombuffer(raw_frame, np.uint8).reshape((h, w, 3))
            yield frame
            retries = 0

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
        nonlocal cap
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            print(f"[OPENCV] Gagal membuka koneksi VideoCapture dari {rtsp_url}.")
            return False
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 3)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        print(f"[OPENCV] VideoCapture dimulai untuk {rtsp_url}. Resolusi: {cap.get(cv2.CAP_PROP_FRAME_WIDTH)}x{cap.get(cv2.CAP_PROP_FRAME_HEIGHT)}")
        return True

    if not connect_cap():
        print(f"[OPENCV] Gagal koneksi awal untuk {rtsp_url}. Thread mungkin akan berhenti.")
        return

    while retries < reconnect_attempts:
        ret, frame = cap.read()
        if ret:
            if frame.shape[1] != w or frame.shape[0] != h:
                frame = cv2.resize(frame, (w, h))
            yield frame
            retries = 0
        else:
            print(f"[OPENCV] Gagal membaca frame dari {rtsp_url} (retries={retries+1}). Mencoba reconnect...")
            retries += 1
            if cap:
                cap.release()
            time.sleep(2)
            if not connect_cap():
                if retries >= reconnect_attempts:
                    print(f"[OPENCV] Gagal reconnect setelah {reconnect_attempts} percobaan. Menghentikan stream untuk {rtsp_url}.")
                    break
                else:
                    continue

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
# ... (run_detection_and_update_frame_buffer tetap sama) ...
def run_detection_and_update_frame_buffer(cctv_name: str):
    cctv_info = cctv_streams_info[cctv_name]
    cctv_id = cctv_info['id']
    rtsp_url = cctv_info['rtsp_url']
    direction_mode = cctv_info.get("direction_mode", "BOTH").upper()
    p1 = cctv_info["line_start"]
    p2 = cctv_info["line_end"]
    brand = cctv_info.get('brand', 'unv').lower()
    location_desc = cctv_info.get('location_description', 'Unknown Location')

    if brand == 'axis':
        reader_fn = opencv_reader_generator
    elif brand == 'hikvision':
        reader_fn = imageio_reader_generator
    else:
        reader_fn = ffmpeg_reader_generator

    def is_crossing_line(prev_point, curr_point, a, b):
        def side(p, a, b):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        return side(prev_point, a, b) * side(curr_point, a, b) < 0

    print(f"Starting detection for CCTV: {cctv_name} (ID: {cctv_id}) from {rtsp_url}")

    try:
        if cctv_name not in yolo_models:
            print(f"[{cctv_name}] Loading YOLO model 'best.pt'...")
            yolo_models[cctv_name] = YOLO('best.pt').to('cuda')
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

    while cctv_info["is_running"]:
        try:
            reader = reader_fn(rtsp_url)
            for frame in reader:
                if not cctv_info["is_running"]:
                    print(f"[{cctv_name}] Stopping detection thread as requested.")
                    break

                results = model.track(frame, persist=True, classes=list(class_names.keys()), conf=0.3, iou=0.7, verbose=False)
                frame_copy = frame.copy()
                line_color = (0, 0, 255)

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
                            line_color = (0, 255, 0)
                            if direction_mode in ["IN", "BOTH"]:
                                counter_in[cls_id] += 1
                                post_detection_to_backend(
                                    cctv_name_from_detection=cctv_name, 
                                    vehicle_type=class_name, 
                                    direction="IN", 
                                    frame=frame_copy
                                )
                            if direction_mode in ["OUT", "BOTH"]:
                                counter_out[cls_id] += 1
                                post_detection_to_backend(
                                    cctv_name_from_detection=cctv_name, 
                                    vehicle_type=class_name, 
                                    direction="OUT", 
                                    frame=frame_copy
                                )

                        color_map = {
                            "Mobil": (0, 204, 255),
                            "Motor": (255, 153, 0),
                            "Bus": (255, 51, 51),
                            "Truk": (102, 255, 102)
                        }
                        color = color_map.get(class_name, (255, 255, 255))

                        cv2.rectangle(frame_copy, (x1, y1), (x2, y2), color, 1)
                        cv2.circle(frame_copy, (cx, cy), 3, (0, 0, 255), -1)
                        label = f'{class_name}'
                        font_scale = 0.3
                        font = cv2.FONT_HERSHEY_SIMPLEX
                        (tw, th), _ = cv2.getTextSize(label, font, font_scale, 1)
                        cv2.rectangle(frame_copy, (x1, y1 - th - 5), (x1 + tw + 5, y1), color, -1)
                        cv2.putText(frame_copy, label, (x1 + 2, y1 - 2), font, font_scale, (0, 0, 0), 1)

                cv2.line(frame_copy, p1, p2, line_color, 1)

                with cctv_info["lock"]:
                    cctv_info["latest_frame"] = frame_copy

                time.sleep(0.01)

            if cctv_info["is_running"]:
                print(f"[{cctv_name}] Stream ended unexpectedly. Attempting to reconnect...")
                time.sleep(2)
            else:
                break

        except Exception as e:
            print(f"[{cctv_name}] General error in detection loop: {e}")
            if cctv_info["is_running"]:
                time.sleep(2)
            else:
                break
        finally:
            print(f"[{cctv_name}] Detection thread fully terminated and cleaned up.")
            with cctv_info["lock"]:
                cctv_info["is_running"] = False
                cctv_info["latest_frame"] = None


# --- Endpoint FastAPI untuk Streaming Video ---
# ... (video_feed tetap sama) ...
@app.get("/video_feed/{cctv_name}")
async def video_feed(cctv_name: str):
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
        if not cctv_info["is_running"]:
            print(f"Starting detection thread for {cctv_name} as it was not running.")
            cctv_info["is_running"] = True
            threading.Thread(target=run_detection_and_update_frame_buffer, args=(cctv_name,)).start()
            await asyncio.sleep(1)

        return StreamingResponse(
            generate_frames_for_http(),
            media_type="multipart/x-mixed-replace; boundary=frame"
        )
    except Exception as e:
        print(f"Error during video streaming for {cctv_name}: {e}")
        raise HTTPException(status_code=500, detail="Error streaming video")


# --- Endpoint API untuk mengambil data agregasi dari Elasticsearch ---
@app.get("/api/detection/")
async def get_detections(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    direction: Optional[str] = Query(None, description="Detection direction (IN/OUT)"),
    cctv_name: Optional[str] = Query(None, description="Name of the CCTV"),
    vehicle_type: Optional[str] = Query(None, description="Type of vehicle (Motor, Mobil, Truk)"), # Ini yang Anda minta
    interval: Optional[str] = Query("1h", description="Aggregation interval (e.g., 1h, 1d, 30m)"),
    es_client: AsyncElasticsearch = Depends(get_async_es_client)
) -> List[Dict[str, Any]]:
    try:
        # Konversi tanggal ke format ISO 8601 dengan zona waktu Z (UTC)
        start_datetime_utc = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end_datetime_utc = (datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1, seconds=-1)).replace(tzinfo=timezone.utc)

        # Inisialisasi daftar filter untuk query.bool.must
        must_filters = [
            {
                "range": {
                    "@timestamp": {
                        "gte": start_datetime_utc.isoformat(timespec='seconds'),
                        "lte": end_datetime_utc.isoformat(timespec='seconds')
                    }
                }
            }
        ]

        # Tambahkan filter direction jika ada
        if direction:
            must_filters.append({"match": {"direction": direction}})

        # Tambahkan filter cctv_name jika ada
        if cctv_name:
            must_filters.append({"match": {"cctv_name": cctv_name}})

        # Tambahkan filter vehicle_type jika ada
        if vehicle_type: # Ini adalah bagian yang menambahkan filter vehicle_type
            must_filters.append({"match": {"vehicle_type": vehicle_type}})

        es_query_body = {
            "size": 0, # Tidak perlu mengembalikan dokumen, hanya agregasi
            "query": {
                "bool": {
                    "must": must_filters # Gunakan daftar filter yang sudah dibuat
                }
            },
            "aggs": {
                "by_cctv_name": {
                    "terms": {
                        "field": "cctv_name",
                        "size": 100
                    },
                    "aggs": {
                        "by_direction": {
                            "terms": {
                                "field": "direction",
                                "size": 10
                            },
                            "aggs": {
                                "by_vehicle_type": {
                                    "terms": {
                                        "field": "vehicle_type",
                                        "size": 20
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        search_results = await es_client.search(
            index=ELASTICSEARCH_INDEX_PREFIX,
            body=es_query_body
        )

        
        detection_summary = []

        # Contoh sederhana untuk mengembalikan agregasi (Anda mungkin sudah punya logika yang lebih kompleks)
        # Ini hanya untuk tujuan demonstrasi bahwa data ada di respons ES
        if 'aggregations' in search_results.body and \
           'by_cctv_name' in search_results.body['aggregations'] and \
           search_results.body['aggregations']['by_cctv_name']['buckets']: # Check if buckets exist and are not empty
            
            for cctv_bucket in search_results.body['aggregations']['by_cctv_name']['buckets']:
                cctv_name = cctv_bucket['key']
                
                # Check if by_direction buckets exist
                if 'by_direction' in cctv_bucket and cctv_bucket['by_direction']['buckets']:
                    for direction_bucket in cctv_bucket['by_direction']['buckets']:
                        direction = direction_bucket['key']
                        
                        # Check if by_vehicle_type buckets exist
                        if 'by_vehicle_type' in direction_bucket and direction_bucket['by_vehicle_type']['buckets']:
                            for vehicle_type_bucket in direction_bucket['by_vehicle_type']['buckets']:
                                vehicle_type = vehicle_type_bucket['key']
                                doc_count = vehicle_type_bucket['doc_count']
                                
                                detection_summary.append({
                                    "cctv_name": cctv_name,
                                    "direction": direction,
                                    "vehicle_type": vehicle_type,
                                    "count": doc_count
                                })
        
        # --- This is the key change ---
        return detection_summary # Always return the list, even if it's empty
        # --- End of key change ---

    except Exception as e:
        print(f"ERROR: Exception caught while fetching detection data from Elasticsearch: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Could not fetch detection data from Elasticsearch: {e}")

# --- Endpoint API untuk mengambil daftar CCTV dari Elasticsearch ---
@app.get("/api/cctv/")
async def get_all_cctv(
    es_client: AsyncElasticsearch = Depends(get_async_es_client) # <--- PENTING: Dependency Injection
):
    try:
        query_body = {
            "size": 0, # Tidak perlu mengembalikan dokumen, hanya agregasi
            "aggs": {
                "unique_cctvs": {
                    "terms": {
                        "field": "cctv_name", # Agregasi berdasarkan nama CCTV
                        "size": 100 # Batas jumlah CCTV unik yang dikembalikan
                    },
                    "aggs": {
                        "latest_cctv_info": {
                            "top_hits": { # Ambil satu dokumen terbaru untuk mendapatkan brand dan location
                                "size": 1,
                                "sort": [{"@timestamp": {"order": "desc"}}],
                                "_source": ["cctv", "cctv_name", "brand", "location"] 
                            }
                        }
                    }
                }
            }
        }
        
        # --- DEBUGGING TAMBAHAN ---
        # print(f"DEBUG: Query body sent to Elasticsearch for /api/cctv/: {json.dumps(query_body, indent=2)}")
        # print(f"DEBUG: Index targeted for /api/cctv/: {ELASTICSEARCH_INDEX_PREFIX}-*") # Target pola untuk top_hits
        
        # Lakukan pencarian agregasi di Elasticsearch menggunakan klien ASINKRON
        # Untuk get_all_cctv yang pakai top_hits, pola *-* kadang diperlukan untuk memastikan semua backing index tercover.
        search_results = await es_client.search(index=f"{ELASTICSEARCH_INDEX_PREFIX}", body=query_body) 

        # --- DEBUGGING TAMBAHAN ---
        print(f"DEBUG: Raw Elasticsearch response for /api/cctv/: {json.dumps(search_results.body, indent=2)}") 

        cctv_list = []
        if 'aggregations' in search_results and 'unique_cctvs' in search_results['aggregations']:
            for bucket in search_results['aggregations']['unique_cctvs']['buckets']:
                if bucket['latest_cctv_info']['hits']['hits']:
                    cctv_info_source = bucket['latest_cctv_info']['hits']['hits'][0]['_source']
                    cctv_list.append({
                        "id": cctv_info_source.get("cctv"),
                        "name": cctv_info_source.get("cctv_name"),
                        "brand": cctv_info_source.get("brand"),
                        "location": cctv_info_source.get("location") 
                    })
        
        return JSONResponse(content=cctv_list)
    except NotFoundError:
        print("WARNING: Elasticsearch index/data stream not found for /api/cctv/.")
        return JSONResponse(content=[], status_code=200)
    except Exception as e:
        print(f"ERROR: Exception caught while fetching CCTV data from Elasticsearch: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Could not fetch CCTV data from Elasticsearch.")

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
                "lock": threading.Lock(),
                "location_description": cam.get("location", "Unknown Location")
            }
            print(f"Initialized CCTV config for: {cctv_name}")
            
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