"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useLocation } from "@/lib/use-location";
import { haversine } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { ExpiredOptions, type Trip } from "@/components/app/expired-options";
import { useRef } from "react";

type Parsed = {
  origin_slug: string | null;
  origin_label: string | null;
  dest_slug: string | null;
  dest_label: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  leave_in_s: number;
  confidence: number;
  source?: string;
};

type Phase =
  | { name: "compose" }
  | { name: "form"; note: string }
  | { name: "searching"; requestId: string; notified: number; startedAt: number }
  | { name: "expired"; requestId: string };

const CONFIDENT = 0.7;
const SEARCH_S = 180;
const LEAVE_OPTIONS = [
  { s: 0, label: "Now" },
  { s: 120, label: "In 2 min" },
  { s: 300, label: "In 5 min" },
  { s: 600, label: "In 10 min" },
];

const field =
  "w-full rounded-[12px] border border-border bg-surface px-4 text-base text-ink placeholder:text-dim outline-none focus:border-gold";

export function RequestScreen() {
  const router = useRouter();
  const { supabase, places, position, geoError } = useLocation();
  const [text, setText] = useState("");
  const [destSlug, setDestSlug] = useState("");
  const [leaveIn, setLeaveIn] = useState(120);
  const [phase, setPhase] = useState<Phase>({ name: "compose" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(SEARCH_S);
  const trip = useRef<Trip | null>(null);

  const landmarks = places.filter((p) => p.kind !== "safe_spot");
  const here = position
    ? [...landmarks].sort((a, b) => haversine(position, a) - haversine(position, b))[0]
    : null;

  const send = useCallback(
    async (destination: string, leave: number, raw: string | null) => {
      const dest = landmarks.find((p) => p.slug === destination);
      if (!position || !dest) {
        setError(!position ? "Turn on location (or demo mode) first." : "Pick a destination.");
        return;
      }
      setBusy(true);
      setError(null);
      const { data: auth } = await supabase.auth.getUser();
      const { data: row, error: insErr } = await supabase
        .from("requests")
        .insert({
          requester: auth.user!.id,
          kind: "walk",
          origin: `SRID=4326;POINT(${position.lng} ${position.lat})`,
          origin_label: here?.label ?? null,
          dest: `SRID=4326;POINT(${dest.lng} ${dest.lat})`,
          dest_label: dest.label,
          leave_at: new Date(Date.now() + leave * 1000).toISOString(),
          raw_text: raw,
          expires_at: new Date(Date.now() + SEARCH_S * 1000).toISOString(), // server overrides
        })
        .select("id")
        .single();
      if (insErr || !row) {
        setBusy(false);
        setError(
          insErr?.message.includes("requests_one_open_per_user")
            ? "You already have an open request. Wait for it to finish or cancel it."
            : insErr?.message ?? "Could not create the request."
        );
        return;
      }
      const { data: fan, error: fanErr } = await supabase.functions.invoke("fanout", {
        body: { request_id: row.id },
      });
      setBusy(false);
      if (fanErr) return setError(`Request saved but fan-out failed: ${fanErr.message}`);
      trip.current = { pickup: position, dest: { lat: dest.lat, lng: dest.lng, label: dest.label } };
      setLeft(SEARCH_S);
      setPhase({ name: "searching", requestId: row.id, notified: fan?.rung2 ?? 0, startedAt: Date.now() });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, position, here?.label, places]
  );

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!position) return setError(geoError ?? "Turn on location (or demo mode) first.");
    if (!text.trim() && !destSlug) return setError("Say where you're headed, or pick a destination.");

    // The user already confirmed or corrected the parse in the form: send those fields as-is.
    if (phase.name === "form") return send(destSlug, leaveIn, text.trim() || null);

    // Destination picked and no text: skip the model.
    if (!text.trim()) return send(destSlug, leaveIn, null);

    setBusy(true);
    const { data, error: fnErr } = await supabase.functions.invoke("parse-request", {
      body: { text: text.trim(), lat: position.lat, lng: position.lng },
    });
    setBusy(false);
    if (fnErr || !data) return setError("Couldn't read that. Pick a destination below.");
    const p = data as Parsed;
    if (p.dest_slug) setDestSlug(p.dest_slug);
    setLeaveIn(nearestLeave(p.leave_in_s));
    if (p.confidence >= CONFIDENT && p.dest_slug) return send(p.dest_slug, p.leave_in_s, text.trim());
    setPhase({
      name: "form",
      note: p.dest_slug
        ? `Check this: we read the destination as ${p.dest_label}. Confirm or change it.`
        : "We couldn't tell where you're headed. Pick a destination.",
    });
  }

  // Searching: countdown + watch for a match (realtime + poll as a safety net).
  const reqId = phase.name === "searching" ? phase.requestId : null;
  useEffect(() => {
    if (!reqId) return;
    let done = false;
    const check = async () => {
      if (done) return;
      const { data: r } = await supabase.from("requests").select("status").eq("id", reqId).single();
      if (r?.status === "matched") {
        const { data: s } = await supabase.from("sessions").select("id").eq("request_id", reqId).single();
        if (s) {
          done = true;
          router.push(`/session/${s.id}`);
        }
      } else if (r && r.status !== "open") {
        done = true;
        setPhase({ name: "expired", requestId: reqId });
      }
    };
    const channel = supabase
      .channel(`request-${reqId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "requests", filter: `id=eq.${reqId}` }, check)
      .subscribe();
    const poll = setInterval(check, 2000);
    const tick = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => {
      done = true;
      clearInterval(poll);
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [reqId, supabase, router]);

  async function cancel() {
    if (phase.name === "searching") await supabase.rpc("cancel_request", { req: phase.requestId });
    setPhase({ name: "compose" });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <Link
          href="/map"
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-3xl font-bold">Walk with me</h1>
      </header>

      {phase.name === "searching" ? (
        <section className="flex flex-col gap-5 rounded-[12px] bg-surface p-5">
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-gold" />
            <h2 className="font-display text-2xl font-semibold">Looking for company</h2>
          </div>
          <p className="text-dim">
            {phase.notified > 0
              ? `Asked ${phase.notified} nearby friend${phase.notified === 1 ? "" : "s"}.`
              : "No friends are nearby right now. Matching Walkers are asked in a moment."}{" "}
            Your exact spot is shared only with whoever you walk with.
          </p>
          <p className="font-display text-4xl font-bold" aria-label="Time left">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </p>
          <Button onClick={cancel} variant="ghost" className="h-12 rounded-[12px] bg-background font-display text-base font-semibold text-ink">
            Cancel request
          </Button>
        </section>
      ) : phase.name === "expired" ? (
        <ExpiredOptions
          supabase={supabase}
          requestId={phase.requestId}
          trip={trip.current}
          onRetry={() => setPhase({ name: "compose" })}
        />
      ) : (
        <form onSubmit={submitText} className="flex flex-col gap-4">
          {phase.name === "form" && (
            <p className="rounded-[12px] border border-cardinal bg-surface px-4 py-3 text-sm">{phase.note}</p>
          )}
          <label className="flex flex-col gap-2 text-sm text-dim">
            Where are you headed?
            <textarea
              rows={2}
              className={`${field} py-3`}
              placeholder="leaving leavey in 2, heading to the lo"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-dim">
            Destination
            <select className={`${field} h-14`} value={destSlug} onChange={(e) => setDestSlug(e.target.value)}>
              <option value="">Choose a destination</option>
              {landmarks.map((p) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm text-dim">
            Leaving
            <select className={`${field} h-14`} value={leaveIn} onChange={(e) => setLeaveIn(Number(e.target.value))}>
              {LEAVE_OPTIONS.map((o) => (
                <option key={o.s} value={o.s}>{o.label}</option>
              ))}
            </select>
          </label>
          <p className="text-sm text-dim">
            {here ? `From ${here.label}.` : geoError ?? "Finding where you are…"}
          </p>
          {error && <p className="text-sm text-gold">{error}</p>}
          <Button
            type="submit"
            disabled={busy || !position}
            className="h-14 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink hover:bg-cardinal/90"
          >
            {busy ? "Working…" : phase.name === "form" ? "Send request" : "Find company"}
          </Button>
        </form>
      )}
    </div>
  );
}

function nearestLeave(s: number) {
  return LEAVE_OPTIONS.reduce((best, o) => (Math.abs(o.s - s) < Math.abs(best.s - s) ? o : best)).s;
}
