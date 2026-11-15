import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    // Web Push is sent by push-pending (shared with rung 3); the in-app banner does not depend on it.
    await admin.functions.invoke("push-pending").catch((e: Error) => console.error("push poke failed:", e.message));
  }
  return json({ rung2: rung2.length, rung3_scheduled: true });
});
