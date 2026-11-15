import { LoginForm } from "./login-form";
import { DEMO_USERS } from "@/lib/demo-users";

// Read per request (not at build time) so the Vercel env var decides which sign-in the page shows.
export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const demoOn = process.env.DEMO_MODE === "true";
  const demoReady = demoOn && !!process.env.DEMO_PASSWORD;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col justify-center gap-8 px-5 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">TROJANWALK</h1>
        <h2 className="mt-6 font-display text-4xl font-bold leading-tight">Walk together.</h2>
        <p className="mt-2 text-dim">
          {demoOn ? "Demo mode. Pick a demo user to sign in." : "Sign in with your @usc.edu email."}
        </p>
      </div>

      {demoOn ? (
        // Demo mode: the demo buttons are the only sign-in. No email field, no magic link.
        <section className="flex flex-col gap-4" aria-label="Demo users">
          {demoReady ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {DEMO_USERS.map((u) => (
                  <form key={u.email} action="/api/dev-login" method="post">
                    <input type="hidden" name="email" value={u.email} />
                    <button
                      type="submit"
                      className="h-16 w-full rounded-[12px] bg-cardinal font-display text-xl font-semibold text-ink"
                    >
                      {u.name}
                    </button>
                  </form>
                ))}
              </div>
              <p className="text-sm text-dim">
                Use a normal window for one user and a private window for another; tabs in the same
                window share one session.
              </p>
            </>
          ) : (
            <p className="rounded-[12px] border border-cardinal bg-surface px-4 py-3 text-sm">
              Demo mode is on but <code>DEMO_PASSWORD</code> is not set, so demo sign-in can&apos;t work. Set
              it in the environment and redeploy.
            </p>
          )}
        </section>
      ) : (
        <>
          {searchParams.error === "link" && (
            <p className="rounded-[12px] border border-cardinal bg-surface px-4 py-3 text-sm">
              That sign-in link expired or was already used. Request a new one.
            </p>
          )}
          <LoginForm />
        </>
      )}
    </div>
  );
}
