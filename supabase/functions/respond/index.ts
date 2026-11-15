import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Walk: first `accepted` wins and creates the session (atomic, in SQL).
// Broadcast `applied` is recorded here; approval is Prompt 7.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const { request_id, response } = await req.json().catch(() => ({}));
  if (!request_id || !["accepted", "declined", "applied"].includes(response)) {
    return json({ error: "request_id and response (accepted|declined|applied) required" }, 400);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: r } = await admin.from("requests").select("kind,status").eq("id", request_id).single();
  const { data: t } = await admin.from("request_targets").select("user_id")
    .eq("request_id", request_id).eq("user_id", user.id).maybeSingle();
  if (!r || !t) return json({ error: "not targeted" }, 403);

  if (response === "accepted") {
    if (r.kind !== "walk") return json({ error: "broadcasts use applied" }, 400);
    const { data: sid, error } = await admin.rpc("accept_request", { req: request_id, actor: user.id });
    if (error) return json({ error: error.message }, 500);
    return json(sid ? { session_id: sid } : { session_id: null, status: "taken" });
  }

  if (response === "applied" && r.kind !== "broadcast") return json({ error: "walks use accepted" }, 400);
  if (r.status !== "open") return json({ session_id: null, status: r.status });
  const { error } = await admin.from("request_targets")
    .update({ response, responded_at: new Date().toISOString() })
    .eq("request_id", request_id).eq("user_id", user.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
