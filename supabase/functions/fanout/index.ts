import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Rung 2 now (friends, then shared context). Rung 3 (matching Walkers) at +120 s and expiry at +180 s
// are done in SQL by advance_requests() on a 30 s pg_cron schedule.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const { request_id } = await req.json().catch(() => ({}));
  if (!request_id) return json({ error: "request_id required" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: r } = await admin.from("requests").select("*").eq("id", request_id).single();
  if (!r || r.requester !== user.id) return json({ error: "not your request" }, 403);
  if (r.kind !== "walk" || r.status !== "open") return json({ error: "request not open" }, 409);

  const { count: already } = await admin.from("request_targets")
    .select("*", { count: "exact", head: true }).eq("request_id", request_id);
  if (already) return json({ rung2: already, rung3_scheduled: true, repeat: true });

  const { data: cands, error } = await admin.rpc("fanout_candidates", { req: request_id });
  if (error) return json({ error: error.message }, 500);
  const rung2 = (cands ?? []).filter((c: { rung: number }) => c.rung === 2) as { user_id: string }[];

  if (rung2.length) {
    await admin.from("request_targets").upsert(
      rung2.map((c) => ({ request_id, user_id: c.user_id, rung: 2 })),
      { onConflict: "request_id,user_id", ignoreDuplicates: true },
    );
    await pushAll(admin, rung2.map((c) => c.user_id), r, user.id);
  }
  return json({ rung2: rung2.length, rung3_scheduled: true });
});

// Best-effort Web Push. The in-app banner (realtime on request_targets) is the guaranteed path.
// Payload carries labels only, never coordinates.
async function pushAll(admin: ReturnType<typeof createClient>, userIds: string[], r: Record<string, string>, requesterId: string) {
  const pub = Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return;
  try {
    webpush.setVapidDetails("mailto:noreply@trojanwalk.app", pub, priv);
    const { data: me } = await admin.from("profiles").select("first_name").eq("id", requesterId).single();
    const mins = Math.max(0, Math.round((new Date(r.leave_at).getTime() - Date.now()) / 60000));
    const payload = JSON.stringify({
      type: "walk_request",
      request_id: r.id,
      title: "Walk together?",
      body: `${me?.first_name ?? "Someone"} wants company, ${r.origin_label} to ${r.dest_label}, leaving in ${mins} min.`,
      actions: [{ action: "accept", title: "Yes" }, { action: "decline", title: "No" }],
    });
    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", userIds);
    await Promise.allSettled((subs ?? []).map(async (s: Record<string, string>) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }));
  } catch (e) {
    console.error("push failed:", (e as Error).message);
  }
}
