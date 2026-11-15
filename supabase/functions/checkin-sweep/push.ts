// SMS sender. Real Twilio if TWILIO_* are set, otherwise a logged stub (demo mode).
export type SmsResult = { delivery: "twilio" | "stub" | "failed" };

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  const masked = `***${to.slice(-4)}`;

  if (!sid || !token || !from) {
    console.log(`[SMS stub] to ${masked}: ${body}`);
    return { delivery: "stub" };
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${sid}:${token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (!res.ok) throw new Error(`twilio ${res.status}`);
    console.log(`[SMS sent] to ${masked}`);
    return { delivery: "twilio" };
  } catch (e) {
    console.error(`[SMS failed] to ${masked}: ${(e as Error).message}`);
    return { delivery: "failed" };
  }
}
