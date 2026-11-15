import Link from "next/link";
import { Users, Navigation, Radio, Phone, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = { n: string; label: string; icon: LucideIcon; escalation?: boolean; href?: string };

const steps: Step[] = [
  { n: "01", label: "Walk with me", icon: Users, href: "/request" },
  { n: "02", label: "Share my walk", icon: Navigation },
  { n: "03", label: "Broadcast", icon: Radio, escalation: true },
  { n: "04", label: "Emergency", icon: Phone, escalation: true },
];

function Patch({ n }: { n: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] border-2 border-current font-display text-lg font-bold">
      {n}
    </span>
  );
}

function Row({ step, className }: { step: Step; className?: string }) {
  const Icon = step.icon;
  const cls = cn(
    "flex w-full items-center gap-4 px-4 py-5 text-left transition-opacity active:opacity-80",
    className
  );
  const inner = (
    <>
      <Patch n={step.n} />
      <span className="flex-1 font-display text-xl font-semibold">{step.label}</span>
      <Icon className="h-6 w-6" />
    </>
  );
  return step.href ? (
    <Link href={step.href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={cls}>
      {inner}
    </button>
  );
}

export function EscalationLadder() {
  const [a, b, c, d] = steps;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[12px] border border-cardinal bg-surface text-ink">
        <Row step={a} />
        <div className="mx-4 h-px bg-border" />
        <Row step={b} />
      </div>
      <Row step={c} className="rounded-[16px] bg-escalation text-white" />
      <Row step={d} className="rounded-[16px] bg-escalation text-white" />
    </div>
  );
}
