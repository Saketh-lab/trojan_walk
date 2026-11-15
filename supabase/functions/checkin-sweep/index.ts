import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendSms } from "./push.ts";

// The timer transitions happen in SQL (sweep_checkins, pg_cron every 30 s). That function queues
// rows in `notifications` and pokes this one, which claims them atomically and sends the SMS.
// It takes no input, so a repeated or forged call can only (re)process the queue.
Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:3000";
  const DPS = Deno.env.get("DPS_PHONE_DISPLAY") ?? "213-740-4321";

  // One UPDATE claims the rows; a concurrent run gets none of them.
  const { data: claimed, error } = await admin
    .from("notifications")
    .update({ sent_at: new Date().toISOString() })
    .is("sent_at", null)
    .select("id,session_id,user_id,kind,to_phone,token");
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const n of claimed ?? []) {
    const { data: who } = await admin.from("profiles").select("first_name").eq("id", n.user_id).single();
    const { data: sess } = await admin.from("sessions").select("request_id").eq("id", n.session_id).single();
    const { data: reqRow } = sess?.request_id
      ? await admin.from("requests").select("dest_label").eq("id", sess.request_id).single()
      : { data: null };

    const name = who?.first_name ?? "Your friend";
    const dest = reqRow?.dest_label ?? "their destination";
    const link = `${appUrl}/s/${n.token}`;
    const body = n.kind === "watching"
      ? `TrojanWalk: ${name} is walking to ${dest} and asked you to watch their walk. Live location: ${link} . You'll get a text if they miss a safety check-in.`
      : n.kind === "escalated"
      ? `TrojanWalk: ${name} still hasn't answered a safety check-in walking to ${dest}. Last location: ${link} . Call them now, or DPS ${DPS}.`
      : `TrojanWalk: ${name} missed a safety check-in walking to ${dest}. Last location: ${link} . Call them, or DPS ${DPS}.`;

    const { delivery } = await sendSms(n.to_phone, body);
    await admin.from("notifications").update({ delivery, body }).eq("id", n.id);
    sent++;
  }
  return new Response(JSON.stringify({ processed: sent }), { headers: { "Content-Type": "application/json" } });
});
