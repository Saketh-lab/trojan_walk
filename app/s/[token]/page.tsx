import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/app/auto-refresh";

// Public, no sign-in: what a contact sees from the SMS link. Valid for 30 minutes.
export const dynamic = "force-dynamic";

type Fix = {
  first_name: string;
  dest_label: string | null;
  lat: number | null;
  lng: number | null;
  at: string | null;
  state: string;
};

const ALERT_STATES = ["checkin_missed", "escalated"];

export default async function SharePage({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const { data } = await supabase.rpc("share_link_fix", { tok: params.token });
  const fix = data as Fix | null;
  const alert = fix ? ALERT_STATES.includes(fix.state) : false;
  const over = fix ? ["arrived", "ended"].includes(fix.state) : false;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col justify-center gap-5 px-5 py-8">
      <h1 className="font-display text-3xl font-bold tracking-wide">TROJANWALK</h1>
      {!fix ? (
        <section className="rounded-[12px] bg-surface p-5">
          <h2 className="font-display text-2xl font-semibold">This link has expired</h2>
          <p className="mt-2 text-dim">Links last 30 minutes. If you&apos;re worried, call them or DPS.</p>
        </section>
      ) : (
        <section className="flex flex-col gap-4 rounded-[12px] bg-surface p-5">
          {!over && !alert && <AutoRefresh />}
          <h2 className="font-display text-2xl font-semibold" data-testid="share-title">
            {alert
              ? `${fix.first_name} missed a safety check-in`
              : over
                ? `${fix.first_name}'s walk has ended`
                : `You're watching ${fix.first_name}'s walk`}
          </h2>
          <p className="text-dim">
            {over ? "Walked to" : "Walking to"} {fix.dest_label ?? "their destination"}.
            {!alert && !over && " You'll get a text if they miss a safety check-in."}
          </p>
          {fix.lat != null && fix.lng != null ? (
            <>
              <p className="text-dim">
                Last seen {fix.at ? new Date(fix.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "recently"}.
              </p>
              <a
                href={`https://www.openstreetmap.org/?mlat=${fix.lat}&mlon=${fix.lng}#map=18/${fix.lat}/${fix.lng}`}
                className="flex h-12 items-center justify-center rounded-[12px] bg-cardinal font-display text-lg font-semibold"
              >
                Open last location
              </a>
            </>
          ) : (
            <p className="text-dim">No location has been shared yet.</p>
          )}
          <a href="tel:+12137404321" className="flex h-12 items-center justify-center rounded-[12px] bg-background font-display text-lg font-semibold">
            Call DPS 213-740-4321
          </a>
        </section>
      )}
    </main>
  );
}
