import requests

API_CCTV_URL = "http://localhost:8000/api/cctv/1/"  # ID=1 atau sesuai isi

def get_rtsp_url(cctv_id):
    try:
        response = requests.get(f"{API_CCTV_URL}")
        response.raise_for_status()
        return response.json().get("rtsp_url")
    except Exception as e:
        print("Gagal ambil RTSP:", e)
        return None

rtsp = get_rtsp_url(1)
print("RTSP:", rtsp)
