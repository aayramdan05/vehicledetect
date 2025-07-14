"use client"; // Sangat penting untuk Client Component

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import ChartSection from '@/components/ui/ChartSection';
import PieChart from '@/components/ui/PieChart';
import SummaryTable from '@/components/ui/SummaryTable'; // Pastikan path ini benar

import { DateRangePicker, RangeKeyDict, Range } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { addDays, subDays, format } from 'date-fns';
import { setDefaultOptions } from 'date-fns';
import { id } from 'date-fns/locale';

import { Fragment } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';

setDefaultOptions({ locale: id });

// --- INTERFACES ---
interface AggregatedDetection {
    cctv_name: string;
    direction: string;
    vehicle_type: string;
    count: number;
}

interface SummaryCounts {
    [key: string]: number; // Total count per vehicle type
}

// Interface baru untuk detail IN/OUT per jenis kendaraan
interface VehicleInOutDetail {
    IN: number;
    OUT: number;
}

// Tambahkan interface untuk log deteksi
interface LatestDetection {
  timestamp: string; // Contoh: "2025-07-08T10:30:00Z"
  cctv_name: string;
  vehicle_type: string;
  direction: 'IN' | 'OUT';
}

// Interface baru untuk hasil pemrosesan data agregat
interface ProcessedDataResult {
    counts: SummaryCounts; // Total per jenis kendaraan
    inOutByVehicle: Record<string, VehicleInOutDetail>; // IN/OUT per jenis kendaraan
    totalIn: number;
    totalOut: number;
    totalOverall: number;
}


interface CCTVItem {
    id: number;
    name: string;
    brand: string;
    location: string;
    line_position: number;
    ip_address: string;
    rtsp_url: string;
    type: string;
}

interface CustomDateRange {
    startDate?: Date;
    endDate?: Date;
    key?: string;
}

// --- URL FastAPI Utama ---
const FASTAPI_BASE_URL = 'http://10.69.69.52:8002';
const DETECTION_BASE_URL = 'http://10.69.69.52:8001';

// Definisi Komponen Dashboard
export default function Dashboard() {
    // --- STATE MANAGEMENT ---
    const [globalVehicleType, setGlobalVehicleType] = useState('');
    const [globalDirection, setGlobalDirection] = useState('');
    const [globalCctvNameForData, setGlobalCctvNameForData] = useState('All');
    const [selectedCctvForStream, setSelectedCctvForStream] = useState('');

    const today = useMemo(() => new Date(), []);
    const yesterday = useMemo(() => subDays(today, 1), [today]);

    // State untuk loading
    const [isLoadingSummary, setIsLoadingSummary] = useState(false);
    const [isLoadingYesterday, setIsLoadingYesterday] = useState(false);
    const [showSpinnerTimeout, setShowSpinnerTimeout] = useState<NodeJS.Timeout | null>(null); // State baru untuk timeout

    // State untuk total keseluruhan
    const [actualTodayTotal, setActualTodayTotal] = useState<number>(0);
    const [actualYesterdayTotal, setActualYesterdayTotal] = useState<number>(0);

    // State untuk total IN/OUT keseluruhan
    const [actualTodayInOut, setActualTodayInOut] = useState({ IN: 0, OUT: 0 });
    const [actualYesterdayInOut, setActualYesterdayInOut] = useState({ IN: 0, OUT: 0 });

    // State baru untuk detail IN/OUT per jenis kendaraan
    const [todayVehicleInOutDetails, setTodayVehicleInOutDetails] = useState<Record<string, VehicleInOutDetail>>({});
    const [yesterdayVehicleInOutDetails, setYesterdayVehicleInOutDetails] = useState<Record<string, VehicleInOutDetail>>({});


    const [summaryDateRange, setSummaryDateRange] = useState<CustomDateRange[]>([
        { startDate: today, endDate: today, key: 'selection' },
    ]);
    const [showSummaryDatePicker, setShowSummaryDatePicker] = useState(false);
    const summaryPickerRef = useRef<HTMLDivElement>(null);

    // State untuk Pie Chart (total per jenis kendaraan)
    const [summaryPieChartCounts, setSummaryPieChartCounts] = useState<SummaryCounts>({});
    const [yesterdayPieChartCounts, setYesterdayPieChartCounts] = useState<SummaryCounts>({});

    const [chartDateRange, setChartDateRange] = useState<CustomDateRange[]>([
        { startDate: today, endDate: today, key: 'selection' },
    ]);
    const [showChartDatePicker, setShowChartDatePicker] = useState(false);
    const chartPickerRef = useRef<HTMLDivElement>(null);

    const [cctvList, setCctvList] = useState<CCTVItem[]>([]);

    const videoFeedUrl = selectedCctvForStream
        ? `${DETECTION_BASE_URL}/video_feed/${selectedCctvForStream}`
        : '';

    // --- HELPER FUNCTIONS ---
    const formatDateToYYYYMMDD = (date: Date | undefined): string => {
        if (!date) return '';
        const d = new Date(date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    };

    const formatDisplayDate = (date: Date | undefined): string => {
        if (!date) return '';
        return format(date, 'dd MMMM yyyy', { locale: id });
    };

    const getDateRangeDisplay = (ranges: CustomDateRange[]): string => {
        if (!ranges || ranges.length === 0 || !ranges[0]) {
            return 'Pilih Tanggal';
        }

        const { startDate, endDate } = ranges[0];

        if (!startDate || !endDate) {
            return 'Pilih Tanggal';
        }

        const formattedStartDate = format(startDate, 'dd MMMM yyyy', { locale: id });
        const formattedEndDate = format(endDate, 'dd MMMM yyyy', { locale: id });

        if (format(startDate, 'yyyy-MM-dd') === format(endDate, 'yyyy-MM-dd')) {
            return formattedStartDate;
        } else {
            return `${formattedStartDate} - ${formattedEndDate}`;
        }
    };

    const selectedDateRangeDisplay = getDateRangeDisplay(summaryDateRange);

    // Fungsi pemrosesan data agregat yang diperbarui
    const processAggregatedData = (data: AggregatedDetection[]): ProcessedDataResult => {
        const counts: SummaryCounts = {};
        const inOutByVehicle: Record<string, VehicleInOutDetail> = {}; // Objek baru
        let totalIn = 0;
        let totalOut = 0;
        let totalOverall = 0;

        data.forEach(item => {
            // Inisialisasi jika jenis kendaraan belum ada di inOutByVehicle
            if (!inOutByVehicle[item.vehicle_type]) {
                inOutByVehicle[item.vehicle_type] = { IN: 0, OUT: 0 };
            }

            // Update total counts per vehicle type (untuk Pie Chart dan total kolom 'Jumlah' di tabel)
            counts[item.vehicle_type] = (counts[item.vehicle_type] || 0) + item.count;
            totalOverall += item.count;

            // Update IN/OUT counts per vehicle type dan total keseluruhan
            if (item.direction === 'IN') {
                inOutByVehicle[item.vehicle_type].IN += item.count;
                totalIn += item.count;
            } else if (item.direction === 'OUT') {
                inOutByVehicle[item.vehicle_type].OUT += item.count;
                totalOut += item.count;
            }
        });

        return { counts, inOutByVehicle, totalIn, totalOut, totalOverall };
    };

    // Ref untuk AbortController (untuk mencegah race condition)
    const abortControllerRef = useRef<AbortController | null>(null);

    // --- DATA FETCHING (USEEFFECT & USECALLBACK) ---
    const fetchSummaryAndYesterdayData = useCallback(async (signal: AbortSignal) => {
        if (showSpinnerTimeout) {
            clearTimeout(showSpinnerTimeout);
        }

        const timeoutId = setTimeout(() => {
            setIsLoadingSummary(true);
            setIsLoadingYesterday(true);
        }, 1000); // Tunda tampilan spinner selama 200ms
        setShowSpinnerTimeout(timeoutId); // Simpan ID timeout

        const currentSummaryStartDate = formatDateToYYYYMMDD(summaryDateRange[0]?.startDate);
        const currentSummaryEndDate = formatDateToYYYYMMDD(summaryDateRange[0]?.endDate);
        const currentYesterdayDate = formatDateToYYYYMMDD(yesterday);

        const commonParams = {
            vehicle_type: globalVehicleType,
            direction: globalDirection,
            cctv_name: globalCctvNameForData !== 'All' ? globalCctvNameForData : undefined,
        };

        try {
            // Fetch data untuk summaryDateRange (Today/Selected Range)
            const summaryParams = new URLSearchParams();
            if (currentSummaryStartDate) summaryParams.append('start_date', currentSummaryStartDate);
            if (currentSummaryEndDate) summaryParams.append('end_date', currentSummaryEndDate);
            if (commonParams.vehicle_type) summaryParams.append('vehicle_type', commonParams.vehicle_type);
            if (commonParams.direction) summaryParams.append('direction', commonParams.direction);
            if (commonParams.cctv_name) summaryParams.append('cctv_name', commonParams.cctv_name);

            const summaryUrl = `${FASTAPI_BASE_URL}/api/detection/summary_daily/${summaryParams.toString() ? `?${summaryParams.toString()}` : ''}`;
            console.log('Fetching summary table data from:', summaryUrl);

            const summaryResponse = await axios.get<AggregatedDetection[]>(summaryUrl, { signal });
            const {
                counts: sCounts,
                inOutByVehicle: sInOutByVehicle, // Tangkap data IN/OUT per kendaraan
                totalIn: sTotalIn,
                totalOut: sTotalOut,
                totalOverall: sTotalOverall
            } = processAggregatedData(summaryResponse.data);
            
            setSummaryPieChartCounts(sCounts);
            setTodayVehicleInOutDetails(sInOutByVehicle); // Simpan detail IN/OUT per kendaraan hari ini
            setActualTodayInOut({ IN: sTotalIn, OUT: sTotalOut });
            setActualTodayTotal(sTotalOverall);

            // Fetch data untuk Yesterday (setelah summary, atau paralel jika mau)
            const yesterdayParams = new URLSearchParams();
            yesterdayParams.append('start_date', currentYesterdayDate);
            yesterdayParams.append('end_date', currentYesterdayDate);
            if (commonParams.vehicle_type) yesterdayParams.append('vehicle_type', commonParams.vehicle_type);
            if (commonParams.direction) yesterdayParams.append('direction', commonParams.direction);
            if (commonParams.cctv_name) yesterdayParams.append('cctv_name', commonParams.cctv_name);

            const yesterdayUrl = `${FASTAPI_BASE_URL}/api/detection/summary_daily/${yesterdayParams.toString() ? `?${yesterdayParams.toString()}` : ''}`;
            console.log('Fetching yesterday table data from:', yesterdayUrl);

            const yesterdayResponse = await axios.get<AggregatedDetection[]>(yesterdayUrl, { signal });
            const {
                counts: yCounts,
                inOutByVehicle: yInOutByVehicle, // Tangkap data IN/OUT per kendaraan kemarin
                totalIn: yTotalIn,
                totalOut: yTotalOut,
                totalOverall: yTotalOverall
            } = processAggregatedData(yesterdayResponse.data);
            
            setYesterdayPieChartCounts(yCounts);
            setYesterdayVehicleInOutDetails(yInOutByVehicle); // Simpan detail IN/OUT per kendaraan kemarin
            setActualYesterdayInOut({ IN: yTotalIn, OUT: yTotalOut });
            setActualYesterdayTotal(yTotalOverall);

        } catch (error: any) {
            if (axios.isCancel(error)) {
                console.log('Fetch for summary/yesterday data was cancelled:', error.message);
            } else {
                console.error('Error fetching summary/yesterday table data:', error);
            }
        } finally {
            setIsLoadingSummary(false);
            setIsLoadingYesterday(false);
        }
    }, [
        summaryDateRange,
        yesterday,
        globalVehicleType,
        globalDirection,
        globalCctvNameForData,
    ]);

    useEffect(() => {
        const abortController = new AbortController();
        const signal = abortController.signal;

        // Panggil fetch data pertama kali
        fetchSummaryAndYesterdayData(signal);

        // Atur interval untuk refresh data secara periodik
        const refreshInterval = setInterval(() => {
            fetchSummaryAndYesterdayData(signal);
        }, 1000); // Refresh setiap 10 detik

        // Cleanup function
        return () => {
            clearInterval(refreshInterval); // Hentikan interval
            abortController.abort(); // Batalkan request
        };
    }, [fetchSummaryAndYesterdayData]); // Hanya bergantung pada fungsi fetch

    // --- useEffect untuk Fetch daftar CCTV unik dari endpoint /api/cctv/ ---
    useEffect(() => {
        const fetchAllCctvData = async () => {
            try {
                const response = await axios.get<CCTVItem[]>(`${FASTAPI_BASE_URL}/api/cctv/`);
                setCctvList(response.data);
                if (response.data.length > 0) {
                    // Set default selectedCctvForStream jika belum ada yang terpilih
                    if (!selectedCctvForStream) {
                        setSelectedCctvForStream(response.data[0].name);
                    }
                }
            } catch (error) {
                console.error('Error fetching CCTV list:', error);
                setCctvList([]);
            }
        };
        fetchAllCctvData();
    }, [selectedCctvForStream, FASTAPI_BASE_URL]); // Tambahkan FASTAPI_BASE_URL sebagai depedency meskipun konstan, agar konsisten


    // Effect untuk menutup date picker saat klik di luar
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
                <div className="grid md:grid-cols-8 lg:grid-cols-12">
                    {/* --- AKHIR DROPDOWN FILTER DATA --- */}
                </div>

                <hr className="border-t border-gray-300 my-4" />

                <main>
                    <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
                        {/* Bagian Ringkasan Tabel (tetap menggunakan globalCctvNameForData) */}
                        <section className="md:col-span-2 space-y-4 order-2 md:order-1">
                            <div className="relative mb-4" ref={summaryPickerRef}>
                                <label className="text-sm font-medium mb-1 text-gray-600 flex items-center justify-start">
                                    Filter
                                    <select value={globalVehicleType} onChange={e => setGlobalVehicleType(e.target.value)} className="flex items-center gap-1.5 bg-transparent border-[1.5px] border-neutral/30 focus:border-primary/main focus:text-primary/main rounded-md h-7 px-2 py-0 text-xs hover:bg-primary/10 focus:bg-primary/10 ml-2">
                                        <option value="">Semua</option>
                                        <option value="Mobil">Mobil</option>
                                        <option value="Motor">Motor</option>
                                        <option value="Bus">Bus</option>
                                        <option value="Truk">Truk</option>
                                        <option value="Sepeda">Sepeda</option>
                                    </select>

                                    <select value={globalDirection} onChange={e => setGlobalDirection(e.target.value)} className="flex items-center gap-1.5 bg-transparent border-[1.5px] border-neutral/30 focus:border-primary/main focus:text-primary/main rounded-md h-7 px-2 py-0 text-xs hover:bg-primary/10 focus:bg-primary/10 ml-2">
                                        <option value="">Semua</option>
                                        <option value="IN">Masuk</option>
                                        <option value="OUT">Keluar</option>
                                    </select>

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
                                            ranges={summaryDateRange as Range[]}
                                            onChange={item => {
                                                setSummaryDateRange([item.selection]);
                                                setShowSummaryDatePicker(false);
                                            }}
                                            moveRangeOnFirstSelection={false}
                                            months={1}
                                            direction="horizontal"
                                            rangeColors={['#3d91ff']}
                                            locale={id}
                                        />
                                    </div>
                                )}
                                <br></br>
                                <label className="text-sm font-medium mb-1 text-gray-600 flex items-center justify-end">
                                <select
                                        value={globalCctvNameForData}
                                        onChange={e => setGlobalCctvNameForData(e.target.value)}
                                        className="flex items-center gap-1.5 bg-transparent border-[1.5px] border-neutral/30 focus:border-primary/main focus:text-primary/main rounded-md h-7 px-2 py-0 text-xs hover:bg-primary/10 focus:bg-primary/10 ml-2"
                                >
                                        <option value="All">Semua CCTV</option>
                                        {cctvList.map(cctv => (
                                            <option key={cctv.name} value={cctv.name}>{cctv.location}</option>
                                        ))}
                                </select>
                                </label>
                            </div>
                            <SummaryTable
                                pieChartCounts={summaryPieChartCounts}
                                pieChartCountsYesterday={yesterdayPieChartCounts}
                                todayDateFormatted={formatDisplayDate(today)}
                                yesterdayDateFormatted={formatDisplayDate(yesterday)}
                                // Pass the actual number, SummaryTable will handle the loading display
                                actualTodayTotal={actualTodayTotal}
                                actualYesterdayTotal={actualYesterdayTotal}
                                actualTodayInOut={actualTodayInOut}
                                actualYesterdayInOut={actualYesterdayInOut}
                                // This is the key: tell SummaryTable that it should show its loading state
                                todayVehicleInOutDetails={todayVehicleInOutDetails}
                                yesterdayVehicleInOutDetails={yesterdayVehicleInOutDetails}
                                summaryDisplayDate={selectedDateRangeDisplay}
                                isLoading={isLoadingSummary || isLoadingYesterday}
                            />
                        </section>

                        <section className="md:col-span-3 space-y-4 order-1 md:order-2">
                            {/* --- BAGIAN VIDEO KAMERA CCTV (Menggunakan selectedCctvForStream) --- */}
                            <div className="bg-white rounded-xl shadow p-4">
                                <h2 className="text-base font-semibold mb-2 text-gray-700">Video Kamera CCTV</h2>

                                <div className="mb-4 flex items-center gap-2 justify-end">
                                    <label className="text-sm font-medium text-gray-600 whitespace-nowrap">CCTV Live Stream:</label>
                                    <Listbox value={selectedCctvForStream} onChange={setSelectedCctvForStream}>
                                        {({ open }) => (
                                            <div className="relative">
                                                <Listbox.Button
                                                    className="overflow-hidden transition flex items-center justify-between gap-3 bg-transparent border-[1.5px] border-neutral-300 disabled:bg-neutral/20 disabled:border-neutral/30 disabled:text-neutral/60 disabled:cursor-not-allowed focus:shadow-focus h-[32px] px-4 py-[6px] text-sm hover:bg-primary-100 focus:bg-primary-100 focus:shadow-blue-200 [&.auto-active]:text-neutral-100 [&.auto-active]:focus:text-blue-500 [&.auto-active]:focus:border-blue-500 [&.active]:border-blue-500 [&.active]:text-blue-500 [&.auto-active]:border-neutral-400 rounded-md auto-active"
                                                >
                                                    <span className="block truncate text-gray-700 text-left">
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

                                <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                                    {selectedCctvForStream ? (
                                        <img
                                            className="absolute top-0 left-0 w-full h-full rounded-lg object-contain bg-black"
                                            src={videoFeedUrl}
                                            alt={`Live Stream dari ${currentCctv?.location || selectedCctvForStream}`}
                                            onError={(e) => { e.currentTarget.src = '/placeholder-video.png'; e.currentTarget.alt = 'Video stream failed to load.'; }}
                                        />
                                    ) : (
                                        <div className="absolute top-0 left-0 w-full h-full rounded-lg bg-gray-200 flex items-center justify-center text-gray-500">
                                            <p className="text-center">Pilih CCTV dari dropdown di atas untuk melihat live stream deteksi.</p>
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
                                                ranges={chartDateRange as Range[]}
                                                onChange={item => {
                                                    setChartDateRange([item.selection]);
                                                    setShowChartDatePicker(false);
                                                }}
                                                moveRangeOnFirstSelection={false}
                                                months={1}
                                                direction="horizontal"
                                                rangeColors={['#3d91ff']}
                                                locale={id}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-grow">
                                    <ChartSection
                                        cctvName={globalCctvNameForData === 'All' ? 'Semua' : globalCctvNameForData}
                                        direction={globalDirection}
                                        selectedDate={formatDateToYYYYMMDD(chartDateRange[0]?.startDate || new Date())}
                                        vehicleType={globalVehicleType}
                                    />
                                </div>
                            </div>
                        </section>

                        <section className="md:col-span-2 space-y-4 order-3 md:order-3">
                            <div className="bg-white rounded-xl shadow p-4 flex flex-col items-center">
                                <h2 className="text-base font-semibold mb-2 text-gray-700">Distribusi Jenis Kendaraan
                                <span className="ml-2 text-gray-500 font-medium text-xs">{selectedDateRangeDisplay}</span>
                                </h2>
                                <div className="flex-grow flex items-center justify-center w-full">
                                    <PieChart counts={summaryPieChartCounts} />
                                </div>
                            </div>
                        </section>
                    </div>
                </main>
            </div>
        </div>
    );
}