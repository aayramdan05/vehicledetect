// src/components/ui/SummaryTable.tsx
import React from "react";
import Image from "next/image";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "./table"; // Pastikan path ini benar dan komponen Table, TableBody, dll. tersedia

// --- INTERFACES ---
interface SummaryTableProps {
  pieChartCounts: Record<string, number>; // Total count per vehicle type (e.g., {'Mobil': 500})
  pieChartCountsYesterday: Record<string, number>; // Digunakan untuk Pie Chart, tidak di tabel utama
  todayDateFormatted: string;
  yesterdayDateFormatted: string; // Digunakan untuk box 'Kemarin' di bawah tabel

  actualTodayTotal: number; // Total keseluruhan hari ini
  actualYesterdayTotal: number; // Total keseluruhan kemarin
  actualTodayInOut: { IN: number; OUT: number }; // Total IN/OUT keseluruhan hari ini
  actualYesterdayInOut: { IN: number; OUT: number }; // Total IN/OUT keseluruhan kemarin

  isLoading: boolean; // Status loading dari Dashboard.tsx
  
  // Prop baru untuk detail IN/OUT per jenis kendaraan
  todayVehicleInOutDetails: Record<string, { IN: number; OUT: number }>;
  yesterdayVehicleInOutDetails: Record<string, { IN: number; OUT: number }>;
  summaryDisplayDate: string; // Mungkin tidak digunakan di tabel utama, tapi baik dipass
}

// Komponen Spinner sederhana
const Spinner = () => (
  <div className="flex justify-center items-center h-4 w-4">
    <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  </div>
);

// Komponen Placeholder Skeleton untuk teks
const SkeletonText = ({ width = 'w-1/2', height = 'h-4' }) => (
    <div className={`bg-gray-200 animate-pulse rounded ${width} ${height}`}></div>
);


export default function SummaryTable({
  pieChartCounts,
  pieChartCountsYesterday, 
  todayDateFormatted,
  yesterdayDateFormatted,
  summaryDisplayDate,
  actualTodayTotal,
  actualYesterdayTotal,
  actualTodayInOut,
  actualYesterdayInOut,
  isLoading, 
  todayVehicleInOutDetails, // Destructure prop baru
  yesterdayVehicleInOutDetails,
   // Destructure prop baru
}: SummaryTableProps) {
              
  return (
    <div className="space-y-4">
      {/* Ringkasan Hari Ini - Tabel Utama */}
      <div className="bg-white rounded-xl shadow p-4 space-y-2">
        <h2 className="text-base font-semibold mb-2">Ringkasan
          <span className="ml-2 text-gray-500 font-medium text-xs">{summaryDisplayDate}</span>
        </h2> {/* Tambah tanggal di judul */}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="max-w-full overflow-x-auto">
            <div className="min-w-[400px]">
              <Table>
                <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                  <TableRow>
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                    >
                      Kendaraan
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-end text-theme-xs dark:text-gray-400"
                    >
                      Jumlah
                    </TableCell>
                    {/* Kolom perbandingan dengan kemarin dihapus */}
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-end text-theme-xs dark:text-gray-400"
                    >
                      IN
                    </TableCell>
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-end text-theme-xs dark:text-gray-400"
                    >
                      OUT
                    </TableCell>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {/* Hapus semua kondisi `isLoading ? (<Skeleton />) : (...)` */}
                  {Object.keys(pieChartCounts).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="px-5 py-4 text-center text-gray-500">
                        Tidak ada data deteksi untuk rentang tanggal ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    Object.entries(pieChartCounts).map(([vehicleType, count]) => {
                      const vehicleTypeInOut = todayVehicleInOutDetails?.[vehicleType] ?? { IN: 0, OUT: 0 };
                      return (
                        <TableRow key={vehicleType}>
                          <TableCell className="px-5 py-4 sm:px-6 text-start">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 overflow-hidden rounded-full flex-shrink-0">
                                <Image
                                  width={32}
                                  height={32}
                                  src={`/images/vehicle/${vehicleType.toLowerCase()}.png`}
                                  alt={vehicleType}
                                />
                              </div>
                              <span className="block font-medium text-gray-800 text-theme-sm dark:text-white/90">
                                {vehicleType}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-gray-500 text-end text-theme-sm dark:text-gray-400">
                            {count.toLocaleString('id-ID')}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-gray-500 text-end text-theme-sm dark:text-gray-400">
                            {typeof vehicleTypeInOut.IN === 'number' ? vehicleTypeInOut.IN.toLocaleString('id-ID') : '-'}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-gray-500 text-end text-theme-sm dark:text-gray-400">
                            {typeof vehicleTypeInOut.OUT === 'number' ? vehicleTypeInOut.OUT.toLocaleString('id-ID') : '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>

      {/* --- INI ADALAH BAGIAN YANG BERUBAH --- */}
      {/* Container untuk Box Hari Ini dan Kemarin yang berdampingan */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* Box Hari Ini */}
        <div className="bg-white rounded-xl shadow p-4 flex-1">
          <div className="p-0">
            <div className="flex items-baseline mb-2">
              <span className="font-medium truncate">Total Hari Ini</span>
              <span className="ml-2 text-gray-500 font-medium text-xs">{todayDateFormatted}</span>
            </div>
            <div className="mt-2 text-sm text-gray-600 items-center"> {/* Tambahkan flex justify-between items-center */}
              <div> {/* Bungkus "IN" dalam div */}
                {/* IN: Panah Kanan Hijau */}
                <span className="font-bold text-green-600">
                  &#x2192; {/* Panah kanan */}
                </span>{" "}
                {/* {isLoading ? (
                  <Spinner />
                ) : ( */}
                  <span className="font-bold text-green-600">
                    {actualTodayInOut.IN.toLocaleString('id-ID')}
                  </span>
                {/* )} */}
              </div>
              <div> {/* Bungkus "OUT" dalam div */}
                {/* OUT: Panah Kiri Merah */}
                <span className="font-bold text-red-600">
                  &#x2190; {/* Panah kiri */}
                </span>{" "}
                {/* {isLoading ? (
                  <Spinner />
                ) : ( */}
                  <span className="font-bold text-red-600">
                    {actualTodayInOut.OUT.toLocaleString('id-ID')}
                  </span>
                {/* )} */}
              </div>
            </div>

            <span className="block my-3 text-sm font-medium text-gray-500">Total Keseluruhan</span>
            <span className="text-3xl block font-medium text-secondary-style">
              {/* {isLoading ? <Spinner /> : actualTodayTotal.toLocaleString('id-ID')} */}
              {actualTodayTotal.toLocaleString('id-ID')}
            </span>
          </div>
        </div>

        {/* Box Kemarin */}
        <div className="bg-white rounded-xl shadow p-4 flex-1">
          <div className="p-0">
            <div className="flex items-baseline mb-2">
              <span className="font-medium truncate">Total Hari Kemarin</span>
              <span className="ml-2 text-gray-500 font-medium text-xs">{yesterdayDateFormatted}</span>
            </div>

            <div className="mt-2 text-sm text-gray-600 items-center">
              <div>
                {/* IN: Panah Kanan Hijau */}
                <span className="font-bold text-green-600">
                  &#x2192; {/* Panah kanan */}
                </span>{" "}
                {/* {isLoading ? (
                  <Spinner />
                ) : ( */}
                  <span className="font-bold text-green-600"> {/* Tambah warna hijau dan font tebal */}
                    {actualYesterdayInOut.IN.toLocaleString('id-ID')}
                  </span>
                {/* )} */}
              </div>
              <div>
                {/* OUT: Panah Kiri Merah */}
                <span className="font-bold text-red-600">
                  &#x2190; {/* Panah kiri */}
                </span>{" "}
                {/* {isLoading ? (
                  <Spinner />
                ) : ( */}
                  <span className="font-bold text-red-600"> {/* Tambah warna merah dan font tebal */}
                    {actualYesterdayInOut.OUT.toLocaleString('id-ID')}
                  </span>
                {/* )} */}
              </div>
            </div>

            <span className="block my-3 text-sm font-medium text-gray-500">Total Keseluruhan</span>
            <span className="text-3xl block font-medium text-secondary-style">
              {/* {isLoading ? <Spinner /> : actualYesterdayTotal.toLocaleString('id-ID')} */}
              {actualYesterdayTotal.toLocaleString('id-ID')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}