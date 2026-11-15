import { createClient } from "@/lib/supabase/server";
import { MapScreen } from "@/components/app/map-screen";

export default async function MapPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name")
    .eq("id", user!.id)
    .single();

  return (
    <MapScreen
      name={profile?.first_name ?? "there"}
      userId={user!.id}
      demoMode={process.env.DEMO_MODE === "true"}
    />
  );
}
