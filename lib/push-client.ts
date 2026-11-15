import type { SupabaseClient } from "@supabase/supabase-js";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export type PushStatus = "subscribed" | "denied" | "unsupported" | "error";

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!VAPID &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Is this browser already subscribed (and allowed)? Does not prompt. */
export async function currentPushStatus(): Promise<PushStatus | "off"> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "subscribed" : "off";
  } catch {
    return "off";
  }
}

/** Web Push opt-in. Call from a user gesture. Never throws; the in-app banner is the fallback. */
export async function subscribeToPush(supabase: SupabaseClient, userId: string): Promise<PushStatus> {
  try {
    if (!pushSupported()) return "unsupported";
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") return "denied";
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID!) }));
    const j = sub.toJSON();
    if (!j.endpoint || !j.keys) return "error";
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert({ user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
    return error ? "error" : "subscribed";
  } catch {
    return "error";
  }
}
