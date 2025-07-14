# api_backend.py

from fastapi import FastAPI, HTTPException, Depends, Query
from typing import Optional, List, Dict, Any
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import traceback
from datetime import datetime, timedelta, timezone
import json

# --- Import Elasticsearch client ASINKRON ---
from elasticsearch import AsyncElasticsearch, NotFoundError

app = FastAPI()

# --- KONFIGURASI ELASTICSEARCH (Duplikasi atau bisa diletakkan di config file terpisah) ---
ELASTICSEARCH_HOST = "https://10.69.69.52:9200"
ELASTICSEARCH_INDEX_PREFIX = "logs-iot.vehicle-counter"
ELASTICSEARCH_USERNAME = "elastic"
ELASTICSEARCH_PASSWORD = "DKH+22*+mtmIO2YRnS=X"

# Konfigurasi CORS agar frontend Next.js bisa mengakses API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://10.69.69.52:3000", "http://localhost:3000"], # Tambahkan URL frontend yang relevan
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Dependency untuk Elasticsearch Client Asinkron ---
async def get_async_es_client():
    es_async_client = AsyncElasticsearch(
        ELASTICSEARCH_HOST,
        basic_auth=(ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD),
        verify_certs=False # Gunakan ini dengan HATI-HATI jika ada masalah sertifikat, idealnya diselesaikan dengan sertifikat CA yang benar.
    )
    try:
        yield es_async_client
    finally:
        await es_async_client.close()

# --- Endpoint API untuk mengambil data agregasi dari Harian Elasticsearch ---
@app.get("/api/detection/summary_daily/")
async def get_detections_daily_summary(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    direction: Optional[str] = Query(None, description="Detection direction (IN/OUT)"),
    cctv_name: Optional[str] = Query(None, description="Name of the CCTV"),
    vehicle_type: Optional[str] = Query(None, description="Type of vehicle (Motor, Mobil, Truk)"),
    es_client: AsyncElasticsearch = Depends(get_async_es_client)
) -> List[Dict[str, Any]]:
    try:
        start_datetime_utc = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end_datetime_utc = (datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1, seconds=-1)).replace(tzinfo=timezone.utc)

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

        if direction:
            must_filters.append({"match": {"direction": direction}})

        if cctv_name:
            must_filters.append({"match": {"cctv_name": cctv_name}})

        if vehicle_type:
            must_filters.append({"match": {"vehicle_type": vehicle_type}})

        es_query_body = {
            "size": 0,
            "query": {
                "bool": {
                    "must": must_filters
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

        # print(f"DEBUG: Query body sent to Elasticsearch for /api/detection/summary_daily/: {json.dumps(es_query_body, indent=2)}")
        search_results = await es_client.search(
            index=ELASTICSEARCH_INDEX_PREFIX,
            body=es_query_body
        )
        # print(f"DEBUG: Raw Elasticsearch response for /api/detection/summary_daily/: {json.dumps(search_results.body, indent=2)}")

        detection_summary = []
        if 'aggregations' in search_results.body and \
           'by_cctv_name' in search_results.body['aggregations'] and \
           search_results.body['aggregations']['by_cctv_name']['buckets']:
            
            for cctv_bucket in search_results.body['aggregations']['by_cctv_name']['buckets']:
                cctv_name_key = cctv_bucket['key']
                
                if 'by_direction' in cctv_bucket and cctv_bucket['by_direction']['buckets']:
                    for direction_bucket in cctv_bucket['by_direction']['buckets']:
                        direction_key = direction_bucket['key']
                        
                        if 'by_vehicle_type' in direction_bucket and direction_bucket['by_vehicle_type']['buckets']:
                            for vehicle_type_bucket in direction_bucket['by_vehicle_type']['buckets']:
                                vehicle_type_key = vehicle_type_bucket['key']
                                doc_count = vehicle_type_bucket['doc_count']
                                
                                detection_summary.append({
                                    "cctv_name": cctv_name_key,
                                    "direction": direction_key,
                                    "vehicle_type": vehicle_type_key,
                                    "count": doc_count,
                                    "date": start_date # Tambahkan tanggal agar jelas ini agregasi harian
                                })
        
        return detection_summary 

    except Exception as e:
        print(f"ERROR: Exception caught while fetching daily detection data from Elasticsearch: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Could not fetch daily detection data from Elasticsearch: {e}")


# --- Endpoint API untuk mengambil data agregasi dari per Jam Elasticsearch ---
@app.get("/api/detection/summary_hourly/")
async def get_detections_hourly_summary(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    direction: Optional[str] = Query(None, description="Detection direction (IN/OUT)"),
    cctv_name: Optional[str] = Query(None, description="Name of the CCTV"),
    vehicle_type: Optional[str] = Query(None, description="Type of vehicle (Motor, Mobil, Truk)"),
    es_client: AsyncElasticsearch = Depends(get_async_es_client)
) -> List[Dict[str, Any]]:
    try:
        start_datetime_utc = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end_datetime_utc = (datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1, seconds=-1)).replace(tzinfo=timezone.utc)

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

        if direction:
            must_filters.append({"match": {"direction": direction}})

        if cctv_name:
            must_filters.append({"match": {"cctv_name": cctv_name}})

        if vehicle_type:
            must_filters.append({"match": {"vehicle_type": vehicle_type}})

        es_query_body = {
            "size": 0,
            "query": {
                "bool": {
                    "must": must_filters
                }
            },
            "aggs": {
                "detections_per_hour": {
                    "date_histogram": {
                        "field": "@timestamp",
                        "fixed_interval": "1h",
                        "min_doc_count": 0,
                        "extended_bounds": {
                            "min": int(start_datetime_utc.timestamp() * 1000),
                            "max": int(end_datetime_utc.timestamp() * 1000)
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
            }
        }

        # print(f"DEBUG: Query body sent to Elasticsearch for /api/detection/summary_hourly/: {json.dumps(es_query_body, indent=2)}")
        search_results = await es_client.search(
            index=ELASTICSEARCH_INDEX_PREFIX,
            body=es_query_body
        )
        # print(f"DEBUG: Raw Elasticsearch response for /api/detection/summary_hourly/: {json.dumps(search_results.body, indent=2)}")

        detection_summary = []
        if 'aggregations' in search_results.body and \
           'detections_per_hour' in search_results.body['aggregations'] and \
           search_results.body['aggregations']['detections_per_hour']['buckets']:
            
            for hour_bucket in search_results.body['aggregations']['detections_per_hour']['buckets']:
                hour_timestamp_ms = hour_bucket['key']
                hour_datetime_obj = datetime.fromtimestamp(hour_timestamp_ms / 1000, tz=timezone.utc)
                hour_iso_format = hour_datetime_obj.isoformat(timespec='seconds')

                hour_has_data = False

                if 'by_cctv_name' in hour_bucket and hour_bucket['by_cctv_name']['buckets']:
                    for cctv_bucket in hour_bucket['by_cctv_name']['buckets']:
                        cctv_name_key = cctv_bucket['key']
                        
                        if 'by_direction' in cctv_bucket and cctv_bucket['by_direction']['buckets']:
                            for direction_bucket in cctv_bucket['by_direction']['buckets']:
                                direction_key = direction_bucket['key']
                                
                                if 'by_vehicle_type' in direction_bucket and direction_bucket['by_vehicle_type']['buckets']:
                                    for vehicle_type_bucket in direction_bucket['by_vehicle_type']['buckets']:
                                        vehicle_type_key = vehicle_type_bucket['key']
                                        doc_count = vehicle_type_bucket['doc_count']
                                        
                                        detection_summary.append({
                                            "hour": hour_iso_format,
                                            "cctv_name": cctv_name_key,
                                            "direction": direction_key,
                                            "vehicle_type": vehicle_type_key,
                                            "count": doc_count
                                        })
                                        hour_has_data = True
                
                if not hour_has_data and hour_bucket['doc_count'] == 0:
                    detection_summary.append({
                        "hour": hour_iso_format,
                        "cctv_name": cctv_name or "N/A",
                        "direction": direction or "N/A",
                        "vehicle_type": vehicle_type or "N/A",
                        "count": 0
                    })
        
        return detection_summary 

    except Exception as e:
        print(f"ERROR: Exception caught while fetching hourly detection data from Elasticsearch: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Could not fetch hourly detection data from Elasticsearch: {e}")

# --- Endpoint API untuk mengambil daftar CCTV dari Elasticsearch ---
@app.get("/api/cctv/")
async def get_all_cctv(
    es_client: AsyncElasticsearch = Depends(get_async_es_client)
) -> JSONResponse: # Mengembalikan JSONResponse secara eksplisit
    try:
        query_body = {
            "size": 0, 
            "aggs": {
                "unique_cctvs": {
                    "terms": {
                        "field": "cctv_name", 
                        "size": 100 
                    },
                    "aggs": {
                        "latest_cctv_info": {
                            "top_hits": { 
                                "size": 1,
                                "sort": [{"@timestamp": {"order": "desc"}}],
                                "_source": ["cctv", "cctv_name", "brand", "location"] 
                            }
                        }
                    }
                }
            }
        }
        
        search_results = await es_client.search(index=f"{ELASTICSEARCH_INDEX_PREFIX}", body=query_body) 
        # print(f"DEBUG: Raw Elasticsearch response for /api/cctv/: {json.dumps(search_results.body, indent=2)}") 

        cctv_list = []
        # Perhatikan: 'aggregations' ada di search_results.body, bukan langsung search_results
        if 'aggregations' in search_results.body and 'unique_cctvs' in search_results.body['aggregations']:
            for bucket in search_results.body['aggregations']['unique_cctvs']['buckets']:
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
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Could not fetch CCTV data from Elasticsearch.")


if __name__ == "__main__":
    import uvicorn
    # Jalankan API Backend di port 8002
    uvicorn.run(app, host="10.69.69.52", port=8002)