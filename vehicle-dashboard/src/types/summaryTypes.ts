// src/types/summaryTypes.ts (atau di bagian atas SummaryTable.tsx)

// Tipe data untuk setiap baris di tabel ringkasan yang baru
export interface DailySummaryRow {
  vehicleType: string;
  totalCount: number;
  [cctvDirectionKey: string]: number | string; // Contoh: "CAM.RK30.03 (IN)", "CAM.RK30.03 (OUT)"
}

// Perbarui SummaryTableProps
export interface SummaryTableProps {
  // Anda masih membutuhkan ini untuk tampilan total di bawah tabel (jika masih relevan setelah filtering)
  actualTodayTotal: number | string; // Allow string or number
  actualTodayInOut: { IN: number; OUT: number };

  todayDateFormatted: string; // Hanya untuk hari ini

  knownCCTVs: string[]; // Daftar CCTV yang diketahui (jika ada)
  knownVehicleTypes: string[]; // Daftar jenis kendaraan yang diketahui (jika ada)

  // Tambahkan prop cctvList untuk dropdown filter
  cctvList: { name: string; location: string }[];

  // Props yang terkait dengan data ringkasan harian/kemarin mungkin perlu disesuaikan
  // atau dihapus jika SummaryTable akan fetch datanya sendiri berdasarkan filter
  pieChartCounts: any; // Sesuaikan tipenya
  pieChartCountsYesterday: any; // Sesuaikan tipenya
  yesterdayDateFormatted: string;
  actualYesterdayTotal: number | string; // Allow string or number
  actualYesterdayInOut: { IN: number; OUT: number };
}