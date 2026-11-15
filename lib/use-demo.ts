"use client";

import { useEffect, useState } from "react";
import { bearing, destination, haversine, type LatLng } from "@/lib/geo";

export type DemoPlace = { slug: string; label: string; lat: number; lng: number };
type Saved = { enabled: boolean; origin: string | null; dest: string | null; pos: LatLng | null };

const KEY = "tw-demo"; // sessionStorage: per tab, so two tabs can be two different spots
const STEP_M = 30;
const STEP_MS = 2000;
const EMPTY: Saved = { enabled: false, origin: null, dest: null, pos: null };

function load(): Saved {
  try {
    return { ...EMPTY, ...(JSON.parse(sessionStorage.getItem(KEY) ?? "") as Partial<Saved>) };
  } catch {
    return EMPTY;
  }
}

/** DEMO_MODE fake GPS: pin to a place, then walk 30 m every 2 s toward a destination. */
export function useDemo(places: DemoPlace[]) {
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [walking, setWalking] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSaved(load());
    setReady(true);
  }, []);

  // Persist (position included, so /map and /request agree within a tab). Only after hydration,
  // otherwise the first render's empty state would overwrite what was saved.
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(saved));
    } catch {}
  }, [saved, ready]);

  const bySlug = (slug: string | null) => places.find((p) => p.slug === slug) ?? null;
  const origin = bySlug(saved.origin);
  const dest = bySlug(saved.dest);
  const pos: LatLng | null = !saved.enabled
    ? null
    : saved.pos ?? (origin ? { lat: origin.lat, lng: origin.lng } : null);

  // Walk: advance 30 m along the straight route every 2 s, stop at the destination.
  useEffect(() => {
    if (!walking || !dest) return;
    const target = { lat: dest.lat, lng: dest.lng };
    const id = setInterval(() => {
      setSaved((s) => {
        const cur = s.pos ?? (origin ? { lat: origin.lat, lng: origin.lng } : null);
        if (!cur) return s;
        if (haversine(cur, target) <= STEP_M) {
          setWalking(false);
          return { ...s, pos: target };
        }
        return { ...s, pos: destination(cur, bearing(cur, target), STEP_M) };
      });
    }, STEP_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking, saved.dest, places.length]);

  return {
    enabled: saved.enabled,
    origin,
    dest,
    pos,
    walking,
    setEnabled: (enabled: boolean) => {
      setWalking(false);
      setSaved((s) => ({ ...s, enabled, pos: null }));
    },
    setOrigin: (slug: string) => {
      setWalking(false);
      setSaved((s) => ({ ...s, origin: slug, pos: null }));
    },
    setDest: (slug: string) => setSaved((s) => ({ ...s, dest: slug })),
    toggleWalk: () => setWalking((w) => !w),
  };
}
