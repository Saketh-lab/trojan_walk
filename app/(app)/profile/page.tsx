import { createClient } from "@/lib/supabase/server";
import { FriendsSection } from "@/components/app/friends-section";
import { SignOut } from "@/components/app/sign-out";

export default async function ProfilePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("first_name,email").eq("id", user!.id).single();

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl font-bold leading-tight">Profile</h1>
        <p className="mt-1 text-dim">
          {profile?.first_name} · {profile?.email}
        </p>
      </header>
      <FriendsSection />
      <SignOut />
    </div>
  );
}
