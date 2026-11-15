import { cn } from "@/lib/utils";

export function WalkingToggle({
  on,
  onChange,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[12px] bg-surface px-4 py-4">
      <div className="min-w-0">
        <p className="font-display text-xl font-semibold">Walking alone</p>
        <p className="text-sm text-dim">
          {hint ?? (on ? "Nearby Trojans see you as an anonymous dot." : "Off. Your location is not shared.")}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Walking alone"
        onClick={() => onChange(!on)}
        className={cn(
          "relative h-8 w-14 shrink-0 rounded-full transition-colors",
          on ? "bg-cardinal" : "bg-[#2E2A26]"
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-6 w-6 rounded-full transition-all",
            on ? "left-7 bg-gold" : "left-1 bg-ink"
          )}
        />
      </button>
    </div>
  );
}
