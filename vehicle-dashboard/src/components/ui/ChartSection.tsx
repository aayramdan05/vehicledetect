// src/components/ui/ChartSection.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { parseISO, format } from "date-fns";
import { toZonedTime, formatInTimeZone } from 'date-fns-tz'; // Pastikan sudah menginstal date-fns-tz
import { id } from "date-fns/locale";

import ChartHeader from "@/components/ui/ChartHeader";
import VehicleChart from "@/components/ui/VehicleChart";

// --- IMPOR DEFINISI TIPE DARI FILE TERPUSAT ---
import { DetectionHourlyAPI, ChartData } from "@/types/chartTypes";

interface ChartSectionProps {
  cctvName: string;
  direction: string;
  selectedDate: string;
  vehicleType: string;
}

const KNOWN_VEHICLE_TYPES = ["Mobil", "Motor", "Truk", "Bus"];

export default function ChartSection({
  cctvName,
  direction,
  selectedDate,
  vehicleType,
}: ChartSectionProps) {
  const [selectedChart, setSelectedChart] = useState<"bar" | "line">("line");
  const [chartData, setChartData] = useState<ChartData[]>([]);

  const FASTAPI_BASE_URL = 'http://10.69.69.52:8002';
  const TARGET_TIME_ZONE = 'UTC'; 

  useEffect(() => {
    const fetchData = async () => {
      const params = new URLSearchParams();

      // Gunakan selectedDate, atau fallback ke tanggal saat ini jika kosong
      const dateToFetch = selectedDate || format(new Date(), 'yyyy-MM-dd');
      
      params.append('start_date', dateToFetch);
      params.append('end_date', dateToFetch);
      
      // Tambahkan parameter hanya jika nilainya spesifik (bukan "All" atau "Semua")
      if (vehicleType && vehicleType !== "All" && vehicleType !== "Semua") {
        params.append('vehicle_type', vehicleType);
      }
      if (cctvName && cctvName !== "All" && cctvName !== "Semua") {
        params.append('cctv_name', cctvName);
      }
      if (direction && direction !== "All" && direction !== "Semua") {
        params.append('direction', direction);
      }

      const queryString = params.toString();
      const url = `${FASTAPI_BASE_URL}/api/detection/summary_hourly/${queryString ? `?${queryString}` : ''}`;

      console.log("Fetching Chart data from: ", url);

      try {
        const res = await axios.get<DetectionHourlyAPI[]>(url);
        console.log("Data mentah terbaru dari API:", res.data);
        const raw = res.data;

        const hourlyAggregatedData: Record<string, ChartData> = {};
        // Inisialisasi data untuk semua 24 jam dengan count 0
        for (let i = 0; i < 24; i++) {
          const hourKey = String(i).padStart(2, "0");
          const timeLabel = `${hourKey}:00`;
          hourlyAggregatedData[timeLabel] = { time: timeLabel };
          
          KNOWN_VEHICLE_TYPES.forEach((vType) => {
            hourlyAggregatedData[timeLabel][vType] = 0;
          });
        }

        // Agregasi data dari respons API
        raw.forEach((item) => {
          const dateObj = parseISO(item.hour);
          // Ekstrak jam dalam konteks UTC untuk menghindari pergeseran zona waktu lokal
          const hourLabel = formatInTimeZone(dateObj, TARGET_TIME_ZONE, 'HH:00');
          
          if (item.vehicle_type !== "N/A" && KNOWN_VEHICLE_TYPES.includes(item.vehicle_type) && hourlyAggregatedData[hourLabel]) {
            (hourlyAggregatedData[hourLabel][item.vehicle_type] as number) += item.count;
          }
        });

        // Urutkan data berdasarkan jam
        const sortedChartData = Object.values(hourlyAggregatedData).sort((a, b) => {
            const hourA = parseInt((a.time as string).substring(0, 2));
            const hourB = parseInt((b.time as string).substring(0, 2));
            return hourA - hourB;
        });

        console.log("Final Chart Data for rendering: ", sortedChartData);
        setChartData(sortedChartData);

      } catch (err) {
        console.error("Error fetching chart data: ", err);
        setChartData([]); // Kosongkan data jika ada error
      }
    };

    // Ini adalah kunci: fetchData() akan dijalankan hanya ketika ada perubahan pada salah satu dependencies di array ini.
    // Tidak ada setInterval di sini, sehingga tidak ada refresh otomatis berbasis waktu.
    fetchData(); 

  }, [cctvName, direction, vehicleType, selectedDate, FASTAPI_BASE_URL]); // Dependencies adalah filter yang masuk

  return (
    <div className="bg-white rounded-xl shadow p-4 text-xs space-y-4">
      <ChartHeader
        selectedChart={selectedChart}
        setSelectedChart={setSelectedChart}
        cctvName={cctvName}
        date={selectedDate ? format(parseISO(selectedDate), 'dd MMMM yyyy', { locale: id }) : 'Pilih Tanggal'}
        direction={direction}
      />

      <VehicleChart data={chartData} type={selectedChart} />
    </div>
  );
}