import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_HASHES = 1000;
const HEX64 = /^[0-9a-f]{64}$/;

// The client hashes each E.164 number with the app salt and posts only hashes; numbers never leave the phone.
// Matches profiles.phone_hash and inserts friendships both ways. Returns counts, not who matched.
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
  const raw: unknown[] = Array.isArray(body.phone_hashes) ? body.phone_hashes : [];
  const hashes = [...new Set(raw.map((h) => String(h).toLowerCase()).filter((h) => HEX64.test(h)))];
  if (!hashes.length) return json({ error: "phone_hashes required (sha256 hex)" }, 400);
  if (hashes.length > MAX_HASHES) return json({ error: `at most ${MAX_HASHES} per request` }, 413);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: found, error } = await admin.from("profiles").select("id").in("phone_hash", hashes).neq("id", user.id);
  if (error) return json({ error: error.message }, 500);
  let ids = (found ?? []).map((p: { id: string }) => p.id);

  if (ids.length) {
    const { data: blocks } = await admin.from("blocks").select("blocker,blocked")
      .or(`blocker.eq.${user.id},blocked.eq.${user.id}`);
    const blockedIds = new Set((blocks ?? []).flatMap((b: { blocker: string; blocked: string }) => [b.blocker, b.blocked]));
    ids = ids.filter((id: string) => !blockedIds.has(id));
  }

  let added = 0;
  if (ids.length) {
    const { data: existing } = await admin.from("friendships").select("b").eq("a", user.id).in("b", ids);
    const had = new Set((existing ?? []).map((f: { b: string }) => f.b));
    added = ids.filter((id: string) => !had.has(id)).length;
    await admin.from("friendships").upsert(
      ids.flatMap((id: string) => [
        { a: user.id, b: id, source: "contacts" },
        { a: id, b: user.id, source: "contacts" },
      ]),
      { onConflict: "a,b", ignoreDuplicates: true },
    );
  }
  return json({ matched: ids.length, added });
});
