import { LoginForm } from "./login-form";
import { DEMO_USERS } from "@/lib/demo-users";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col justify-center gap-8 px-5 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">TROJANWALK</h1>
        <h2 className="mt-6 font-display text-4xl font-bold leading-tight">
          Walk together.
        </h2>
        <p className="mt-2 text-dim">Sign in with your @usc.edu email.</p>
      </div>
      {searchParams.error === "link" && (
        <p className="rounded-[12px] border border-cardinal bg-surface px-4 py-3 text-sm">
          That sign-in link expired or was already used. Request a new one.
        </p>
      )}
      <LoginForm />
      {process.env.DEMO_MODE === "true" && (
        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <h3 className="font-display text-xl font-semibold">Demo users</h3>
          <p className="text-sm text-dim">
            Demo mode only. Use a normal window for one user and a private window for another;
            tabs in the same window share one session.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {DEMO_USERS.map((u) => (
              <form key={u.email} action="/api/dev-login" method="post">
                <input type="hidden" name="email" value={u.email} />
                <button
                  type="submit"
                  className="h-12 w-full rounded-[12px] bg-surface font-display text-base font-semibold text-ink"
                >
                  {u.name}
                </button>
              </form>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
