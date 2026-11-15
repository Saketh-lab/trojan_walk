import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Sends Web Push for request_targets that have not been pushed yet. Called by `fanout` (rung 2) and by
// advance_requests() in SQL (rung 3). Takes no input and claims rows with one UPDATE, so repeated or
// forged calls only (re)process the queue. Payload has labels, never coordinates. The in-app banner is
// the guaranteed path; this is best effort and does nothing until VAPID secrets are set.
Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const pub = Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");

  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: claimed, error } = await admin
    .from("request_targets")
    .update({ pushed_at: new Date().toISOString() })
    .is("pushed_at", null)
    .gt("notified_at", since)
    .select("request_id,user_id,rung");
  if (error) return new Response(error.message, { status: 500 });
  if (!claimed?.length) return Response.json({ claimed: 0, sent: 0 });
  if (!pub || !priv) {
    console.log(`[push skipped] ${claimed.length} target(s); VAPID secrets not set`);
    return Response.json({ claimed: claimed.length, sent: 0, skipped: "no VAPID keys" });
  }
  webpush.setVapidDetails("mailto:noreply@trojanwalk.app", pub, priv);

  let sent = 0;
  for (const t of claimed) {
    const { data: r } = await admin.from("requests")
      .select("id,status,kind,leave_at,origin_label,dest_label,requester").eq("id", t.request_id).single();
    if (!r || r.status !== "open") continue;
    let payload: string;
    if (r.kind === "broadcast") {
      // Area only: no name, no coordinates, no destination.
      payload = JSON.stringify({
        type: "broadcast",
        request_id: r.id,
        title: "Someone needs a person",
        body: `Someone near ${r.origin_label} needs a person right now. Can you come?`,
        actions: [{ action: "apply", title: "Can come" }, { action: "decline", title: "Can't" }],
      });
    } else {
      const { data: who } = await admin.from("profiles").select("first_name").eq("id", r.requester).single();
      const mins = Math.max(0, Math.round((new Date(r.leave_at).getTime() - Date.now()) / 60000));
      payload = JSON.stringify({
        type: "walk_request",
        request_id: r.id,
        title: "Walk together?",
        body: `${who?.first_name ?? "Someone"} wants company, ${r.origin_label} to ${r.dest_label}, leaving in ${mins} min.`,
        actions: [{ action: "accept", title: "Yes" }, { action: "decline", title: "No" }],
      });
    }
    const { data: subs } = await admin.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", t.user_id);
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }
  }
  return Response.json({ claimed: claimed.length, sent });
});
