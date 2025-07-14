// src/components/ui/VehicleChart.tsx
"use client";

import React from "react";
import dynamic from "next/dynamic";

import { ChartData } from "@/types/chartTypes";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const VEHICLE_TYPES = ["Motor", "Mobil", "Bus", "Truk", "Sepeda"];

interface VehicleChartProps {
  data: ChartData[];
  type?: "bar" | "line";
}

export default function VehicleChart({
  data,
  type = "bar",
}: VehicleChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="w-full text-center py-8 text-gray-500">
        Tidak ada data grafik yang tersedia untuk filter ini.
      </div>
    );
  }

  const normalizedData = data.map((item) => {
    const newItem: ChartData = { ...item };
    VEHICLE_TYPES.forEach((v) => {
      if (typeof newItem[v] === 'undefined' || newItem[v] === null) {
        newItem[v] = 0;
      }
    });
    return newItem;
  });

  const series = VEHICLE_TYPES.map((key) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1),
    data: normalizedData.map((item) => item[key] as number),
  }));

  const options: ApexCharts.ApexOptions = {
    chart: {
      type: type,
      toolbar: { show: false },
      fontFamily: "inherit",
    },
    xaxis: {
      categories: normalizedData.map((item) => item.time as string),
      labels: {
        rotate: -45,
        formatter: function (val: string) {
          return val;
        }
      },
      title: { text: "Waktu (Jam)" },
    },
    yaxis: {
      title: { text: "Jumlah Deteksi" },
      min: 0,
      labels: {
        formatter: function (val: number) {
          return Math.floor(val).toString();
        }
      }
    },
    stroke: {
      curve: "smooth",
      width: 2,
    },
    legend: {
      position: "top",
      fontSize: "12px",
      markers: {
        // --- PERBAIKAN DI SINI ---
        // Ganti 'width' dan 'height' dengan 'size'
        size: 12,
        // Properti lain seperti offsetX atau offsetY bisa ditambahkan jika perlu penyesuaian posisi
      },
      itemMargin: {
        horizontal: 10,
        vertical: 0
      },
    },
    colors: ["#f7a35a", "#96e981", "#464145", "#79b4eb", "#bc55e8"],
    dataLabels: {
      enabled: false,
    },
    grid: {
      borderColor: "#eee",
      row: {
        colors: ["#f9f9f9", "transparent"],
        opacity: 0.5,
      },
    },
    tooltip: {
      shared: true,
      intersect: false,
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '55%',
      },
    },
  };

  return (
    <div className="w-full">
      <ApexChart type={type} height={350} options={options} series={series} />
    </div>
  );
}