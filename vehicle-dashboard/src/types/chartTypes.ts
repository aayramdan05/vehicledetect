// src/types/chartTypes.ts

// Definisi untuk data mentah yang diterima dari API summary_hourly
export type DetectionHourlyAPI = {
  hour: string;
  vehicle_type: string;
  cctv_name: string;
  direction: string;
  count: number;
};

// Definisi untuk data yang sudah diformat untuk Recharts
export type ChartData = {
  time: string; // Akan digunakan sebagai dataKey untuk XAxis (contoh: "00:00")
  [vehicleType: string]: number | string; // Properti dinamis untuk tipe kendaraan (contoh: "Mobil": 120, "Motor": 50)
};