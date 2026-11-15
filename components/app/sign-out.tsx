"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOut() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      className="h-12 rounded-[12px] bg-surface font-display text-base font-semibold text-ink"
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
