"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import { HeadingTracker, haversine, type LatLng } from "@/lib/geo";
import { useLocation } from "@/lib/use-location";
import { subscribeToPush } from "@/lib/push-client";
import { AppHeader } from "@/components/app/app-header";
import { EscalationLadder } from "@/components/app/escalation-ladder";
import { WalkingToggle } from "@/components/app/walking-toggle";
import { DemoPanel } from "@/components/app/demo-panel";
import type { Dot } from "@/components/app/map-view";

const MapView = dynamic(() => import("@/components/app/map-view"), {
  ssr: false,
  loading: () => <div className="h-[340px] rounded-[12px] border border-border bg-surface" />,
});

const TICK_MS = 5000;
const CAMPUS_RADIUS_M = 1500;
const LEAVEY: LatLng = { lat: 34.02175, lng: -118.28285 };

export function MapScreen({ name, userId, demoMode }: { name: string; userId: string; demoMode: boolean }) {
  const { supabase, places, position, geoError, demo } = useLocation();
  const [on, setOn] = useState(false);
  const [dots, setDots] = useState<Dot[]>([]);
  const [panel, setPanel] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const posRef = useRef<LatLng | null>(null);
  const tracker = useRef(new HeadingTracker());
  const lastWrite = useRef<LatLng | null>(null);

  useEffect(() => {
    posRef.current = position;
    if (position) tracker.current.update(position);
  }, [position]);

  // Reset heading history when the position source changes.
  useEffect(() => {
    tracker.current.reset();
  }, [demo.enabled]);

  // Presence write + dots poll. Runs only while the toggle is on.
  const tick = useCallback(async () => {
    const p = posRef.current;
    if (!p) return;
    const { error } = await supabase.from("presence").upsert({
      user_id: userId,
      geom: `SRID=4326;POINT(${p.lng} ${p.lat})`,
      heading_deg: tracker.current.current(),
      toggled_on: true,
    });
    if (error) return setSyncError(error.message);
    lastWrite.current = p;
    const { data, error: e2 } = await supabase.rpc("nearby_dots", { p_radius_m: 150 });
    if (e2) return setSyncError(e2.message);
    setSyncError(null);
    setDots((data ?? []) as Dot[]);
  }, [supabase, userId]);

  useEffect(() => {
    if (!on) return;
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [on, tick]);

  // First fix arriving after the toggle was flipped on.
  const hadPos = useRef(false);
  useEffect(() => {
    if (on && position && !hadPos.current) tick();
    hadPos.current = !!position;
  }, [on, position, tick]);

  // Movement of 10 m triggers an extra write between ticks.
  useEffect(() => {
    if (on && position && lastWrite.current && haversine(lastWrite.current, position) >= 10) tick();
  }, [on, position, tick]);

  const stopSharing = useCallback(async () => {
    setDots([]);
    await supabase.from("presence").delete().eq("user_id", userId);
    lastWrite.current = null;
  }, [supabase, userId]);

  useEffect(() => {
    if (!on) stopSharing();
  }, [on, stopSharing]);

  // Leaving the screen ends sharing.
  useEffect(() => {
    return () => {
      supabase.from("presence").delete().eq("user_id", userId).then(() => {});
    };
  }, [supabase, userId]);

  const landmarks = useMemo(() => places.filter((p) => p.kind !== "safe_spot"), [places]);
  const nearest = useMemo(() => {
    if (!position) return [];
    return [...landmarks].sort((a, b) => haversine(position, a) - haversine(position, b));
  }, [landmarks, position]);
  const near = nearest[0];
  const onCampus = position ? haversine(position, LEAVEY) < CAMPUS_RADIUS_M : null;

  let hint: string | undefined;
  if (on && !position) hint = "Waiting for your location…";
  else if (!on && !position && geoError) hint = geoError;
  else if (syncError) hint = `Sync problem: ${syncError}`;

  return (
    <div className="flex flex-col gap-6">
      <AppHeader onWordmarkTripleTap={demoMode ? () => setPanel(true) : undefined} />

      <section>
        <p className="text-base text-dim">Good evening, {name}</p>
        <h2 className="mt-1 font-display text-4xl font-bold leading-tight">You&apos;re right here.</h2>
      </section>

      <MapView position={position} dots={dots} pins={nearest.filter((p) => !position || haversine(position, p) > 40).slice(0, 3)} />

      <WalkingToggle
        on={on}
        onChange={(v) => {
          setOn(v);
          if (v) subscribeToPush(supabase, userId);
        }}
        hint={hint}
      />

      <div className="flex items-center justify-between gap-3 rounded-[12px] bg-surface px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <MapPin className="h-5 w-5 shrink-0 text-gold" />
          <p className="text-base leading-snug">
            {near ? (
              <>You are near <span className="font-semibold">{near.label}</span></>
            ) : (
              <span className="text-dim">Finding where you are…</span>
            )}
          </p>
        </div>
        {onCampus !== null && (
          <span className="shrink-0 rounded-[12px] border border-cardinal px-3 py-1.5 text-sm text-ink">
            {onCampus ? "On campus" : "Off campus"}
          </span>
        )}
      </div>

      <section className="flex flex-col gap-4">
        <h3 className="font-display text-2xl font-semibold">Choose your next step</h3>
        <EscalationLadder />
      </section>

      <p className="text-center text-sm text-dim">Location is approximate.</p>

      {demoMode && <DemoPanel open={panel} onOpenChange={setPanel} demo={demo} places={places} />}
    </div>
  );
}
