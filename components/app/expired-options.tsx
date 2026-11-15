"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Point } from "@/lib/lyft";
import { LyftButton } from "@/components/app/lyft-button";
import { Button } from "@/components/ui/button";

export type Trip = { pickup: Point | null; dest: Point & { label: string } };

const field =
  "h-14 w-full rounded-[12px] border border-border bg-background px-4 text-base text-ink placeholder:text-dim outline-none focus:border-gold";

/** Shown when a walk request expires with no accept: take a Lyft, or walk with a watcher. */
export function ExpiredOptions({
  supabase,
  requestId,
  trip,
  onRetry,
}: {
  supabase: SupabaseClient;
  requestId: string;
  trip: Trip | null;
  onRetry: () => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<string[]>([]);
  const [watching, setWatching] = useState(false);
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("emergency_contacts")
      .maybeSingle()
      .then(({ data }) => setSaved((data?.emergency_contacts as string[] | undefined) ?? []));
  }, [supabase]);

  async function startWatcher(number: string) {
    const digits = number.replace(/[\s().-]/g, "");
    // A bare 10-digit US number is assumed to be +1.
    const e164 = /^\d{10}$/.test(digits) ? `+1${digits}` : digits;
    setBusy(true);
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke("watch", {
      body: { request_id: requestId, contact: e164 },
    });
    if (fnErr || !data?.session_id) {
      setBusy(false);
      let msg = "Couldn't start a watched walk.";
      try {
        const body = await (fnErr as { context?: Response }).context?.json();
        if (body?.error) msg = body.error;
      } catch {}
      return setError(msg);
    }
    router.push(`/session/${data.session_id}`);
  }

  return (
    <section className="flex flex-col gap-4 rounded-[12px] bg-surface p-5">
      <h2 className="font-display text-2xl font-semibold">No one yet</h2>
      <p className="text-dim">Nobody joined in time. You still have two good options.</p>

      <LyftButton dest={trip?.dest ?? null} pickup={trip?.pickup} variant="card" label="Open Lyft" />
      <p className="-mt-2 text-xs text-dim">Opens Lyft with your trip ready. Pick Shared to use the USC pass.</p>

      {!watching ? (
        <button
          type="button"
          onClick={() => setWatching(true)}
          className="flex h-16 items-center justify-center gap-2 rounded-[12px] border border-cardinal bg-background font-display text-xl font-semibold"
        >
          <Eye className="h-5 w-5" /> Walk with a watcher
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-[12px] border border-cardinal bg-background p-4">
          <p className="font-display text-xl font-semibold">Who should watch your walk?</p>
          <p className="text-sm text-dim">
            They get a link to your last location and a text if you miss a safety check-in. No app needed.
          </p>
          {saved.map((n) => (
            <Button
              key={n}
              disabled={busy}
              onClick={() => startWatcher(n)}
              className="h-12 justify-start rounded-[12px] bg-surface font-display text-base font-semibold text-ink hover:bg-surface"
            >
              Contact ending {n.slice(-4)}
            </Button>
          ))}
          <input
            className={field}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Another number, e.g. +12135550123"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
          {error && <p className="text-sm text-gold">{error}</p>}
          <Button
            disabled={busy || !contact.trim()}
            onClick={() => startWatcher(contact)}
            className="h-14 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink hover:bg-cardinal/90"
          >
            {busy ? "Starting…" : "Start watched walk"}
          </Button>
        </div>
      )}

      <Button
        onClick={onRetry}
        variant="ghost"
        className="h-12 rounded-[12px] bg-background font-display text-base font-semibold text-ink"
      >
        Try again
      </Button>
    </section>
  );
}
