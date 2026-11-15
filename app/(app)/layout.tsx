import { TabBar } from "@/components/app/tab-bar";
import { RequestBanner } from "@/components/app/request-banner";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="mx-auto min-h-screen w-full max-w-[430px] bg-background">
      <div className="px-5 pb-32 pt-5">{children}</div>
      {user && <RequestBanner userId={user.id} />}
      <TabBar />
    </div>
  );
}
