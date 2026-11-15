"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const USC = /^[^@\s]+@usc\.edu$/i;

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const addr = email.trim().toLowerCase();
    if (!USC.test(addr)) {
      setError("Use your @usc.edu email address.");
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setEmail(addr);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await createClient().auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/map");
    router.refresh();
  }

  const field =
    "h-14 w-full rounded-[12px] border border-border bg-surface px-4 text-base text-ink placeholder:text-dim outline-none focus:border-gold";

  if (step === "code") {
    return (
      <form onSubmit={verify} className="flex flex-col gap-4">
        <p className="text-dim">
          We sent a link to <span className="text-ink">{email}</span>. Tap it, or enter the
          code from the email.
        </p>
        <input
          className={field}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <p className="text-sm text-gold">{error}</p>}
        <Button type="submit" disabled={busy || !code.trim()} className="h-14 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink hover:bg-cardinal/90">
          Verify code
        </Button>
        <button type="button" onClick={() => { setStep("email"); setCode(""); }} className="text-sm text-dim underline">
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={sendLink} className="flex flex-col gap-4">
      <input
        className={field}
        type="email"
        autoComplete="email"
        placeholder="you@usc.edu"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error && <p className="text-sm text-gold">{error}</p>}
      <Button type="submit" disabled={busy || !email} className="h-14 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink hover:bg-cardinal/90">
        {busy ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
