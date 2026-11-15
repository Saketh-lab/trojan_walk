"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { useDemo, DemoPlace } from "@/lib/use-demo";

type Demo = ReturnType<typeof useDemo>;

const select =
  "h-12 w-full rounded-[12px] border border-border bg-background px-3 text-base text-ink outline-none focus:border-gold";

export function DemoPanel({
  open,
  onOpenChange,
  demo,
  places,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  demo: Demo;
  places: DemoPlace[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="inset-x-4 bottom-4 mx-auto max-w-[398px] rounded-[16px] border border-border bg-surface p-5 text-ink"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-2xl font-bold text-ink">Demo mode</SheetTitle>
          <SheetDescription className="text-dim">
            Pins this tab to a fixed spot instead of GPS. Everything else is real.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex flex-col gap-4">
          <label className="flex items-center justify-between gap-3 rounded-[12px] bg-background px-4 py-4">
            <span className="font-display text-lg font-semibold">Use fake position</span>
            <input
              type="checkbox"
              className="h-6 w-6 accent-[#990000]"
              checked={demo.enabled}
              onChange={(e) => demo.setEnabled(e.target.checked)}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-dim">
            Start at
            <select className={select} value={demo.origin?.slug ?? ""} onChange={(e) => demo.setOrigin(e.target.value)}>
              <option value="" disabled>Choose a place</option>
              {places.map((p) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm text-dim">
            Walk toward
            <select className={select} value={demo.dest?.slug ?? ""} onChange={(e) => demo.setDest(e.target.value)}>
              <option value="" disabled>Choose a destination</option>
              {places.map((p) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={!demo.enabled || !demo.origin || !demo.dest}
            onClick={demo.toggleWalk}
            className="h-14 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink disabled:opacity-40"
          >
            {demo.walking ? "Stop walking" : "Walk"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
