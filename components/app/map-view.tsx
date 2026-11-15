"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed } from "lucide-react";
import type { LatLng } from "@/lib/geo";

export type Dot = { lat: number; lng: number; heading_deg: number | null; is_walker: boolean };
export type PinPlace = { slug: string; label: string; lat: number; lng: number };

maplibregl.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
const CAMPUS: LatLng = { lat: 34.0218, lng: -118.2829 };

function dotElement(d: Dot): HTMLElement {
  const el = document.createElement("div");
  el.className = "tw-dot";
  el.style.cssText = "position:relative;width:36px;height:36px;z-index:3;";
  if (d.heading_deg !== null) {
    const arrow = document.createElement("div");
    arrow.setAttribute("data-heading", String(d.heading_deg));
    arrow.style.cssText = `position:absolute;inset:0;transform:rotate(${d.heading_deg}deg);`;
    arrow.innerHTML =
      '<svg viewBox="0 0 36 36" width="36" height="36"><path d="M18 1 L23 11 L13 11 Z" fill="#F2EEE6"/></svg>';
    el.appendChild(arrow);
  }
  const core = document.createElement("div");
  core.style.cssText = `position:absolute;left:11px;top:11px;width:14px;height:14px;border-radius:50%;background:#F2EEE6;border:2px solid ${
    d.is_walker ? "#FFC72C" : "#121110"
  };box-shadow:0 2px 6px rgba(0,0,0,.5);`;
  el.appendChild(core);
  el.setAttribute("aria-label", "Nearby Trojan");
  return el;
}

function ownElement(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-label", "Your location");
  el.style.cssText =
    "z-index:4;width:18px;height:18px;border-radius:50%;background:#FFC72C;border:3px solid #121110;box-shadow:0 0 0 6px rgba(255,199,44,.25),0 2px 8px rgba(0,0,0,.5);";
  return el;
}

function pinElement(label: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  el.style.cssText =
    "z-index:1;background:#26231F;color:#F2EEE6;font:13px var(--font-geist-sans),system-ui,sans-serif;padding:6px 10px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.45);white-space:nowrap;";
  return el;
}

export default function MapView({
  position,
  dots,
  pins,
}: {
  position: LatLng | null;
  dots: Dot[];
  pins: PinPlace[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const own = useRef<maplibregl.Marker | null>(null);
  const dotMarkers = useRef<maplibregl.Marker[]>([]);
  const pinMarkers = useRef<maplibregl.Marker[]>([]);
  const follow = useRef(true);
  const centered = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: [CAMPUS.lng, CAMPUS.lat],
      zoom: 16,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    // Start with attribution collapsed to its "i" button (still reachable, still compliant).
    m.on("load", () =>
      box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show")
    );
    m.on("dragstart", () => (follow.current = false));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      own.current = null;
      centered.current = false;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !position) return;
    if (!own.current) {
      own.current = new maplibregl.Marker({ element: ownElement() }).setLngLat([position.lng, position.lat]).addTo(m);
    } else {
      own.current.setLngLat([position.lng, position.lat]);
    }
    if (!centered.current) {
      m.jumpTo({ center: [position.lng, position.lat] });
      centered.current = true;
    } else if (follow.current) {
      m.easeTo({ center: [position.lng, position.lat], duration: 600 });
    }
  }, [position]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    dotMarkers.current.forEach((x) => x.remove());
    dotMarkers.current = dots.map((d) =>
      new maplibregl.Marker({ element: dotElement(d) }).setLngLat([d.lng, d.lat]).addTo(m)
    );
  }, [dots]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    pinMarkers.current.forEach((x) => x.remove());
    pinMarkers.current = pins.map((p) =>
      new maplibregl.Marker({ element: pinElement(p.label), anchor: "bottom", offset: [0, -6] })
        .setLngLat([p.lng, p.lat])
        .addTo(m)
    );
  }, [pins]);

  return (
    <div className="relative h-[340px] overflow-hidden rounded-[12px] border border-border bg-surface">
      {/* Dark-theme treatment for the light OpenFreeMap style; markers sit outside the canvas so are unaffected. */}
      <style>{`.tw-map .maplibregl-canvas{filter:invert(1) hue-rotate(180deg) brightness(.85) saturate(.6)}
        .tw-map .maplibregl-ctrl-attrib{background:rgba(18,17,16,.8);color:#9C9690;border-radius:8px;margin:0 8px 8px 0;font-size:10px}
        .tw-map .maplibregl-ctrl-attrib a{color:#9C9690}
        .tw-map .maplibregl-ctrl-attrib-button{background-color:transparent;filter:invert(1)}`}</style>
      <div className="tw-map absolute inset-0">
        <div ref={box} className="h-full w-full" />
      </div>
      <button
        type="button"
        aria-label="Recenter map"
        onClick={() => {
          follow.current = true;
          if (position) map.current?.easeTo({ center: [position.lng, position.lat], duration: 400 });
        }}
        className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-[10px] bg-surface text-ink shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
      >
        <LocateFixed className="h-5 w-5" />
      </button>
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-[12px] bg-gold px-3 py-2 text-sm font-semibold text-[#121110] shadow-[0_4px_12px_rgba(0,0,0,0.45)]">
        <LocateFixed className="h-4 w-4" />
        Current location
      </div>
    </div>
  );
}
