import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const WALK_M_PER_S = 1.3;
const MAX_PER_NIGHT = 2;

type Place = { slug: string; label: string; kind: string; staffed_hours: string | null; lat: number; lng: number };

function dist(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// "[0,24)" contains hour h, or h + 24 for ranges that run past midnight.
function staffedNow(range: string | null, hour: number) {
  const m = range?.match(/^[\[(](\d+),(\d+)[\])]$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return (hour >= a && hour < b) || (hour + 24 >= a && hour + 24 < b);
}

// Rung 4. Tells nearby Trojans that SOMEONE near an area needs a person: area label only, never a
// name or coordinates. The requester's exact spot stays on the server until `approve`.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "lat and lng required" }, 400);
  const note = body.note ? String(body.note).trim().slice(0, 40) : null;

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: placesData } = await admin.from("places_geo").select("slug,label,kind,staffed_hours,lat,lng");
  const places = (placesData ?? []) as Place[];
  const here = { lat, lng };
  const landmarks = places.filter((p) => p.kind !== "safe_spot");
  const area =
    landmarks.find((p) => p.slug === body.area_slug) ??
    [...landmarks].sort((a, b) => dist(here, a) - dist(here, b))[0];
  if (!area) return json({ error: "no places configured" }, 500);

  // Top 3 staffed safe spots by walking distance, shown to the requester.
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }).format(new Date())) % 24;
  const spots = places
    .filter((p) => p.kind === "safe_spot" && staffedNow(p.staffed_hours, hour))
    .map((p) => ({ label: p.label, lat: p.lat, lng: p.lng, metres: Math.round(dist(here, p)) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, 3)
    .map((p) => ({ ...p, minutes: Math.max(1, Math.ceil(p.metres / WALK_M_PER_S / 60)) }));

  // Already have one open? Resume it instead of starting another (and without re-notifying anyone).
  const { data: open } = await admin.from("requests").select("id,origin_label,expires_at")
    .eq("requester", user.id).eq("kind", "broadcast").eq("status", "open").gt("expires_at", new Date().toISOString()).maybeSingle();
  if (open) {
    return json({ request_id: open.id, area_label: open.origin_label, expires_at: open.expires_at, safe_spots: spots, resumed: true, notified: null });
  }

  // At most 2 a night (12 h window); a third sends the student to the Emergency screen.
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { count } = await admin.from("requests").select("*", { count: "exact", head: true })
    .eq("requester", user.id).eq("kind", "broadcast").gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_NIGHT) {
    return json({ error: "limit", message: "You've used both broadcasts for tonight. Use Emergency." }, 429);
  }

  const safe = spots[0];
  const { data: row, error: insErr } = await admin.from("requests").insert({
    requester: user.id,
    kind: "broadcast",
    origin: `SRID=4326;POINT(${lng} ${lat})`,
    origin_label: area.label,
    // The requester's own destination is the nearest staffed safe spot; hidden from responders.
    dest: safe ? `SRID=4326;POINT(${safe.lng} ${safe.lat})` : null,
    dest_label: safe?.label ?? null,
    leave_at: new Date().toISOString(),
    raw_text: note,
    expires_at: new Date(Date.now() + 600_000).toISOString(), // trigger sets the real value
  }).select("id,expires_at").single();
  if (insErr || !row) return json({ error: insErr?.message ?? "could not create broadcast" }, 500);

  const { data: targets, error: tErr } = await admin.rpc("broadcast_targets", { req: row.id });
  if (tErr) return json({ error: tErr.message }, 500);
  const ids = ((targets ?? []) as { user_id: string }[]).map((t) => t.user_id);
  if (ids.length) {
    await admin.from("request_targets").upsert(
      ids.map((id) => ({ request_id: row.id, user_id: id, rung: 4 })),
      { onConflict: "request_id,user_id", ignoreDuplicates: true },
    );
  }

  // Silent log for DPS: area and time only.
  await admin.from("dps_log").insert({ request_id: row.id, area_label: area.label });
  if (ids.length) await admin.functions.invoke("push-pending").catch((e: Error) => console.error("push poke failed:", e.message));

  return json({ request_id: row.id, area_label: area.label, expires_at: row.expires_at, safe_spots: spots, notified: ids.length });
});
