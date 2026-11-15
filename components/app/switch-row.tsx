import { cn } from "@/lib/utils";

export function SwitchRow({
  title,
  hint,
  on,
  onChange,
  disabled,
}: {
  title: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[12px] bg-surface px-4 py-4">
      <div className="min-w-0">
        <p className="font-display text-xl font-semibold">{title}</p>
        {hint && <p className="text-sm text-dim">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn(
          "relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
          on ? "bg-cardinal" : "bg-[#2E2A26]"
        )}
      >
        <span
          className={cn("absolute top-1 h-6 w-6 rounded-full transition-all", on ? "left-7 bg-gold" : "left-1 bg-ink")}
        />
      </button>
    </div>
  );
}
