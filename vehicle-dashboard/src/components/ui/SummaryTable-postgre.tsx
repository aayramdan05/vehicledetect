// src/components/ui/SummaryTable.tsx
import React from "react";
import Image from "next/image";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "./table";

interface SummaryTableProps {
  pieChartCounts: Record<string, number>;
  pieChartCountsYesterday: Record<string, number>;
  todayDateFormatted: string;
  yesterdayDateFormatted: string;
  actualTodayTotal: number;
  actualYesterdayTotal: number;
  actualTodayInOut: { IN: number; OUT: number }; // Tambah ini
  actualYesterdayInOut: { IN: number; OUT: number }; // Tambah ini
}

export default function SummaryTable({ 
  pieChartCounts, 
  pieChartCountsYesterday, 
  todayDateFormatted, 
  yesterdayDateFormatted,
  actualTodayTotal,
  actualYesterdayTotal,
  actualTodayInOut,       // <--- Tambah ini
  actualYesterdayInOut    // <--- Tambah ini
}: SummaryTableProps) {

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 space-y-2">
        <h2 className="text-base font-semibold mb-2">Ringkasan Hari Ini</h2>
        
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
                    <TableCell
                      isHeader
                      className="px-5 py-3 font-medium text-gray-500 text-end text-theme-xs dark:text-gray-400"
                    >
                      + Hari Kemarin
                    </TableCell>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {Object.entries(pieChartCounts).map(([vehicleType, count]) => {
                    const countYesterday = pieChartCountsYesterday[vehicleType] || 0;
                    const difference = count - countYesterday;
                    const diffText = difference > 0 ? `+${difference}` : difference.toString();
                    const diffColor = difference >= 0 ? "text-green-600" : "text-red-600";

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
                          {count}
                        </TableCell>
                        <TableCell className={`px-4 py-3 ${diffColor} text-end text-theme-sm font-medium`}>
                          {diffText}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {Object.keys(pieChartCounts).length === 0 && (
                      <TableRow>
                          <TableCell colSpan={3} className="px-5 py-4 text-center text-gray-500">
                              Tidak ada data deteksi untuk rentang tanggal ini.
                          </TableCell>
                      </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 flex-1">
          <div className="p-0">
              <div className="flex items-baseline mb-2">
                  <span className="font-medium truncate">Hari Ini</span>
                  <span className="ml-2 text-gray-500 font-medium text-xs">{todayDateFormatted}</span>
              </div>
              <div className="mt-2 text-sm text-gray-600">
                <div>IN: {actualTodayInOut.IN}</div>
                <div>OUT: {actualTodayInOut.OUT}</div>
              </div>

              <span className="block my-3 text-sm font-medium text-gray-500">Total Kuantitas</span>
              <span className="text-3xl block font-medium text-secondary-style">{actualTodayTotal.toLocaleString('id-ID')}</span> {/* Gunakan actualTodayTotal */}
          </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 flex-1">
          <div className="p-0">
              <div className="flex items-baseline mb-2">
                  <span className="font-medium truncate">Kemarin</span>
                  <span className="ml-2 text-gray-500 font-medium text-xs">{yesterdayDateFormatted}</span>
              </div>

              <div className="mt-2 text-sm text-gray-600">
                <div>IN: {actualYesterdayInOut.IN}</div>
                <div>OUT: {actualYesterdayInOut.OUT}</div>
              </div>

              <span className="block my-3 text-sm font-medium text-gray-500">Total Kuantitas</span>
              <span className="text-3xl block font-medium text-secondary-style">{actualYesterdayTotal.toLocaleString('id-ID')}</span> {/* Gunakan actualYesterdayTotal */}
          </div>
      </div>
    </div>
  );
}