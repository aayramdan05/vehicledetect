// components/ui/card.tsx
import React from "react";
import { cn } from "@/lib/utils"; // pastikan kamu punya helper cn untuk menggabungkan className

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border bg-white text-card-foreground shadow-sm", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
