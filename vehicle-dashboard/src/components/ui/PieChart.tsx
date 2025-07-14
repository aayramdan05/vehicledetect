// src/components/ui/PieChart.tsx
"use client";

import React, { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

// Palet warna baru yang lebih cerah
const COLORS = ["#32CD32", "#800080", "#FFA500", "#00BFFF", "#EE82EE", "#FF6347", "#4682B4"]; // Contoh: Hijau Muda, Ungu, Oranye, Biru Langit, Pink, Tomat, Biru Baja
const FADE_COLOR_FACTOR = 0.8; // Sedikit pudar saat tidak di-hover
const HOVER_STROKE_COLOR = "#000000";
const HOVER_STROKE_OPACITY = 0.1;
const HOVER_STROKE_WIDTH = 10;

// Prop PieChart ini sekarang secara eksplisit menerima 'counts'
export default function VehiclePieChart({ counts }: { counts: Record<string, number> }) {
    const [activeIndex, setActiveIndex] = useState(-1);

    const data = Object.entries(counts).map(([type, count]) => ({
        name: type,
        value: count,
    }));

    // Filter data untuk hanya menampilkan entri dengan nilai > 0
    const filteredData = data.filter(item => item.value > 0);

    if (filteredData.length === 0) {
        return (
            <div className="h-64 w-full flex items-center justify-center text-gray-500">
                Tidak ada data distribusi kendaraan.
            </div>
        );
    }

    const totalCount = filteredData.reduce((sum, entry) => sum + entry.value, 0);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const entry = payload[0];
            const name = entry.name;
            const value = entry.value;
            const percentage = totalCount > 0 ? ((value / totalCount) * 100).toFixed(1) : 0;

            return (
                <div className="custom-tooltip bg-white p-2 border border-gray-300 rounded shadow-md text-xs">
                    <p className="label font-semibold">{name}</p>
                    <p className="intro">Jumlah: {value}</p>
                    <p className="desc">Persentase: {percentage}%</p>
                </div>
            );
        }
        return null;
    };

    const fadeColor = (hex: string, factor: number) => {
        if (!hex) return hex;
        let r = parseInt(hex.substring(1, 3), 16);
        let g = parseInt(hex.substring(3, 5), 16);
        let b = parseInt(hex.substring(5, 7), 16);

        r = Math.round(r * factor);
        g = Math.round(g * factor);
        b = Math.round(b * factor);

        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    };

    const handleMouseEnter = (data: any, index: number) => {
        setActiveIndex(index);
    };

    const handleMouseLeave = () => {
        setActiveIndex(-1);
    };

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer>
                <PieChart>
                    <Pie
                        data={filteredData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        paddingAngle={3}
                        cornerRadius={5}
                        fill="#8884d8" // Ini akan ditimpa oleh Cell fill
                        label={false}
                    >
                        {filteredData.map((entry, index) => {
                            const color = COLORS[index % COLORS.length];
                            const isHovered = index === activeIndex;

                            return (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={isHovered ? color : fadeColor(color, FADE_COLOR_FACTOR)}
                                    stroke={isHovered ? HOVER_STROKE_COLOR : "none"}
                                    strokeOpacity={isHovered ? HOVER_STROKE_OPACITY : 0}
                                    strokeWidth={isHovered ? HOVER_STROKE_WIDTH : 0}
                                    onMouseEnter={() => handleMouseEnter(entry, index)}
                                    onMouseLeave={handleMouseLeave}
                                    style={{ transition: 'fill 0.3s ease, stroke 0.3s ease, stroke-opacity 0.3s ease, stroke-width 0.3s ease' }}
                                />
                            );
                        })}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        wrapperStyle={{ paddingLeft: '20px' }}
                    />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}