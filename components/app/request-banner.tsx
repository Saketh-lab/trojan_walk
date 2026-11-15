"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Pending = {
  request_id: string;
  requester_first_name: string | null;
  origin_label: string | null;
  dest_label: string | null;
  leave_at: string;
};

// In-app banner for incoming walk requests. Guaranteed path; Web Push is best effort on top.
export function RequestBanner({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dismissed = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("target_requests")
      .select("request_id,requester_first_name,origin_label,dest_label,leave_at,status,response,kind")
      .eq("status", "open")
      .eq("kind", "walk")
      .is("response", null)
      .order("leave_at", { ascending: false })
      .limit(5);
    const next = (data ?? []).find((r) => !dismissed.current.has(r.request_id)) as Pending | undefined;
    setPending(next ?? null);
  }, [supabase]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`targets-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "request_targets", filter: `user_id=eq.${userId}` },
        refresh
      )
      .subscribe();
    const poll = setInterval(refresh, 4000); // safety net if realtime drops
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [supabase, userId, refresh]);

  async function respond(response: "accepted" | "declined") {
    if (!pending) return;
    setBusy(true);
    const id = pending.request_id;
    dismissed.current.add(id);
    const { data, error } = await supabase.functions.invoke("respond", { body: { request_id: id, response } });
    setBusy(false);
    setPending(null);
    if (error) return setNote("Couldn't send your answer. Try again.");
    if (response === "accepted") {
      if (data?.session_id) router.push(`/session/${data.session_id}`);
      else setNote("Someone else already joined. Thanks for answering.");
    }
  }

  if (!pending && !note) return null;
  const mins = pending ? Math.max(0, Math.round((new Date(pending.leave_at).getTime() - Date.now()) / 60000)) : 0;

  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-50 mx-auto w-full max-w-[430px] px-4 pt-4">
      <div className="rounded-[16px] border border-cardinal bg-surface p-4 shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
        {pending ? (
          <>
            <p className="font-display text-xl font-semibold">Walk together?</p>
            <p className="mt-1 text-base">
              {pending.requester_first_name ?? "Someone"} wants company, {pending.origin_label} to{" "}
              {pending.dest_label}, leaving in {mins} min.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                disabled={busy}
                onClick={() => respond("accepted")}
                className="h-12 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink disabled:opacity-50"
              >
                Yes
              </button>
              <button
                disabled={busy}
                onClick={() => respond("declined")}
                className="h-12 rounded-[12px] bg-background font-display text-lg font-semibold text-ink disabled:opacity-50"
              >
                No
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p>{note}</p>
            <button onClick={() => setNote(null)} className="font-display text-lg font-semibold">
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
