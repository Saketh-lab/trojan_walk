"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, MapPin, Phone, Radio, Star, User } from "lucide-react";
import { useLocation } from "@/lib/use-location";
import { haversine } from "@/lib/geo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type SafeSpot = { label: string; minutes: number; metres: number };
type Live = { requestId: string; area: string; expiresAt: string; spots: SafeSpot[]; notified: number | null };
type Responder = {
  user_id: string;
  response: "applied" | "accepted";
  class_year: number | null;
  is_walker: boolean;
  rating_avg: number | null;
  rating_count: number | null;
  distance_m: number | null;
};
type Phase =
  | { name: "compose" }
  | { name: "live"; live: Live }
  | { name: "ended"; why: "cancelled" | "expired" }
  | { name: "limit" };

const DPS_TEL = "tel:+12137404321";
const field =
  "h-14 w-full rounded-[12px] border border-border bg-surface px-4 text-base text-ink placeholder:text-dim outline-none focus:border-gold";

export function BroadcastScreen() {
  const router = useRouter();
  const { supabase, places, position, geoError } = useLocation();
  const [phase, setPhase] = useState<Phase>({ name: "compose" });
  const [areaSlug, setAreaSlug] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const picked = useRef(false);

  const landmarks = useMemo(() => places.filter((p) => p.kind !== "safe_spot"), [places]);
  const nearest = useMemo(
    () => (position ? [...landmarks].sort((a, b) => haversine(position, a) - haversine(position, b))[0] : null),
    [landmarks, position]
  );
  useEffect(() => {
    if (!picked.current && nearest) setAreaSlug(nearest.slug);
  }, [nearest]);
  const area = landmarks.find((p) => p.slug === areaSlug) ?? nearest;

  // Resume if a broadcast is already open (the function returns it instead of starting another).
  async function send() {
    if (!position) return setError(geoError ?? "Turn on location (or demo mode) first.");
    setBusy(true);
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke("broadcast", {
      body: { lat: position.lat, lng: position.lng, area_slug: areaSlug || undefined, note: note.trim() || undefined },
    });
    setBusy(false);
    setConfirm(false);
    if (fnErr) {
      const res = (fnErr as { context?: Response }).context;
      if (res?.status === 429) return setPhase({ name: "limit" });
      return setError("Couldn't send the broadcast. Try again, or use Emergency.");
    }
    setPhase({
      name: "live",
      live: {
        requestId: data.request_id,
        area: data.area_label,
        expiresAt: data.expires_at,
        spots: data.safe_spots ?? [],
        notified: data.notified ?? null,
      },
    });
  }

  // Live: responder cards (restricted view, no names), status, countdown.
  const requestId = phase.name === "live" ? phase.live.requestId : null;
  useEffect(() => {
    if (!requestId) return;
    let done = false;
    const load = async () => {
      if (done) return;
      const { data: rs } = await supabase
        .from("request_responders")
        .select("user_id,response,class_year,is_walker,rating_avg,rating_count,distance_m")
        .eq("request_id", requestId);
      if (!done) setResponders((rs ?? []) as Responder[]);
      const { data: r } = await supabase.from("requests").select("status").eq("id", requestId).single();
      if (r?.status === "matched") {
        const { data: s } = await supabase.from("sessions").select("id").eq("request_id", requestId).maybeSingle();
        if (s) {
          done = true;
          router.push(`/session/${s.id}`);
        }
      } else if (r && r.status !== "open") {
        done = true;
        setPhase({ name: "ended", why: r.status === "cancelled" ? "cancelled" : "expired" });
      }
    };
    load();
    const channel = supabase
      .channel(`bcast-${requestId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_targets", filter: `request_id=eq.${requestId}` }, load)
      .subscribe();
    const poll = setInterval(load, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      done = true;
      clearInterval(poll);
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [requestId, supabase, router]);

  async function approve(userId: string) {
    if (!requestId) return;
    setBusy(true);
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke("approve", { body: { request_id: requestId, user_id: userId } });
    setBusy(false);
    if (fnErr || !data?.session_id) return setError("Couldn't confirm that person. Try again.");
    router.push(`/session/${data.session_id}`);
  }

  async function imSafe() {
    if (!requestId) return;
    await supabase.rpc("cancel_request", { req: requestId });
    setPhase({ name: "ended", why: "cancelled" });
  }

  const emergency = (
    <a
      href={DPS_TEL}
      className="flex items-center gap-4 rounded-[16px] bg-escalation px-4 py-5 text-white"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] border-2 border-current">
        <Phone className="h-5 w-5" />
      </span>
      <span className="flex-1 font-display text-xl font-semibold">Emergency</span>
      <span className="text-sm">Call DPS</span>
    </a>
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <Link href="/map" aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-surface">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-3xl font-bold">Broadcast</h1>
      </header>

      {phase.name === "compose" && (
        <>
          <p className="text-dim">
            Feel threatened but don&apos;t want to call police yet? Ask nearby Trojans for a person to come. They see the
            area, never your name or exact spot. You choose who comes.
          </p>
          <label className="flex flex-col gap-2 text-sm text-dim">
            Area
            <select
              className={field}
              value={areaSlug}
              onChange={(e) => {
                picked.current = true;
                setAreaSlug(e.target.value);
              }}
            >
              {landmarks.map((p) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm text-dim">
            Short label (optional)
            <input
              className={field}
              maxLength={40}
              placeholder="e.g. east entrance"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <span className="text-xs">Only you and DPS see this. Responders see the area only.</span>
          </label>
          {error && <p className="text-sm text-gold">{error}</p>}
          <button
            type="button"
            disabled={!position || !area}
            onClick={() => setConfirm(true)}
            className="flex h-24 w-full items-center justify-center gap-3 rounded-[16px] bg-escalation font-display text-3xl font-bold text-white disabled:opacity-50"
          >
            <Radio className="h-8 w-8" /> Broadcast
          </button>
          {!position && <p className="text-sm text-dim">{geoError ?? "Finding where you are…"}</p>}
          {emergency}
        </>
      )}

      {phase.name === "limit" && (
        <section className="flex flex-col gap-4 rounded-[12px] bg-surface p-5">
          <h2 className="font-display text-2xl font-semibold">Use Emergency</h2>
          <p className="text-dim">You&apos;ve used both broadcasts for tonight. If you need help now, call DPS.</p>
          {emergency}
        </section>
      )}

      {phase.name === "ended" && (
        <section className="flex flex-col gap-4 rounded-[12px] bg-surface p-5">
          <h2 className="font-display text-2xl font-semibold">
            {phase.why === "cancelled" ? "Broadcast cancelled" : "Broadcast ended"}
          </h2>
          <p className="text-dim">
            {phase.why === "cancelled"
              ? "Glad you're safe. People who offered to come were told you're okay."
              : "No one was chosen in time. If you still need help, call DPS."}
          </p>
          <Link href="/map" className="flex h-12 items-center justify-center rounded-[12px] bg-cardinal font-display text-lg font-semibold">
            Back home
          </Link>
        </section>
      )}

      {phase.name === "live" && (
        <>
          <section className="flex flex-col gap-3" aria-label="Nearest safe spots">
            <h2 className="font-display text-2xl font-semibold">Nearest safe spots</h2>
            {phase.live.spots.length === 0 ? (
              <p className="text-dim">No staffed safe spots are open right now. Call DPS if you need help.</p>
            ) : (
              phase.live.spots.map((s) => (
                <div key={s.label} data-testid="safe-spot" className="flex items-center gap-3 rounded-[12px] bg-surface px-4 py-4">
                  <MapPin className="h-5 w-5 shrink-0 text-gold" />
                  <span className="flex-1 text-base">{s.label}</span>
                  <span className="font-display text-lg font-semibold">{s.minutes} min</span>
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-3" aria-label="Responders">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold">Responders</h2>
              <span className="text-sm text-dim">
                {Math.max(0, Math.ceil((new Date(phase.live.expiresAt).getTime() - now) / 60000))} min left
              </span>
            </div>
            {phase.live.notified !== null && (
              <p className="text-sm text-dim">
                {phase.live.notified > 0
                  ? `Asked ${phase.live.notified} nearby ${phase.live.notified === 1 ? "person" : "people"} near ${phase.live.area}.`
                  : `No one is nearby right now near ${phase.live.area}. Head to a safe spot or call DPS.`}
              </p>
            )}
            {responders.length === 0 ? (
              <p className="rounded-[12px] bg-surface px-4 py-5 text-dim" data-testid="no-responders">
                Waiting for someone to say they can come…
              </p>
            ) : (
              responders.map((r) => (
                <div key={r.user_id} data-testid="responder-card" className="flex items-center gap-3 rounded-[12px] bg-surface p-4">
                  <Avatar className="h-12 w-12 rounded-[10px]">
                    <AvatarFallback className="rounded-[10px] bg-background text-dim">
                      <User className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-display text-lg font-semibold">
                      {r.class_year ? `Class of ${r.class_year}` : "Trojan"}
                      {r.is_walker && <BadgeCheck className="h-4 w-4 text-gold" aria-label="Trojan Walker" />}
                    </p>
                    <p className="text-sm text-dim">
                      {r.distance_m != null ? `about ${r.distance_m} m away` : "nearby"}
                      {r.rating_count ? (
                        <span className="ml-2 inline-flex items-center gap-0.5">
                          <Star className="h-3 w-3 text-gold" /> {Number(r.rating_avg).toFixed(1)}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    disabled={busy || r.response !== "applied"}
                    onClick={() => approve(r.user_id)}
                    className="h-12 rounded-[12px] bg-cardinal px-5 font-display text-base font-semibold text-ink hover:bg-cardinal/90"
                  >
                    Approve
                  </Button>
                </div>
              ))
            )}
            <p className="text-xs text-dim">Only the person you approve learns where you are.</p>
          </section>

          {error && <p className="text-sm text-gold">{error}</p>}
          <Button onClick={imSafe} variant="ghost" className="h-12 rounded-[12px] bg-surface font-display text-base font-semibold text-ink">
            I&apos;m safe, cancel broadcast
          </Button>
          {emergency}
        </>
      )}

      <Sheet open={confirm} onOpenChange={setConfirm}>
        <SheetContent
          side="bottom"
          className="inset-x-4 bottom-4 mx-auto max-w-[398px] rounded-[16px] border border-border bg-surface p-5 text-ink"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-2xl font-bold text-ink">Send this broadcast?</SheetTitle>
            <SheetDescription className="text-dim">
              We will tell nearby Trojans someone near {area?.label ?? "your area"} needs a person. Not your exact spot
              or name. DPS gets a silent log entry.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-5 grid gap-3">
            <button
              disabled={busy}
              onClick={send}
              className="h-14 rounded-[16px] bg-escalation font-display text-xl font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send broadcast"}
            </button>
            <button onClick={() => setConfirm(false)} className="h-12 rounded-[12px] bg-background font-display text-base font-semibold">
              Cancel
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
