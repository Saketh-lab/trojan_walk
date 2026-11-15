"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { LatLng } from "@/lib/geo";
import { useDemo } from "@/lib/use-demo";

export type Place = { slug: string; label: string; kind: string; lat: number; lng: number };

/** Places + the current position (demo pin if enabled, else local GPS). GPS is never sent anywhere from here. */
export function useLocation() {
  const supabase = useMemo(() => createClient(), []);
  const [places, setPlaces] = useState<Place[]>([]);
  const [gps, setGps] = useState<LatLng | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const demo = useDemo(places);

  useEffect(() => {
    supabase
      .from("places_geo")
      .select("slug,label,kind,lat,lng")
      .order("label")
      .then(({ data }) => data && setPlaces(data as Place[]));
  }, [supabase]);

  useEffect(() => {
    if (demo.enabled) return;
    if (!navigator.geolocation) {
      setGeoError("This browser has no location support.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGeoError(null);
        setGps({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (e) => setGeoError(e.code === 1 ? "Location is blocked for this site." : "Can't get your location."),
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [demo.enabled]);

  const position = demo.enabled ? demo.pos : gps;
  return { supabase, places, position, geoError, demo };
}
