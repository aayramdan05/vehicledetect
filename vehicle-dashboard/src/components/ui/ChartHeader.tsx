// components/ui/ChartHeader.tsx
"use client";

import React from "react";

// Optional: Define the props interface separately for clarity
interface ChartHeaderProps {
  selectedChart: "bar" | "line"; // Be more specific with allowed chart types
  setSelectedChart: React.Dispatch<React.SetStateAction<"bar" | "line">>;
  cctvName: string;
  date: string;
  direction: string;
}

export default function ChartHeader({
  selectedChart,
  setSelectedChart,
  cctvName,
  date,
  direction,
}: ChartHeaderProps) { // Use the defined interface here
  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 gap-4">
      {/* Chart type toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          className={`h-8 px-4 text-sm rounded-md border-2 ${
            selectedChart === "bar"
              ? "bg-blue-600 text-white border-blue-600"
              : "border-gray-300 text-gray-700"
          }`}
          onClick={() => setSelectedChart("bar")}
        >
          Histogram Chart
        </button>
        <button
          type="button"
          className={`h-8 px-4 text-sm rounded-md border-2 ${
            selectedChart === "line"
              ? "bg-blue-600 text-white border-blue-600"
              : "border-gray-300 text-gray-700"
          }`}
          onClick={() => setSelectedChart("line")}
        >
          Line Chart
        </button>
      </div>

      {/* Info waktu + cctv */}
      <div className="text-right text-sm text-gray-500">
        <span className="block font-medium">{date}</span>
        <span className="text-gray-800">{cctvName}</span>
        {direction && (
          <span className="ml-2 text-green-600 font-medium">({direction})</span>
        )}
      </div>
    </div>
  );
}