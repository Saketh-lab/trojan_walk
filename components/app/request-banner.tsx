"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Row = {
  request_id: string;
  kind: "walk" | "broadcast";
  requester_first_name: string | null;
  origin_label: string | null;
  dest_label: string | null;
  leave_at: string;
  status: "open" | "matched" | "expired" | "cancelled";
  expires_at: string;
  response: "accepted" | "declined" | "applied" | null;
  reasons: ("friend" | "class" | "hall" | "walker")[] | null;
};

const REASON_LABEL = { friend: "Friend", class: "Same class", hall: "Same hall", walker: "Trojan Walker" } as const;

type Card =
  | { type: "walk"; row: Row }
  | { type: "broadcast"; row: Row }
  | { type: "waiting"; row: Row }
  | { type: "note"; id: string; text: string };

// In-app banner for incoming asks. Guaranteed path; Web Push is best effort on top.
// Broadcasts show the area only: no name, no coordinates, no destination.
export function RequestBanner({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const dismissed = useRef(new Set<string>());
  const navigating = useRef(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("target_requests")
      .select("request_id,kind,requester_first_name,origin_label,dest_label,leave_at,status,expires_at,response,reasons")
      .order("expires_at", { ascending: false })
      .limit(10);
    const rows = ((data ?? []) as Row[]).filter((r) => new Date(r.expires_at).getTime() > Date.now() - 3 * 60_000);

    // Chosen for a broadcast: go to the walk.
    const chosen = rows.find((r) => r.kind === "broadcast" && r.status === "matched" && r.response === "accepted");
    if (chosen && !navigating.current && !dismissed.current.has(`go-${chosen.request_id}`)) {
      const { data: s } = await supabase.from("sessions").select("id").eq("request_id", chosen.request_id).maybeSingle();
      if (s) {
        navigating.current = true;
        dismissed.current.add(`go-${chosen.request_id}`);
        setCard(null);
        router.push(`/session/${s.id}`);
        setTimeout(() => (navigating.current = false), 3000);
        return;
      }
    }

    for (const r of rows) {
      if (dismissed.current.has(r.request_id)) continue;
      if (r.status === "open" && r.response === null) {
        setCard({ type: r.kind, row: r });
        return;
      }
      if (r.kind === "broadcast" && r.status === "open" && r.response === "applied") {
        setCard({ type: "waiting", row: r });
        return;
      }
      if (r.kind === "broadcast" && r.status === "matched" && r.response !== "accepted") {
        setCard({ type: "note", id: r.request_id, text: "Someone else is on the way, thank you." });
        return;
      }
      if (r.kind === "broadcast" && r.status === "cancelled" && r.response === "applied") {
        setCard({ type: "note", id: r.request_id, text: "They're safe, thanks for responding." });
        return;
      }
    }
    setCard(null);
  }, [supabase, router]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`targets-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_targets", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    const poll = setInterval(refresh, 3000); // safety net: requests changes are not visible to targets in realtime
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [supabase, userId, refresh]);

  async function respond(row: Row, response: "accepted" | "declined" | "applied") {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("respond", { body: { request_id: row.request_id, response } });
    setBusy(false);
    if (error) return refresh();
    if (response === "accepted") {
      dismissed.current.add(row.request_id);
      if (data?.session_id) router.push(`/session/${data.session_id}`);
      else setCard({ type: "note", id: `taken-${row.request_id}`, text: "Someone else already joined. Thanks for answering." });
      return;
    }
    if (response === "declined") dismissed.current.add(row.request_id);
    refresh(); // "applied" shows the waiting card
  }

  if (!card) return null;
  const mins = (r: Row) => Math.max(0, Math.round((new Date(r.leave_at).getTime() - Date.now()) / 60000));

  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-50 mx-auto w-full max-w-[430px] px-4 pt-4">
      <div className="rounded-[16px] border border-cardinal bg-surface p-4 shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
        {card.type === "walk" && (
          <>
            <p className="font-display text-xl font-semibold">Walk together?</p>
            <p className="mt-1 text-base">
              {card.row.requester_first_name ?? "Someone"} wants company, {card.row.origin_label} to {card.row.dest_label},
              leaving {mins(card.row) > 0 ? `in ${mins(card.row)} min` : "now"}.
            </p>
            {!!card.row.reasons?.length && (
              <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="match-reasons">
                <span className="text-sm text-dim">Why you:</span>
                {card.row.reasons.map((r) => (
                  <span key={r} className="rounded-[12px] border border-cardinal px-3 py-1 text-sm text-ink">
                    {REASON_LABEL[r]}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button disabled={busy} onClick={() => respond(card.row, "accepted")} className="h-12 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink disabled:opacity-50">Yes</button>
              <button disabled={busy} onClick={() => respond(card.row, "declined")} className="h-12 rounded-[12px] bg-background font-display text-lg font-semibold text-ink disabled:opacity-50">No</button>
            </div>
          </>
        )}
        {card.type === "broadcast" && (
          <>
            <p className="font-display text-xl font-semibold">Someone needs a person</p>
            <p className="mt-1 text-base">
              Someone near {card.row.origin_label} needs a person right now. Can you come?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button disabled={busy} onClick={() => respond(card.row, "applied")} className="h-12 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink disabled:opacity-50">Can come</button>
              <button disabled={busy} onClick={() => respond(card.row, "declined")} className="h-12 rounded-[12px] bg-background font-display text-lg font-semibold text-ink disabled:opacity-50">Can&apos;t</button>
            </div>
          </>
        )}
        {card.type === "waiting" && (
          <p className="text-base" data-testid="waiting-note">Sent. Waiting for them to choose.</p>
        )}
        {card.type === "note" && (
          <div className="flex items-center justify-between gap-3">
            <p data-testid="banner-note">{card.text}</p>
            <button
              onClick={() => {
                dismissed.current.add(card.id.replace(/^taken-/, ""));
                setCard(null);
                refresh();
              }}
              className="font-display text-lg font-semibold"
            >
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
