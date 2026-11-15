import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEMO_PASSWORD, DEMO_USERS } from "@/lib/demo-users";

// Signs the browser in as one of the four fixed demo users. No email, no magic link, no setup.
// Only those addresses are accepted.
export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  if (!DEMO_USERS.some((u) => u.email === email)) {
    return new NextResponse("Unknown demo user", { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) return new NextResponse(`Demo sign-in failed: ${error.message}`, { status: 500 });

  return NextResponse.redirect(new URL("/map", request.url), 303);
}
