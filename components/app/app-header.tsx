"use client";

import { useRef } from "react";
import { Menu, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppHeader({ onWordmarkTripleTap }: { onWordmarkTripleTap?: () => void }) {
  const taps = useRef<number[]>([]);

  function tap() {
    if (!onWordmarkTripleTap) return;
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 700), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      onWordmarkTripleTap();
    }
  }

  return (
    <header className="flex items-center justify-between">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Menu"
        className="h-10 w-10 rounded-[10px] bg-surface text-ink hover:bg-surface hover:text-gold"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <h1
        onClick={tap}
        className="select-none font-display text-2xl font-bold tracking-wide text-ink"
      >
        TROJANWALK
      </h1>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        className="h-10 w-10 rounded-[10px] bg-surface text-ink hover:bg-surface hover:text-gold"
      >
        <Bell className="h-5 w-5" />
      </Button>
    </header>
  );
}
