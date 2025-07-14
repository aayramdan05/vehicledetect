// src/app/dashboard/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef } from 'react';
import axios from 'axios';
import ChartSection from '@/components/ui/ChartSection';
import PieChart from '@/components/ui/PieChart';
import SummaryTable from '@/components/ui/SummaryTable';

import { DateRangePicker } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { addDays, subDays } from 'date-fns';
import { setDefaultOptions } from 'date-fns';
import { id } from 'date-fns/locale'; // Import locale for Indonesian

import { Fragment } from 'react' // Perlu untuk React's Fragment
import { Listbox, Transition } from '@headlessui/react' // Install headlessui jika belum: npm install @headlessui/react
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid' // Install heroicons jika belum: npm install @heroicons/react

setDefaultOptions({ locale: id }); // Set default locale for date-fns to Indonesian

// --- Interfaces untuk tipe data (Pastikan ini sesuai dengan respons API Anda) ---
interface Detection {
  id: number;
  cctv: number;
  cctv_name: string;
  timestamp: string;
  vehicle_type: string;
  direction: string;
  frame_image: string;
}

interface SummaryCounts {
  [key: string]: number;
}

interface CachedChartDataPoint {
    timestamp: string;
    [vehicleType: string]: number | string;
}

// Interface baru untuk data CCTV dari API
interface CCTVItem {
    id: number;
    name: string;
    brand: string;
    location: string;
    line_position: number;
    ip_address: string;
    rtsp_url: string;
    type: string; // Tambahkan properti 'type' jika ada di backend
}

// Interface baru untuk Ringkasan Emisi CO
interface COEmissionSummary {
  [vehicleType: string]: number; // Misalnya: { "Motor": 1500, "Mobil": 2000 }
}

// --- URL Backend (PENTING: Sesuaikan dengan setup Anda) ---
// Asumsikan FastAPI berjalan di 8001 dan mem-proxy API Django
const FASTAPI_STREAM_URL = 'http://10.69.69.52:8001'; 
// Asumsikan Django API utama berjalan di 8000
const DJANGO_API_URL = 'http://10.69.69.52:8000';


export default function Dashboard() {
  const [globalVehicleType, setGlobalVehicleType] = useState('');
  const [globalDirection, setGlobalDirection] = useState('');
  
  // --- STATE UNTUK FILTER DATA (GLOBAL CCTV FILTER) ---
  // Default 'All' agar data summary/chart menampilkan semua CCTV
  const [globalCctvNameForData, setGlobalCctvNameForData] = useState('All'); 

  // --- STATE UNTUK LIVE STREAMING VIDEO (SPECIFIC CCTV FILTER) ---
  const [selectedCctvForStream, setSelectedCctvForStream] = useState('');

  const today = useMemo(() => new Date(), []);
  const yesterday = useMemo(() => subDays(today, 1), [today]);

  const [actualTodayTotal, setActualTodayTotal] = useState<number>(0);
  const [actualYesterdayTotal, setActualYesterdayTotal] = useState<number>(0);

  const [actualTodayInOut, setActualTodayInOut] = useState({ IN: 0, OUT: 0 });
  const [actualYesterdayInOut, setActualYesterdayInOut] = useState({ IN: 0, OUT: 0 });

  const [summaryDateRange, setSummaryDateRange] = useState([
    { startDate: today, endDate: today, key: 'selection' },
  ]);
  const [showSummaryDatePicker, setShowSummaryDatePicker] = useState(false);
  const summaryPickerRef = useRef<HTMLDivElement>(null);

  const [summaryPieChartCounts, setSummaryPieChartCounts] = useState<SummaryCounts>({});
  const [yesterdayPieChartCounts, setYesterdayPieChartCounts] = useState<SummaryCounts>({});

  const [chartDateRange, setChartDateRange] = useState([
    { startDate: today, endDate: addDays(today, 7), key: 'selection' },
  ]);
  const [showChartDatePicker, setShowChartDatePicker] = useState(false);
  const chartPickerRef = useRef<HTMLDivElement>(null);

  const [chartDataForRendering, setChartDataForRendering] = useState<CachedChartDataPoint[]>([]);

  // State untuk menyimpan daftar semua nama CCTV unik dari API
  const [allCctvNames, setAllCctvNames] = useState<string[]>([]);
  const [cctvList, setCctvList] = useState<CCTVItem[]>([]);
  // State untuk menyimpan total poin polusi
  const [totalPollutionPoints, setTotalPollutionPoints] = useState<number>(0);

  // State baru untuk menyimpan ringkasan emisi CO per jenis kendaraan
  const [coEmissionSummary, setCoEmissionSummary] = useState<COEmissionSummary>({});

  // --- URL Video Feed: dibentuk berdasarkan selectedCctvForStream ---
  const videoFeedUrl = selectedCctvForStream 
    ? `${FASTAPI_STREAM_URL}/video_feed/${selectedCctvForStream}` 
    : ''; // Kosongkan jika tidak ada CCTV yang dipilih

  const formatDateToYYYYMMDD = (date: Date | undefined): string => {
    if (!date) return '';
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  const getDateRangeDisplay = (range: typeof summaryDateRange) => {
    const start = range[0].startDate;
    const end = range[0].endDate;
    if (!start || !end) return '';
    const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const formattedStart = start.toLocaleDateString('id-ID', options);
    const formattedEnd = end.toLocaleDateString('id-ID', options);
    return `${formattedStart} - ${formattedEnd}`;
  };

  const aggregateToPieChartCounts = (detections: Detection[]): SummaryCounts => {
      const counts: SummaryCounts = {};
      detections.forEach(item => {
          counts[item.vehicle_type] = (counts[item.vehicle_type] || 0) + 1;
      });
      return counts;
  };

  const aggregateToChartData = (detections: Detection[]): CachedChartDataPoint[] => {
    const hourlyData: { [key: string]: { [vehicleType: string]: number } } = {};
    const uniqueVehicleTypes = Array.from(new Set(detections.map(d => d.vehicle_type)));

    detections.forEach(d => {
        const date = new Date(d.timestamp);
        const hour = date.getHours();
        const formattedHour = `${String(hour).padStart(2, '0')}:00`;
        const dateKey = formatDateToYYYYMMDD(date);
        const uniqueHourlyKey = `${dateKey}T${formattedHour}`;

        if (!hourlyData[uniqueHourlyKey]) {
            hourlyData[uniqueHourlyKey] = {};
            uniqueVehicleTypes.forEach(vt => hourlyData[uniqueHourlyKey][vt] = 0);
        }
        hourlyData[uniqueHourlyKey][d.vehicle_type] = (hourlyData[uniqueHourlyKey][d.vehicle_type] || 0) + 1;
    });

    const sortedKeys = Object.keys(hourlyData).sort();
    const finalChartData: CachedChartDataPoint[] = sortedKeys.map(key => {
        return { timestamp: key.split('T')[1], ...hourlyData[key] };
    });
    return finalChartData;
  };

  // --- FAKTOR EMISI (POIN POLUSI) PER JENIS KENDARAAN (Digunakan untuk tingkat polusi) ---
  const EMISSION_POINTS_PER_VEHICLE_TYPE: { [key: string]: number } = useMemo(() => ({
    'Motor': 1, // Pertalite
    'Mobil': 2, // Pertamax
    'Bus': 5,   // Solar
    'Truk': 7,  // Solar
    'Sepeda': 0,
  }), []);

  // --- FAKTOR EMISI CO (GRAM CO) PER JENIS KENDARAAN PER DETEKSI ---
  const CO_EMISSION_GRAMS_PER_DETECTION: { [key: string]: number } = useMemo(() => ({
    'Motor': 30,  // Gram CO per deteksi motor (Pertalite)
    'Mobil': 20,  // Gram CO per deteksi mobil (Pertamax)
    'Truk': 80,   // Gram CO per deteksi truk (Solar)
    'Bus': 100,   // Gram CO per deteksi bus (Solar)
    'Sepeda': 0,  // Gram CO per deteksi sepeda
  }), []);

  // --- Fungsi untuk menghitung total poin polusi (digunakan untuk level) ---
  const calculateTotalPollutionPoints = (counts: SummaryCounts): number => {
    let totalPoints = 0;
    for (const vehicleType in counts) {
      if (EMISSION_POINTS_PER_VEHICLE_TYPE[vehicleType] !== undefined) {
        totalPoints += counts[vehicleType] * EMISSION_POINTS_PER_VEHICLE_TYPE[vehicleType];
      }
    }
    return totalPoints;
  };

  // --- Fungsi baru untuk menghitung ringkasan emisi CO per jenis kendaraan ---
  const calculateCOEmissionSummary = (counts: SummaryCounts): COEmissionSummary => {
    const summary: COEmissionSummary = {};
    for (const vehicleType in counts) {
      if (CO_EMISSION_GRAMS_PER_DETECTION[vehicleType] !== undefined) {
        summary[vehicleType] = counts[vehicleType] * CO_EMISSION_GRAMS_PER_DETECTION[vehicleType];
      } else {
        summary[vehicleType] = 0; // Jika jenis kendaraan tidak ada dalam daftar emisi
      }
    }
    return summary;
  };

  // --- Fungsi untuk menentukan tingkat polusi berdasarkan total poin polusi ---
  const calculatePollutionLevel = (points: number): { level: string; emoji: string; value: number } => {
    const clampedPoints = Math.max(0, points); // Pastikan poin tidak negatif
    if (clampedPoints < 200) {
      return { level: 'Rendah', emoji: '😊', value: clampedPoints };
    } else if (clampedPoints < 1000) {
      return { level: 'Sedang', emoji: '😐', value: clampedPoints };
    } else if (clampedPoints < 3000) {
      return { level: 'Tinggi', emoji: '😟', value: clampedPoints };
    } else {
      return { level: 'Sangat Tinggi', emoji: '😷', value: clampedPoints };
    }
  };

  // --- useEffect untuk Fetch Data Ringkasan Tabel Hari Ini (Menggunakan globalCctvNameForData) ---
  useEffect(() => {
    const fetchSummaryData = () => {
      const params = new URLSearchParams();
      const startDate = formatDateToYYYYMMDD(summaryDateRange[0].startDate);
      const endDate = formatDateToYYYYMMDD(summaryDateRange[0].endDate);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (globalVehicleType) params.append('vehicle_type', globalVehicleType);
      if (globalDirection) params.append('direction', globalDirection);
      
      // Filter berdasarkan globalCctvNameForData jika bukan 'All'
      if (globalCctvNameForData && globalCctvNameForData !== 'All') { 
        params.append('cctv_name', globalCctvNameForData);
      }

      const queryString = params.toString();
      const url = `${DJANGO_API_URL}/api/detections/${queryString ? `?${queryString}` : ''}`;
      console.log('Fetching summary table data from:', url);
      axios.get<Detection[]>(url)
        .then(response => {
          const counts = aggregateToPieChartCounts(response.data);
          setSummaryPieChartCounts(counts);
          setTotalPollutionPoints(calculateTotalPollutionPoints(counts));
          setCoEmissionSummary(calculateCOEmissionSummary(counts));
        })
        .catch(error => console.error('Error fetching summary table data:', error));
    };
    fetchSummaryData();
    const interval = setInterval(fetchSummaryData, 1000);
    return () => clearInterval(interval);
  }, [summaryDateRange, globalVehicleType, globalDirection, globalCctvNameForData, EMISSION_POINTS_PER_VEHICLE_TYPE, CO_EMISSION_GRAMS_PER_DETECTION]);

  // --- useEffect untuk Fetch Data Kemarin (Menggunakan globalCctvNameForData) ---
  useEffect(() => {
    const fetchYesterdayData = () => {
      const params = new URLSearchParams();
      const yesterdayDate = formatDateToYYYYMMDD(yesterday); 
      params.append('start_date', yesterdayDate);
      params.append('end_date', yesterdayDate);
      if (globalVehicleType) params.append('vehicle_type', globalVehicleType);
      if (globalDirection) params.append('direction', globalDirection);
      
      // Filter berdasarkan globalCctvNameForData jika bukan 'All'
      if (globalCctvNameForData && globalCctvNameForData !== 'All') { 
        params.append('cctv_name', globalCctvNameForData);
      }

      const queryString = params.toString();
      const url = `${DJANGO_API_URL}/api/detections/${queryString ? `?${queryString}` : ''}`;
      console.log('Fetching yesterday table data from:', url);
      axios.get<Detection[]>(url)
        .then(response => setYesterdayPieChartCounts(aggregateToPieChartCounts(response.data)))
        .catch(error => console.error('Error fetching yesterday table data:', error));
    };
    fetchYesterdayData();
    const interval = setInterval(fetchYesterdayData, 10000);
    return () => clearInterval(interval);
  }, [yesterday, globalVehicleType, globalDirection, globalCctvNameForData]);

  // --- useEffect untuk Fetch data AKTUAL HARI INI (Total semua CCTV, tidak difilter) ---
  useEffect(() => {
    const fetchActualTodayTotal = async () => {
      const todayDate = formatDateToYYYYMMDD(today);
      const url = `${DJANGO_API_URL}/api/detections/?start_date=${todayDate}&end_date=${todayDate}`;
      try {
        const response = await axios.get<Detection[]>(url);
        setActualTodayTotal(response.data.length); // ✅ Simpan total
      } catch (error) {
        console.error("❌ Error fetching actual today total data:", error);
      }
    };

    fetchActualTodayTotal();
    const interval = setInterval(fetchActualTodayTotal, 1000);
    return () => clearInterval(interval);
  }, [today]);

  
  // --- useEffect untuk Fetch data AKTUAL HARI INI IN/OUT (Total semua CCTV, tidak difilter) ---
  useEffect(() => {
    const fetchTodayInOut = async () => {
      const todayDate = formatDateToYYYYMMDD(today);
      const url = `${DJANGO_API_URL}/api/detections/?start_date=${todayDate}&end_date=${todayDate}`;
      try {
        const response = await axios.get<Detection[]>(url);
        const detections = response.data;

        // console.log("🚦 Data fetched for IN/OUT today:", detections); // <-- tambahkan log ini
        const inCount = detections.filter(d => d.direction === 'IN').length;
        const outCount = detections.filter(d => d.direction === 'OUT').length;

        // console.log(`🚙 IN: ${inCount}, OUT: ${outCount}`); // <-- tambahkan log ini
        setActualTodayInOut({ IN: inCount, OUT: outCount });
      } catch (error) {
        console.error('❌ Error fetching today IN/OUT data:', error);
      }
    };
    fetchTodayInOut();
    const interval = setInterval(fetchTodayInOut, 1000);
    return () => clearInterval(interval);
  }, [today]);



  // --- useEffect untuk Fetch data AKTUAL KEMARIN (Total semua CCTV, tidak difilter) ---
  useEffect(() => {
    const fetchActualYesterdayData = async () => {
      const yesterdayDate = formatDateToYYYYMMDD(yesterday);
      const url = `${DJANGO_API_URL}/api/detections/?start_date=${yesterdayDate}&end_date=${yesterdayDate}`;
      // console.log("📦 Fetching total kemarin dari:", url);

      try {
        const response = await axios.get<Detection[]>(url);
        setActualYesterdayTotal(response.data.length);
        // console.log(`📊 Total kemarin: ${response.data.length}`);
      } catch (error) {
        console.error("❌ Gagal fetch total kemarin:", error);
      }
    };

    fetchActualYesterdayData();
    const interval = setInterval(fetchActualYesterdayData, 10000);
    return () => clearInterval(interval);
  }, [yesterday]);

  // --- useEffect untuk Fetch data AKTUAL KEMARIN IN/OUT (Total semua CCTV, tidak difilter) ---
  useEffect(() => {
    const fetchYesterdayInOut = async () => {
      const yesterdayDate = formatDateToYYYYMMDD(yesterday);
      const url = `${DJANGO_API_URL}/api/detections/?start_date=${yesterdayDate}&end_date=${yesterdayDate}`;
      // console.log("📦 Fetching IN/OUT kemarin dari:", url);

      try {
        const response = await axios.get<Detection[]>(url);
        const detections = response.data;

        const inCount = detections.filter(d => d.direction === 'IN').length;
        const outCount = detections.filter(d => d.direction === 'OUT').length;

        // console.log(`📉 Kemarin IN: ${inCount}, OUT: ${outCount}`);
        setActualYesterdayInOut({ IN: inCount, OUT: outCount });
      } catch (error) {
        console.error('❌ Error fetching yesterday IN/OUT data:', error);
      }
    };

    fetchYesterdayInOut();
    const interval = setInterval(fetchYesterdayInOut, 10000);
    return () => clearInterval(interval);
  }, [yesterday]);


  // --- useEffect untuk Fetch Data Grafik (Menggunakan globalCctvNameForData) ---
  useEffect(() => {
    const fetchChartData = () => {
      const params = new URLSearchParams();
      const startDate = formatDateToYYYYMMDD(chartDateRange[0].startDate);
      const endDate = formatDateToYYYYMMDD(chartDateRange[0].endDate);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (globalVehicleType) params.append('vehicle_type', globalVehicleType);
      if (globalDirection) params.append('direction', globalDirection);
      
      // Filter data chart berdasarkan globalCctvNameForData jika bukan 'All'
      if (globalCctvNameForData && globalCctvNameForData !== 'All') { 
        params.append('cctv_name', globalCctvNameForData);
      }

      const queryString = params.toString();
      const url = `${DJANGO_API_URL}/api/detections/${queryString ? `?${queryString}` : ''}`;
      console.log('Fetching chart data from:', url);
      axios.get<Detection[]>(url)
        .then(response => setChartDataForRendering(aggregateToChartData(response.data)))
        .catch(error => console.error('Error fetching chart data:', error));
    };
    fetchChartData();
    const interval = setInterval(fetchChartData, 3600000); // Per jam update
    return () => clearInterval(interval);
  }, [chartDateRange, globalVehicleType, globalDirection, globalCctvNameForData]);

  // --- useEffect untuk Fetch daftar CCTV unik dari endpoint /api/cctv/ ---
  useEffect(() => {
    const fetchAllCctvNames = async () => {
      try {
        const response = await axios.get<CCTVItem[]>(`${FASTAPI_STREAM_URL}/api/cctv/`); // Ambil dari FastAPI
        setCctvList(response.data)
        const uniqueCctvNames = Array.from(new Set(response.data.map(item => item.name).filter(Boolean)));
        setAllCctvNames(uniqueCctvNames);
        
        if (response.data.length > 0) { // Gunakan response.data.length karena itu adalah array penuh
          // Set default untuk live stream ke CCTV pertama yang tersedia (berdasarkan namanya)
          setSelectedCctvForStream(response.data[0].name); 
        }

        if (uniqueCctvNames.length > 0) {
            // Set default untuk filter data global menjadi 'All' (atau 'Semua CCTV')
            // setGlobalCctvNameForData('All'); // Ini sudah default state

            // Set default untuk live stream ke CCTV pertama yang tersedia
            setSelectedCctvForStream(uniqueCctvNames[0]); 
        }
      } catch (error) {
        console.error('Error fetching all CCTV names:', error);
        setAllCctvNames([]);
      }
    };
    fetchAllCctvNames();
  }, []); // Hanya berjalan sekali saat komponen di-mount

  // Handle click outside date pickers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (summaryPickerRef.current && !summaryPickerRef.current.contains(event.target as Node)) {
        setShowSummaryDatePicker(false);
      }
      if (chartPickerRef.current && !chartPickerRef.current.contains(event.target as Node)) {
        setShowChartDatePicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Panggil fungsi calculatePollutionLevel dengan totalPolutionPoints
  const pollution = calculatePollutionLevel(totalPollutionPoints);

  // Menghitung total emisi CO untuk tampilan di UI
  const totalCOEmissionInGrams = Object.values(coEmissionSummary).reduce((sum, value) => sum + value, 0);

  // --- LOGIKA UNTUK SLIDER POLUSI ---
  const MAX_POLLUTION_POINTS = 5000; 
  const sliderPosition = (pollution.value / MAX_POLLUTION_POINTS) * 100;
  const clampedSliderPosition = Math.max(0, Math.min(100, sliderPosition));  
  const currentCctv = cctvList.find(cctv => cctv.name === selectedCctvForStream);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Topbar: Logo, Judul, dan Info User */}
      <nav className="bg-white p-4 shadow-md flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <img src="/images/logo/unpad.png" alt="Logo" width={50} height={50} />
        </div>
        <div className="text-xl font-bold text-gray-800">UNPAD Vehicle Counting</div>
        <div className="flex items-center space-x-4">
          <span className="text-gray-700">Halo, **Admin**!</span>
          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center text-gray-600 font-semibold">
            AD
          </div>
        </div>
      </nav>

      {/* Konten Utama Dashboard */}
      <div className="p-4 space-y-4">
        {/* Bagian Filter Global untuk data statistik */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-9 gap-4">
          <div>
            <label className="block text-sm text-gray-600">Jenis Kendaraan</label>
            <select value={globalVehicleType} onChange={e => setGlobalVehicleType(e.target.value)} className="w-full border p-2 rounded">
              <option value="">Semua</option>
              <option value="Mobil">Mobil</option>
              <option value="Motor">Motor</option>
              <option value="Bus">Bus</option>
              <option value="Truk">Truk</option>
              <option value="Sepeda">Sepeda</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600">Arah</label>
            <select value={globalDirection} onChange={e => setGlobalDirection(e.target.value)} className="w-full border p-2 rounded">
              <option value="">Semua</option>
              <option value="IN">Masuk</option>
              <option value="OUT">Keluar</option>
            </select>
          </div>
          {/* --- DROPDOWN UNTUK FILTER DATA STATISTIK (GLOBAL) --- */}
          <div>
            <label className="block text-sm text-gray-600">Filter Data CCTV</label>
            <select 
                value={globalCctvNameForData} // Menggunakan state baru untuk filter data
                onChange={e => setGlobalCctvNameForData(e.target.value)} 
                className="w-full border p-2 rounded"
            >
            <option value="All">Semua CCTV</option>
            {cctvList.map(cctv => ( // GANTI INI: Gunakan cctvList, bukan allCctvNames
              <option key={cctv.name} value={cctv.name}>{cctv.location}</option> // GANTI INI: Tampilkan location, value tetap name
            ))}
            </select>
          </div>
          {/* --- AKHIR DROPDOWN FILTER DATA --- */}
        </div>

        <hr className="border-t border-gray-300 my-4" />

        <main>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
            {/* Bagian Ringkasan Tabel (tetap menggunakan globalCctvNameForData) */}
            <section className="md:col-span-2 space-y-4 order-2 md:order-1">
              <div className="relative mb-4" ref={summaryPickerRef}>
                <label className="text-sm font-medium mb-1 text-gray-600 flex items-center justify-end">
                  Rentang Tanggal: 
                  <button
                    type="button"
                    onClick={() => setShowSummaryDatePicker(!showSummaryDatePicker)}
                    className="flex items-center gap-1.5 bg-transparent border-[1.5px] border-neutral/30 focus:border-primary/main focus:text-primary/main rounded-md h-7 px-2 py-0 text-xs hover:bg-primary/10 focus:bg-primary/10 ml-2"
                  >
                    <span className="text-inherit whitespace-nowrap">
                      {getDateRangeDisplay(summaryDateRange)}
                    </span>
                    <span style={{ width: 14, height: 14, color: 'inherit' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 16 16"><path fill="currentColor" fillRule="evenodd" d="M3.333 3.333A.667.667 0 0 0 2.667 4v9.333c0 .368.298.667.666.667h9.334a.667.667 0 0 0 .666-.667V4a.667.667 0 0 0-.666-.667zm-2 .667a2 2 0 0 1 2-2h9.334a2 2 0 0 1 2 2v9.333a2 2 0 0 1-2 2H3.333a2 2 0 0 1-2-2z" clipRule="evenodd"></path><path fill="currentColor" fillRule="evenodd" d="M10.667.667c.368 0 .666.298.666.666V4A.667.667 0 0 1 10 4V1.333c0-.368.298-.666.667-.666M5.333.667c.368 0 .667.298.667.666V4a.667.667 0 0 1-1.333 0V1.333c0-.368.298-.666.666-.666M1.333 6.667C1.333 6.298 1.632 6 2 6h12a.667.667 0 1 1 0 1.333H2a.667.667 0 0 1-.667-.666" clipRule="evenodd"></path></svg>
                    </span>
                  </button>
                </label>
                {showSummaryDatePicker && (
                  <div className="absolute top-full right-0 mt-2 z-50 bg-white rounded-[10px] border shadow-md border-neutral/40">
                    <DateRangePicker
                      ranges={summaryDateRange}
                      onChange={item => {
                        setSummaryDateRange([item.selection] as any);
                        setShowSummaryDatePicker(false);
                      }}
                      moveRangeOnFirstSelection={false}
                      months={1}
                      direction="horizontal"
                      rangeColors={['#3d91ff']}
                    />
                  </div>
                )}
              </div>
              <SummaryTable
                pieChartCounts={summaryPieChartCounts}
                pieChartCountsYesterday={yesterdayPieChartCounts}
                todayDateFormatted={formatDateToYYYYMMDD(today)}
                yesterdayDateFormatted={formatDateToYYYYMMDD(yesterday)}
                actualTodayTotal={actualTodayTotal}
                actualYesterdayTotal={actualYesterdayTotal}
                actualTodayInOut={actualTodayInOut}
                actualYesterdayInOut={actualYesterdayInOut}
              />
            </section>

            <section className="md:col-span-3 space-y-4 order-1 md:order-2">
              {/* --- BAGIAN VIDEO KAMERA CCTV (Menggunakan selectedCctvForStream) --- */}
              <div className="bg-white rounded-xl shadow p-4">
                <h2 className="text-base font-semibold mb-2 text-gray-700">Video Kamera CCTV</h2>

                {/* Tampilan video stream */}
                <div className="mb-4 flex items-center gap-2 justify-end">
                  <label className="text-sm font-medium text-gray-600 whitespace-nowrap">CCTV Live Stream:</label>
                  <Listbox value={selectedCctvForStream} onChange={setSelectedCctvForStream}>
                    {({ open }) => (
                      <div className="relative">
                        <Listbox.Button
                          className="overflow-hidden transition flex items-center justify-between gap-3 bg-transparent border-[1.5px] border-neutral-300 disabled:bg-neutral/20 disabled:border-neutral/30 disabled:text-neutral/60 disabled:cursor-not-allowed focus:shadow-focus h-[32px] px-4 py-[6px] text-sm hover:bg-primary-100 focus:bg-primary-100 focus:shadow-blue-200 [&.auto-active]:text-neutral-100 [&.auto-active]:focus:text-blue-500 [&.auto-active]:focus:border-blue-500 [&.active]:border-blue-500 [&.active]:text-blue-500 [&.auto-active]:border-neutral-400 rounded-md auto-active"
                        >
                          <span className="block truncate text-gray-700 text-left">
                            {/* Tampilkan lokasi dari CCTV yang dipilih */}
                            {currentCctv?.location || "Pilih CCTV..."} 
                          </span>
                          <span className="pointer-events-none flex items-center pl-2">
                            <ChevronUpDownIcon
                              className="h-5 w-5 text-gray-400"
                              aria-hidden="true"
                            />
                          </span>
                        </Listbox.Button>
                        <Transition
                          show={open}
                          as={Fragment}
                          leave="transition ease-in duration-100"
                          leaveFrom="opacity-100"
                          leaveTo="opacity-0"
                        >
                          <Listbox.Options
                            className="absolute z-10 mt-1 max-h-60 overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
                            style={{ minWidth: 'max-content' }}
                          >
                            {cctvList.length === 0 ? (
                              <div className="relative cursor-default select-none py-2 pl-3 pr-9 text-gray-700">
                                Tidak ada CCTV tersedia.
                              </div>
                            ) : (
                              cctvList.map((cctv) => (
                                <Listbox.Option
                                  key={cctv.id}
                                  className={({ active }) =>
                                    `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                      active ? 'bg-blue-100 text-blue-900' : 'text-gray-900'
                                    }`
                                  }
                                  value={cctv.name}
                                >
                                  {({ selected, active }) => (
                                    <>
                                      <span
                                        className={`block truncate ${
                                          selected ? 'font-medium' : 'font-normal'
                                        }`}
                                      >
                                        {cctv.location}
                                      </span>
                                      {selected ? (
                                        <span
                                          className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                                            active ? 'text-blue-600' : 'text-blue-600'
                                          }`}
                                        >
                                          <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                        </span>
                                      ) : null}
                                    </>
                                  )}
                                </Listbox.Option>
                              ))
                            )}
                          </Listbox.Options>
                        </Transition>
                      </div>
                    )}
                  </Listbox>
                </div>

                {/* Tampilan video stream */}
                <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                  {selectedCctvForStream ? (
                    <img
                      className="absolute top-0 left-0 w-full h-full rounded-lg object-contain bg-black"
                      src={videoFeedUrl}
                      // Gunakan lokasi atau nama jika lokasi tidak tersedia
                      alt={`Live Stream dari ${currentCctv?.location || selectedCctvForStream}`}
                    />
                  ) : (
                    <div className="absolute top-0 left-0 w-full h-full rounded-lg bg-gray-200 flex items-center justify-center text-gray-500">
                      <p>Pilih CCTV dari _dropdown_ di atas untuk melihat _live stream_ deteksi.</p>
                    </div>
                  )}
                </div>
              </div>
              {/* --- AKHIR BAGIAN VIDEO KAMERA CCTV --- */}

              <div className="h-full bg-white rounded-xl shadow p-4 flex flex-col">
                <h2 className="text-base font-semibold mb-2 text-gray-700">Grafik Deteksi Kendaraan</h2>
                <div className="relative mb-4" ref={chartPickerRef}>
                  <label className="text-sm font-medium mb-1 text-gray-600 flex items-center justify-end">
                    Rentang Tanggal: 
                    <button
                      type="button"
                      onClick={() => setShowChartDatePicker(!showChartDatePicker)}
                      className="flex items-center gap-1.5 bg-transparent border-[1.5px] border-neutral/30 focus:border-primary/main focus:text-primary/main rounded-md h-7 px-2 py-0 text-xs hover:bg-primary/10 focus:bg-primary/10 ml-2"
                    >
                      <span className="text-inherit whitespace-nowrap">
                        {getDateRangeDisplay(chartDateRange)}
                      </span>
                      <span style={{ width: 14, height: 14, color: 'inherit' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 16 16"><path fill="currentColor" fillRule="evenodd" d="M3.333 3.333A.667.667 0 0 0 2.667 4v9.333c0 .368.298.667.666.667h9.334a.667.667 0 0 0 .666-.667V4a.667.667 0 0 0-.666-.667zm-2 .667a2 2 0 0 1 2-2h9.334a2 2 0 0 1 2 2v9.333a2 2 0 0 1-2 2H3.333a2 2 0 0 1-2-2z" clipRule="evenodd"></path><path fill="currentColor" fillRule="evenodd" d="M10.667.667c.368 0 .666.298.666.666V4A.667.667 0 0 1 10 4V1.333c0-.368.298-.666.667-.666M5.333.667c.368 0 .667.298.667.666V4a.667.667 0 0 1-1.333 0V1.333c0-.368.298-.666.666-.666M1.333 6.667C1.333 6.298 1.632 6 2 6h12a.667.667 0 1 1 0 1.333H2a.667.667 0 0 1-.667-.666" clipRule="evenodd"></path></svg>
                      </span>
                    </button>
                  </label>
                  {showChartDatePicker && (
                    <div className="absolute top-full right-0 mt-2 z-50 bg-white rounded-[10px] border shadow-md border-neutral/40">
                      <DateRangePicker
                        ranges={chartDateRange}
                        onChange={item => {
                          setChartDateRange([item.selection] as any);
                          setShowChartDatePicker(false);
                        }}
                        moveRangeOnFirstSelection={false}
                        months={1}
                        direction="horizontal"
                        rangeColors={['#3d91ff']}
                      />
                    </div>
                  )}
                </div>
                <div className="flex-grow">
                  <ChartSection
                    cctvName={globalCctvNameForData === 'All' ? 'Semua' : globalCctvNameForData} // Menggunakan globalCctvNameForData untuk ChartSection
                    direction={globalDirection}
                    startDate={formatDateToYYYYMMDD(chartDateRange[0].startDate)}
                    endDate={formatDateToYYYYMMDD(chartDateRange[0].endDate)}
                    vehicleType={globalVehicleType}
                  />
                </div>
              </div>
            </section>

            <section className="md:col-span-2 space-y-4 order-3 md:order-3"> 
              <div className="bg-white rounded-xl shadow p-4 flex flex-col items-center">
                <h2 className="text-base font-semibold mb-2 text-gray-700">Distribusi Jenis Kendaraan</h2>
                <div className="flex-grow flex items-center justify-center w-full">
                  <PieChart counts={summaryPieChartCounts} /> 
                </div>
              </div>

              {/* --- BAGIAN RINGKASAN EMISI CO PER KENDARAAN (Menggunakan globalCctvNameForData) --- */}
              <div className="bg-white rounded-xl shadow p-4 flex flex-col">
                <h2 className="text-base font-semibold mb-2 text-gray-700">Ringkasan Emisi CO (Perkiraan)</h2>
                <div className="text-sm text-gray-700">
                  <p className="mb-2">Total CO: <span className="font-bold">{totalCOEmissionInGrams.toFixed(2)} gram</span></p>
                  <ul className="list-disc list-inside space-y-1">
                    {Object.keys(coEmissionSummary).sort().map(vehicleType => (
                      <li key={vehicleType} className="flex justify-between">
                        <span>{vehicleType}:</span>
                        <span className="font-medium">
                          {coEmissionSummary[vehicleType].toFixed(2)} gram
                        </span>
                      </li>
                    ))}
                    {Object.keys(coEmissionSummary).length === 0 && (
                      <li>Tidak ada data emisi CO.</li>
                    )}
                  </ul>
                </div>
                <p className="text-xs text-gray-500 mt-2">*Perkiraan berdasarkan jumlah deteksi dan asumsi bahan bakar: Motor (Pertalite), Mobil (Pertamax), Truk/Bus (Solar).</p>
              </div>
              {/* --- AKHIR BAGIAN RINGKASAN EMISI CO --- */}

              {/* --- BAGIAN PERKIRAAN TINGKAT POLUSI DENGAN SLIDER (Menggunakan globalCctvNameForData) --- */}
              <div className="bg-white rounded-xl shadow p-4 flex flex-col"> 
                <h2 className="text-base font-semibold mb-2 text-gray-700">Perkiraan Tingkat Polusi</h2>
                <div className="flex flex-col items-center text-center w-full">
                    <span className="text-5xl mb-2">{pollution.emoji}</span>
                    <p className="text-gray-800 text-2xl font-bold mb-3">{pollution.level}</p> 

                    <div className="w-full relative py-[5px] my-1">
                        <div 
                            className="w-full h-1 rounded" 
                            style={{ background: 'linear-gradient(270deg, rgb(206, 21, 21) 0%, rgb(223, 138, 38) 33.6%, rgb(235, 214, 27) 69.1%, rgb(16, 208, 70) 100%)' }}
                        ></div>
                        <div 
                            className="border-2 border-white shadow-sm w-[14px] h-[14px] rounded-full absolute bg-transparent overflow-hidden" 
                            style={{ top: '0px', left: `calc(${clampedSliderPosition}% - 7px)` }} 
                        >
                            <div 
                                className="h-[14px]" 
                                style={{ 
                                    background: 'linear-gradient(270deg, rgb(206, 21, 21) 0%, rgb(223, 138, 38) 33.6%, rgb(235, 214, 27) 69.1%, rgb(16, 208, 70) 100%)', 
                                    width: `${clampedSliderPosition}%` 
                                }}
                            ></div>
                        </div>
                    </div>
                    <div className="flex items-center justify-between w-full mt-2">
                        <span className="text-gray-500 text-xs">Rendah</span>
                        <span className="text-gray-500 text-xs">Sedang</span>
                        <span className="text-gray-500 text-xs">Tinggi</span>
                        <span className="text-500 text-xs">Sangat Tinggi</span>
                    </div>
                    <p className="text-gray-500 text-xs mt-2">Nilai Polusi: <span className="font-bold">{pollution.value}</span> poin</p> 
                </div>
                <p className="text-xs text-gray-500 mt-2">*Ini adalah perkiraan sederhana berdasarkan jenis dan jumlah kendaraan, bukan hasil pengukuran langsung.</p>
              </div>
              {/* --- AKHIR BAGIAN PERKIRAAN TINGKAT POLUSI --- */}

            </section>
          </div>
        </main>
      </div>
    </div>
  );
}