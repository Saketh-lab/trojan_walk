import { DEMO_USERS } from "@/lib/demo-users";

// No email, no magic link: signing in is picking a demo user.
export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col justify-center gap-8 px-5 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">TROJANWALK</h1>
        <h2 className="mt-6 font-display text-4xl font-bold leading-tight">Walk together.</h2>
        <p className="mt-2 text-dim">Pick a demo user to sign in.</p>
      </div>

      <section className="flex flex-col gap-4" aria-label="Demo users">
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
      </section>
    </div>
  );
}
