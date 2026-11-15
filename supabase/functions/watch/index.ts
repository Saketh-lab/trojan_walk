import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// "Walk with a watcher": a session with no companion. The contact is texted a signed last-fix link
// (stub SMS unless Twilio is configured) and gets the check-in alerts too.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authed = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const { request_id, contact } = await req.json().catch(() => ({}));
  if (!request_id || !contact) return json({ error: "request_id and contact required" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: sessionId, error } = await admin.rpc("do_start_watcher", {
    req: request_id, actor: user.id, contact: String(contact),
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500;
    return json({ error: error.message }, status);
  }

  // Send the "watching" text now instead of waiting for the 30 s sweep.
  await admin.functions.invoke("checkin-sweep").catch((e: Error) => console.error("flush failed:", e.message));
  return json({ session_id: sessionId });
});
