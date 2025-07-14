"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import ChartHeader from "@/components/ui/ChartHeader";
import VehicleChart from "@/components/ui/VehicleChart";

type Detection = {
  timestamp: string;
  vehicle_type: string;
  cctv_name: string;
  direction: string;
};

type ChartData = {
  timestamp: string;
  [vehicleType: string]: number | string;
};

// --- PERUBAHAN UTAMA DI SINI: PERBARUI PROPS INTERFACE ---
type ChartSectionProps = {
  cctvName: string;
  direction: string;
  startDate: string; // Tambahkan ini
  endDate: string;   // Tambahkan ini
  vehicleType: string; // Tambahkan ini
};

// --- Perbarui parameter fungsi untuk menerima props baru ---
export default function ChartSection({ cctvName, direction, startDate, endDate, vehicleType }: ChartSectionProps) {
  const [selectedChart, setSelectedChart] = useState<"bar" | "line">("line");
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [selectedDate, setSelectedDate] = useState(startDate); // Inisialisasi selectedDate dengan startDate dari props

  // Gunakan useEffect untuk mengambil data chart
  useEffect(() => {
    const fetchData = () => {
      const params = new URLSearchParams();

      // --- SERTAKAN FILTER BARU SAAT MEMBANGUN URL ---
      if (startDate) {
        params.append('start_date', startDate);
      }
      if (endDate) {
        params.append('end_date', endDate);
      }
      if (vehicleType) {
        params.append('vehicle_type', vehicleType);
      }
      // Hati-hati dengan 'Semua' jika backend Anda tidak menginterpretasikannya sebagai filter kosong
      if (cctvName && cctvName !== "Semua") {
        params.append('cctv_name', cctvName);
      }
      if (direction) {
        params.append('direction', direction);
      }

      // Gunakan selectedDate dari state internal ChartSection, atau fallback ke startDate dari props
      // Karena `selectedDate` akan menjadi input `type="date"` lokal untuk ChartSection.
      if (selectedDate) {
        params.append('date', selectedDate); // Asumsi backend Anda punya filter 'date'
                                             // ATAU Anda bisa gunakan `start_date` saja untuk hari itu
      } else { // Jika selectedDate belum dipilih, gunakan startDate dari props sebagai default
          params.append('start_date', startDate);
          params.append('end_date', startDate); // Untuk memastikan hanya satu hari jika selectedDate kosong
      }


      const queryString = params.toString();
      const url = `http://10.69.69.52:8000/api/detections/${queryString ? `?${queryString}` : ''}`;

      console.log("Fetching Chart data from: ", url);

      axios.get<Detection[]>(url)
        .then((res) => {
          const raw = res.data;
          console.log("Sample Raw Chart Data: ", raw);

          // Gunakan selectedDate untuk memproses data
          // Jika selectedDate kosong, gunakan startDate dari props sebagai default untuk processing
          const dateToProcess = selectedDate || startDate;

          // Ambil semua jenis kendaraan unik dari data yang sudah difilter oleh backend
          // Penting: 'detections' dari response sudah difilter oleh backend
          const allVehicleTypes = Array.from(new Set(raw.map((d) => d.vehicle_type)));

          // Inisialisasi setiap jam dari 00:00 - 23:00
          const hourlyTemplate: Record<string, ChartData> = {};
          for (let i = 0; i < 24; i++) {
            const hour = String(i).padStart(2, "0");
            const timeKey = `${hour}:00`;
            hourlyTemplate[timeKey] = { timestamp: timeKey };
            allVehicleTypes.forEach((v) => {
              hourlyTemplate[timeKey][v] = 0;
            });
          }

          // Proses data yang sudah difilter dari backend
          // TIDAK ADA FILTER SISI KLIEN LAGI DI SINI, karena backend sudah memfilter
          raw.forEach((item) => {
            const dateObj = new Date(item.timestamp);
            const itemDate = dateObj.toISOString().split("T")[0];

            // Pastikan item sesuai dengan selectedDate (jika diubah secara lokal di ChartSection)
            // Namun, sebagian besar filter sudah dari backend
            if (itemDate !== dateToProcess) return;

            const hour = String(dateObj.getHours()).padStart(2, "0");
            const time = `${hour}:00`;
            const vehicle = item.vehicle_type;

            (hourlyTemplate[time][vehicle] as number) += 1;
          });

          const sorted = Object.values(hourlyTemplate).sort((a, b) =>
            a.timestamp > b.timestamp ? 1 : -1
          );

          console.log("Final Chart Data for rendering: ", sorted);
          setChartData(sorted);
        })
        .catch((err) => {
          console.error("Error fetching chart data: ", err);
        });
    };

    fetchData(); // Panggil fetchData segera

    // Hati-hati dengan interval di sini jika ingin real-time.
    // Jika data chart hanya perlu di-refresh saat filter berubah, Anda bisa hapus interval ini.
    // Jika tetap ingin real-time, biarkan interval, tapi perhatikan beban server.
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);

    // --- DEPENDENSI UNTUK `useEffect` BARU ---
  }, [cctvName, direction, startDate, endDate, vehicleType, selectedDate]); // Tambahkan semua props dan state lokal yang memengaruhi pengambilan data

  return (
    <div className="bg-white rounded-xl shadow p-4 text-xs space-y-4">
      {/* Filter tanggal internal ChartSection */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Filter tanggal:</label>
        <input
          type="date"
          // Pastikan input ini mengambil nilai dari state `selectedDate` lokal
          // dan bukan dari `startDate` props, karena ini adalah filter tanggal spesifik ChartSection
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border px-2 py-1 rounded"
        />
      </div>

      {/* Header dan Chart */}
      <ChartHeader
        selectedChart={selectedChart}
        setSelectedChart={setSelectedChart}
        cctvName={cctvName}
        // Gunakan `selectedDate` lokal untuk display di header Chart
        date={selectedDate || new Date().toLocaleDateString("id-ID")}
        direction={direction}
      />

      <VehicleChart data={chartData} type={selectedChart} />
    </div>
  );
}