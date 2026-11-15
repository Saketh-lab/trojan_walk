"use client";

import { Car } from "lucide-react";
import { lyftLinks, openLyft, type Point } from "@/lib/lyft";
import { cn } from "@/lib/utils";

export function LyftButton({
  dest,
  pickup,
  variant = "secondary",
  label = "Take a Lyft instead",
}: {
  dest: Point | null;
  pickup?: Point | null;
  variant?: "secondary" | "card";
  label?: string;
}) {
  if (!dest) return null;
  const links = lyftLinks(dest, pickup);
  return (
    <a
      href={links.app}
      data-web-fallback={links.web}
      onClick={(e) => {
        e.preventDefault();
        openLyft(links);
      }}
      className={cn(
        "flex items-center justify-center gap-2 font-display font-semibold",
        variant === "secondary"
          ? "h-12 rounded-[12px] bg-surface text-base text-ink"
          : "h-16 rounded-[12px] border border-cardinal bg-background text-xl text-ink"
      )}
    >
      <Car className="h-5 w-5" /> {label}
    </a>
  );
}
