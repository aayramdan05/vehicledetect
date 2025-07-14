// src/lib/utils.ts

// Fungsi untuk menggabungkan nama kelas (cn)
export function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
