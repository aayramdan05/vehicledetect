import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://10.69.69.52:3000', // Tambahkan IP Anda di sini
  ],
};

export default nextConfig;
