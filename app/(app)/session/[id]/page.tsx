import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Placeholder until Prompt 4 (live dots, check-in, arrival). Proves both parties land on the same session.
export default async function SessionPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: session } = await supabase
    .from("sessions")
    .select("id,state,meeting_point")
    .eq("id", params.id)
    .maybeSingle();
  if (!session) notFound();
  const { data: peer } = await supabase
    .from("session_peers")
    .select("first_name")
    .eq("session_id", params.id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-bold">Walking with {peer?.first_name ?? "your companion"}</h1>
      <div className="rounded-[12px] bg-surface p-5">
        <p className="text-dim">Meet at</p>
        <p className="font-display text-xl font-semibold">{session.meeting_point ?? "your starting point"}</p>
        <p className="mt-3 text-dim">State: <span data-testid="session-state" className="text-ink">{session.state}</span></p>
        <p className="mt-3 text-sm text-dim">Live dots and check-ins arrive in the next build.</p>
      </div>
      <p className="text-xs text-dim" data-testid="session-id">{session.id}</p>
    </div>
  );
}
