import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEMO_USERS } from "@/lib/demo-users";

// DEMO_MODE only: signs the browser in as one of the fixed demo users, no email needed.
// 404s unless DEMO_MODE=true, and only ever accepts the fixed demo addresses. The password
// is a random value in .env.local (DEMO_PASSWORD), never in the repo.
export async function POST(request: Request) {
  if (process.env.DEMO_MODE !== "true" || !process.env.DEMO_PASSWORD) {
    return new NextResponse("Not found", { status: 404 });
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  if (!DEMO_USERS.some((u) => u.email === email)) {
    return new NextResponse("Unknown demo user", { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: process.env.DEMO_PASSWORD,
  });
  if (error) return new NextResponse(`Demo sign-in failed: ${error.message}`, { status: 500 });

  return NextResponse.redirect(new URL("/map", request.url), 303);
}
