import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SessionScreen } from "@/components/app/session-screen";

export default async function SessionPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // RLS only returns sessions the caller belongs to.
  const { data: session } = await supabase.from("sessions").select("id").eq("id", params.id).maybeSingle();
  if (!user || !session) notFound();

  return <SessionScreen sessionId={params.id} userId={user.id} demoMode={process.env.DEMO_MODE === "true"} />;
}
