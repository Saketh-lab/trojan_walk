"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Phone, ShieldCheck, Star } from "lucide-react";
import { useLocation } from "@/lib/use-location";
import { HeadingTracker } from "@/lib/geo";
import { AppHeader } from "@/components/app/app-header";
import { LyftButton } from "@/components/app/lyft-button";
import { DemoPanel } from "@/components/app/demo-panel";
import type { Dot } from "@/components/app/map-view";

const MapView = dynamic(() => import("@/components/app/map-view"), {
  ssr: false,
  loading: () => <div className="h-[340px] rounded-[12px] border border-border bg-surface" />,
});

type Status = {
  state: "active" | "checkin_due" | "checkin_missed" | "escalated" | "arrived" | "ended";
  server_now: string;
  meeting_point: string | null;
  dest_label: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  next_checkin_at: string | null;
  grace_s: number;
  my_due_at: string | null;
  i_missed: boolean;
  peer_missed: boolean;
  i_am_requester: boolean;
  peer_first_name: string | null;
  watcher_mode: boolean;
  watcher_last4: string | null;
  notices: { kind: "missed" | "escalated"; recipients: number; stub: boolean }[];
  fixes: { user_id: string; lat: number; lng: number; at: string }[];
};

const LIVE = ["active", "checkin_due", "checkin_missed", "escalated"];
const FIX_MS = 5000;
const DPS_TEL = "tel:+12137404321";

const STATE_LABEL: Record<Status["state"], string> = {
  active: "Walking",
  checkin_due: "Check-in due",
  checkin_missed: "Missed check-in",
  escalated: "Escalated",
  arrived: "Arrived",
  ended: "Ended",
};

export function SessionScreen({ sessionId, userId, demoMode }: { sessionId: string; userId: string; demoMode: boolean }) {
  const router = useRouter();
  const { supabase, places, position, demo } = useLocation();
  const [status, setStatus] = useState<Status | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [peerDot, setPeerDot] = useState<Dot | null>(null);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rated, setRated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const peerTracker = useRef(new HeadingTracker());
  const lastPeer = useRef<string>("");
  const posRef = useRef(position);
  posRef.current = position;
  const stateRef = useRef<Status["state"] | null>(null);

  // Everything comes from one members-only RPC. The other person's dot is read from session_fixes
  // inside it; nothing here ever touches presence.
  const refresh = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("session_status", { sess: sessionId });
    if (e || !data) return setError(e?.message ?? "Could not load this walk.");
    const s = data as Status;
    setError(null);
    setSkew(new Date(s.server_now).getTime() - Date.now());
    stateRef.current = s.state;
    setStatus(s);
    const peer = s.fixes.find((f) => f.user_id !== userId);
    if (peer) {
      const key = `${peer.lat},${peer.lng}`;
      if (key !== lastPeer.current) {
        lastPeer.current = key;
        peerTracker.current.update({ lat: peer.lat, lng: peer.lng });
      }
      setPeerDot({ lat: peer.lat, lng: peer.lng, heading_deg: peerTracker.current.current(), is_walker: false });
    } else {
      setPeerDot(null);
    }
  }, [supabase, sessionId, userId]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "session_fixes", filter: `session_id=eq.${sessionId}` }, refresh)
      .subscribe();
    const poll = setInterval(refresh, 2000); // safety net if realtime drops
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      supabase.removeChannel(channel);
    };
  }, [supabase, sessionId, refresh]);

  // Location goes to the server only through record_fix, only while the walk is live.
  const sendFix = useCallback(async () => {
    const p = posRef.current;
    if (!p || !stateRef.current || !LIVE.includes(stateRef.current)) return;
    const { data, error: e } = await supabase.rpc("record_fix", { sess: sessionId, lat: p.lat, lng: p.lng });
    if (e) return setError(e.message);
    if (data === "arrived") refresh();
  }, [supabase, sessionId, refresh]);

  const live = status ? LIVE.includes(status.state) : false;
  useEffect(() => {
    if (!live) return;
    sendFix();
    const id = setInterval(sendFix, FIX_MS);
    return () => clearInterval(id);
  }, [live, sendFix]);

  const hasPos = !!position;
  useEffect(() => {
    if (live && hasPos) sendFix(); // first fix as soon as a position exists
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPos]);

  async function imGood() {
    setBusy(true);
    const { error: e } = await supabase.functions.invoke("checkin", { body: { session_id: sessionId } });
    setBusy(false);
    if (e) setError("Couldn't send your check-in. Try again.");
    refresh();
  }

  async function endWalk() {
    setBusy(true);
    await supabase.functions.invoke("end-session", { body: { session_id: sessionId, reason: "user" } });
    setBusy(false);
    refresh();
  }

  async function rate(stars: number) {
    setRated(stars);
    const { data: peer } = await supabase.from("session_peers").select("user_id").eq("session_id", sessionId).maybeSingle();
    if (peer) {
      await supabase.from("ratings").insert({ session_id: sessionId, rater: userId, ratee: peer.user_id, stars });
    }
  }

  const pins = useMemo(
    () =>
      status?.dest_lat != null && status.dest_lng != null
        ? [{ slug: "dest", label: status.dest_label ?? "Destination", lat: status.dest_lat, lng: status.dest_lng }]
        : [],
    [status?.dest_lat, status?.dest_lng, status?.dest_label]
  );

  if (!status) {
    return <p className="text-dim">{error ?? "Loading your walk…"}</p>;
  }

  const peerName = status.peer_first_name ?? "your companion";
  const lyftDest = status.dest_lat != null && status.dest_lng != null ? { lat: status.dest_lat, lng: status.dest_lng } : null;
  const promptOpen = !!status.my_due_at && (status.state === "checkin_due" || status.state === "checkin_missed");
  const secsLeft = status.my_due_at
    ? Math.max(0, Math.ceil((new Date(status.my_due_at).getTime() + status.grace_s * 1000 - (now + skew)) / 1000))
    : 0;
  const escalatedForMe = status.state === "escalated" && status.i_missed;
  const checkOnThem = (status.state === "checkin_missed" || status.state === "escalated") && status.peer_missed && !status.i_missed;
  const notice = status.notices.at(-1);

  return (
    <div className="flex flex-col gap-5">
      <AppHeader onWordmarkTripleTap={demoMode ? () => setPanel(true) : undefined} />

      <section>
        <h1 className="font-display text-3xl font-bold leading-tight">
          {status.watcher_mode ? "Watched walk" : `Walking with ${peerName}`}
        </h1>
        <p className="mt-1 flex items-center gap-2 text-dim">
          <MapPin className="h-4 w-4 shrink-0 text-gold" />
          <span>
            {status.meeting_point ?? "Start"} to {status.dest_label ?? "destination"}
          </span>
        </p>
        {status.watcher_mode && (
          <p className="mt-2 text-sm text-dim" data-testid="watcher-note">
            Your contact{status.watcher_last4 ? ` ending ${status.watcher_last4}` : ""} has a link to your last
            location and gets a text if you miss a check-in.
          </p>
        )}
      </section>

      {checkOnThem && (
        <section role="status" className="rounded-[12px] border border-cardinal bg-surface p-4">
          <h2 className="font-display text-xl font-semibold">Check on {peerName}</h2>
          <p className="mt-1 text-dim">
            {peerName} hasn&apos;t answered a safety check-in. Call or find them. Their contacts have been told.
          </p>
        </section>
      )}

      {escalatedForMe && (
        <section role="alert" className="flex flex-col gap-3 rounded-[16px] bg-escalation p-4 text-white">
          <h2 className="font-display text-2xl font-semibold">We couldn&apos;t reach you</h2>
          <p>Your contacts have your last location. If you need help, call DPS now.</p>
          <a
            href={DPS_TEL}
            className="flex h-14 items-center justify-center gap-2 rounded-[12px] bg-white font-display text-lg font-semibold text-[#121110]"
          >
            <Phone className="h-5 w-5" /> Call DPS
          </a>
        </section>
      )}

      <div className="flex items-center justify-between gap-3 rounded-[12px] bg-surface px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-dim">
          <ShieldCheck className="h-4 w-4 text-gold" /> Status
        </span>
        <span data-testid="session-state" data-state={status.state} className="rounded-[12px] border border-cardinal px-3 py-1.5 text-sm text-ink">
          {STATE_LABEL[status.state]}
        </span>
      </div>

      <MapView position={position} dots={peerDot ? [peerDot] : []} pins={pins} />

      {notice && (status.i_missed || status.state === "escalated") && !checkOnThem && (
        <p className="text-sm text-dim" data-testid="sms-notice">
          SMS {notice.stub ? "sent (stub)" : "sent"} to {notice.recipients} contact{notice.recipients === 1 ? "" : "s"}.
        </p>
      )}

      {status.state === "arrived" && (
        <section className="flex flex-col gap-4 rounded-[12px] bg-surface p-5">
          <h2 className="font-display text-2xl font-semibold">You made it</h2>
          <p className="text-dim">Location sharing has stopped.{status.watcher_mode ? "" : ` How was your walk with ${peerName}?`}</p>
          {status.watcher_mode ? null : rated === null ? (
            <div className="flex gap-2" role="group" aria-label="Rate your walk">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  onClick={() => rate(n)}
                  className="flex h-12 flex-1 items-center justify-center rounded-[12px] bg-background text-gold"
                >
                  <Star className="h-6 w-6" />
                </button>
              ))}
            </div>
          ) : (
            <p data-testid="rated" className="text-gold">Thanks, rated {rated} of 5.</p>
          )}
          <Link href="/map" className="flex h-12 items-center justify-center rounded-[12px] bg-cardinal font-display text-lg font-semibold">
            Done
          </Link>
        </section>
      )}

      {status.state === "ended" && (
        <section className="flex flex-col gap-3 rounded-[12px] bg-surface p-5">
          <h2 className="font-display text-2xl font-semibold">Walk ended</h2>
          <p className="text-dim">Location sharing has stopped.</p>
          <Link href="/map" className="flex h-12 items-center justify-center rounded-[12px] bg-cardinal font-display text-lg font-semibold">
            Back home
          </Link>
        </section>
      )}

      {live && <LyftButton dest={lyftDest} pickup={position} />}

      {live && (
        <button
          onClick={endWalk}
          disabled={busy}
          className="h-12 rounded-[12px] bg-surface font-display text-base font-semibold text-ink disabled:opacity-50"
        >
          End walk
        </button>
      )}

      {error && <p className="text-sm text-gold">{error}</p>}

      {promptOpen && (
        <div role="alertdialog" aria-label="Safety check-in" className="fixed inset-0 z-50 flex items-end bg-black/70 px-4 pb-4">
          <div className="mx-auto w-full max-w-[398px] rounded-[16px] border border-cardinal bg-surface p-5">
            <h2 className="font-display text-3xl font-bold">You good?</h2>
            <p className="mt-1 text-dim">
              {status.i_missed
                ? "We haven't heard from you. Tap now so your contacts aren't alerted."
                : "Tap to let us know you're okay."}
            </p>
            <p className="mt-3 font-display text-5xl font-bold" data-testid="countdown">
              0:{String(secsLeft).padStart(2, "0")}
            </p>
            <button
              onClick={imGood}
              disabled={busy}
              className="mt-4 h-14 w-full rounded-[12px] bg-cardinal font-display text-xl font-semibold disabled:opacity-50"
            >
              I&apos;m good
            </button>
          </div>
        </div>
      )}

      {demoMode && <DemoPanel open={panel} onOpenChange={setPanel} demo={demo} places={places} />}
    </div>
  );
}
