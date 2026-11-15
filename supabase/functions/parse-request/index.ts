import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";

const SYSTEM = `You turn a USC student's short message into a walk request. You are given the student's current location label and a list of campus places with aliases.

Return only JSON matching the schema. Rules:
- origin defaults to the current location unless the message names a different start.
- Resolve nicknames using the aliases list; "the lo" is The Lorenzo, "the village" is USC Village.
- leave_in_s: "now" = 0, "in 2" or "in 2 min" = 120, "in a bit" = 300. Unknown = 120.
- group_size: how many people are walking with the requester already. Default 1.
- If the destination is not in the list or is ambiguous, set dest_slug to null and confidence below 0.5.
- Never invent a place.`;

const SCHEMA = {
  type: "object",
  required: ["origin_slug", "dest_slug", "leave_in_s", "group_size", "confidence"],
  properties: {
    origin_slug: { type: ["string", "null"] },
    dest_slug: { type: ["string", "null"] },
    leave_in_s: { type: "integer", minimum: 0, maximum: 1800 },
    group_size: { type: "integer", minimum: 1, maximum: 6 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

type Place = { slug: string; label: string; aliases: string[]; kind: string; lat: number; lng: number };

function dist(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Offline fallback if the model call fails: alias match, always low confidence so the form shows.
function heuristic(text: string, places: Place[]) {
  const t = text.toLowerCase();
  const hits = places
    .filter((p) => p.kind !== "safe_spot")
    .flatMap((p) => [p.label.toLowerCase(), ...p.aliases.map((a) => a.toLowerCase())].map((a) => ({ p, a, i: t.search(new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)) })))
    .filter((h) => h.i >= 0)
    .sort((x, y) => y.i - x.i);
  const dest = hits[0]?.p.slug ?? null;
  const mins = t.match(/in (\d+)/)?.[1];
  return { origin_slug: null, dest_slug: dest, leave_in_s: mins ? Math.min(1800, Number(mins) * 60) : 120, group_size: 1, confidence: dest ? 0.5 : 0.2 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authed = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim().slice(0, 200);
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!text || !Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "text, lat, lng required" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: placesData } = await admin.from("places_geo").select("slug,label,aliases,kind,lat,lng");
  const places = (placesData ?? []) as Place[];
  const landmarks = places.filter((p) => p.kind !== "safe_spot");
  const here = [...landmarks].sort((a, b) => dist({ lat, lng }, a) - dist({ lat, lng }, b))[0];

  let parsed: ReturnType<typeof heuristic> | null = null;
  let source = "model";
  let modelError: string | null = null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM,
        tools: [{ name: "walk_request", description: "The parsed walk request.", input_schema: SCHEMA }],
        tool_choice: { type: "tool", name: "walk_request" },
        messages: [{
          role: "user",
          content: `Current location: ${here?.label ?? "unknown"}\nPlaces:\n${landmarks
            .map((p) => `- ${p.slug}: ${p.label} (aliases: ${p.aliases.join(", ")})`).join("\n")}\n\nMessage: ${text}`,
        }],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 160); // Anthropic error bodies carry a type + message, no secrets
      throw new Error(`anthropic ${res.status} ${detail}`);
    }
    const out = await res.json();
    parsed = out.content?.find((c: { type: string }) => c.type === "tool_use")?.input ?? null;
    if (!parsed) throw new Error("no tool_use block");
  } catch (e) {
    console.error("parse-request model failure:", (e as Error).message);
    parsed = heuristic(text, landmarks);
    source = "fallback";
    modelError = (e as Error).message;
  }

  const bySlug = (s: string | null) => landmarks.find((p) => p.slug === s) ?? null;
  const origin = bySlug(parsed!.origin_slug) ?? here ?? null;
  const dest = bySlug(parsed!.dest_slug);
  let confidence = Number(parsed!.confidence) || 0;
  if (!dest) confidence = Math.min(confidence, 0.4);          // never trust a missing/unknown destination
  if (dest && origin && dest.slug === origin.slug) confidence = Math.min(confidence, 0.4);

  return json({
    origin_slug: origin?.slug ?? null,
    origin_label: origin?.label ?? null,
    dest_slug: dest?.slug ?? null,
    dest_label: dest?.label ?? null,
    dest_lat: dest?.lat ?? null,
    dest_lng: dest?.lng ?? null,
    leave_in_s: Math.max(0, Math.min(1800, Math.round(Number(parsed!.leave_in_s) || 120))),
    group_size: parsed!.group_size ?? 1,
    confidence,
    source,
    ...(modelError ? { model_error: modelError } : {}),
  });
});
