"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Bell, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { currentPushStatus, subscribeToPush, type PushStatus } from "@/lib/push-client";
import { SwitchRow } from "@/components/app/switch-row";
import { Button } from "@/components/ui/button";

const GENDERS = [
  { v: "woman", l: "Woman" },
  { v: "man", l: "Man" },
  { v: "nonbinary", l: "Nonbinary" },
  { v: "prefer_not", l: "Prefer not to say" },
];
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
const SCHOOLS = ["Viterbi", "Marshall", "Dornsife", "Annenberg", "Cinematic Arts", "Price", "Leventhal", "Thornton", "Other"];
const AREAS = ["USC Village", "The Lorenzo", "Gateway", "Cardinal Gardens", "Icon Plaza", "Tuscany", "Off campus", "Other"];

// Hours are stored as an int4range in hours-since-midnight; past 24 means after midnight (25 = 1am).
const FROM_HOURS = Array.from({ length: 13 }, (_, i) => 18 + i); // 6pm .. 6am
const TO_HOURS = Array.from({ length: 13 }, (_, i) => 19 + i); // 7pm .. 7am
const hourLabel = (h: number) => {
  const x = h % 24;
  const label = x === 0 ? "12am" : x < 12 ? `${x}am` : x === 12 ? "12pm" : `${x - 12}pm`;
  return label;
};
const PRESETS = [
  { label: "Evening", from: 19, to: 24 },
  { label: "Late night", from: 22, to: 25 },
  { label: "Overnight", from: 23, to: 26 },
];

type WalkerRow = {
  verified: boolean;
  opted_in: boolean;
  hours: string[] | null;
  pings_tonight: number;
  max_pings_per_night: number;
  rating_avg: number | null;
  rating_count: number;
  strikes: number;
};

const field =
  "h-14 w-full rounded-[12px] border border-border bg-surface px-4 text-base text-ink outline-none focus:border-gold";

function parseRange(r: string | undefined): { from: number; to: number } | null {
  const m = r?.match(/^[\[(](\d+),(\d+)[\])]$/);
  return m ? { from: Number(m[1]), to: Number(m[2]) } : null;
}

export function WalkerScreen() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [walker, setWalker] = useState<WalkerRow | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [gender, setGender] = useState("");
  const [year, setYear] = useState("");
  const [school, setSchool] = useState("");
  const [area, setArea] = useState("");
  const [sameGender, setSameGender] = useState(false);
  const [from, setFrom] = useState(22);
  const [to, setTo] = useState(25);

  const [push, setPush] = useState<PushStatus | "off">("off");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setUserId(auth.user.id);
    const { data: p } = await supabase
      .from("profiles")
      .select("gender,class_year,school,area,same_gender_only")
      .eq("id", auth.user.id)
      .single();
    if (p) {
      setGender(p.gender ?? "");
      setYear(p.class_year ? String(p.class_year) : "");
      setSchool(p.school ?? "");
      setArea(p.area ?? "");
      setSameGender(!!p.same_gender_only);
    }
    const { data: w } = await supabase
      .from("walkers")
      .select("verified,opted_in,hours,pings_tonight,max_pings_per_night,rating_avg,rating_count,strikes")
      .maybeSingle();
    setWalker(w as WalkerRow | null);
    const r = parseRange((w as WalkerRow | null)?.hours?.[0]);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
    setLoaded(true);
    setPush(await currentPushStatus());
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const optedIn = !!walker && walker.opted_in;

  async function toggleOptIn(on: boolean) {
    if (!userId) return;
    setBusy(true);
    setMsg(null);
    const res = walker
      ? await supabase.from("walkers").update({ opted_in: on }).eq("user_id", userId)
      : await supabase.from("walkers").insert({ user_id: userId });
    setBusy(false);
    if (res.error) return setMsg(res.error.message);
    await load();
  }

  const needsProfile = !gender || !year || !school || !area;

  async function save() {
    if (!userId) return;
    if (to <= from) return setMsg("The end time must be after the start time.");
    setBusy(true);
    setMsg(null);
    const { error: pErr } = await supabase
      .from("profiles")
      .update({
        gender: gender || null,
        class_year: year ? Number(year) : null,
        school: school || null,
        area: area || null,
        same_gender_only: sameGender,
      })
      .eq("id", userId);
    let wErr = null;
    if (walker) {
      ({ error: wErr } = await supabase
        .from("walkers")
        .update({ hours: [`[${from},${to})`] as unknown as string[] })
        .eq("user_id", userId));
    }
    setBusy(false);
    if (pErr || wErr) return setMsg((pErr ?? wErr)!.message);
    setMsg("Saved.");
    await load();
  }

  async function enablePush() {
    if (!userId) return;
    setPush(await subscribeToPush(supabase, userId));
  }

  if (!loaded) return <p className="text-dim">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-bold leading-tight">Trojan Walker</h1>
        <p className="mt-1 text-dim">
          Get asked, rarely, to walk with a Trojan nearby who needs company. You always choose.
        </p>
      </header>

      <SwitchRow
        title="Be a Trojan Walker"
        hint={optedIn ? "You can be asked to walk with someone nearby." : "Off. You won't be asked."}
        on={optedIn}
        onChange={toggleOptIn}
        disabled={busy}
      />

      {walker && (
        <section className="flex flex-col gap-3 rounded-[12px] bg-surface p-4" data-testid="walker-status">
          <div className="flex items-center gap-2">
            <BadgeCheck className={walker.verified ? "h-5 w-5 text-gold" : "h-5 w-5 text-dim"} />
            <p className="font-display text-lg font-semibold">
              {walker.verified ? "Verified Walker" : "Verification pending"}
            </p>
          </div>
          <p className="text-sm text-dim">
            {walker.verified
              ? "You show a Walker badge and can be asked to walk."
              : "You'll start getting requests once the team verifies you."}
          </p>
          <p className="text-sm text-dim">
            {walker.pings_tonight} of {walker.max_pings_per_night} requests tonight
            {walker.rating_count > 0 && walker.rating_avg != null
              ? ` · ${Number(walker.rating_avg).toFixed(1)} stars from ${walker.rating_count} walks`
              : ""}
          </p>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold">Your profile</h2>
        <p className="-mt-2 text-sm text-dim">
          Requests go to Walkers who match the person asking, not just whoever is nearest.
        </p>
        <label className="flex flex-col gap-2 text-sm text-dim">
          Gender
          <select className={field} value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Choose</option>
            {GENDERS.map((g) => (
              <option key={g.v} value={g.v}>{g.l}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-dim">
          Year
          <select className={field} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Choose</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>Class of {y}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-dim">
          School
          <select className={field} value={school} onChange={(e) => setSchool(e.target.value)}>
            <option value="">Choose</option>
            {SCHOOLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-dim">
          Where you live
          <select className={field} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Choose</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <SwitchRow
          title="Same gender only"
          hint="When you ask for a walk, only Walkers of your gender are asked. Also applies to who you walk with."
          on={sameGender}
          onChange={setSameGender}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
          <Clock className="h-6 w-6 text-gold" /> Your hours
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => {
            const active = from === p.from && to === p.to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                }}
                className={`h-12 rounded-[12px] font-display text-base font-semibold ${
                  active ? "bg-cardinal text-ink" : "bg-surface text-ink"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-2 text-sm text-dim">
            From
            <select className={field} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              {FROM_HOURS.map((h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm text-dim">
            Until
            <select className={field} value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {TO_HOURS.map((h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-dim">
          Requests only come in these hours, at most 3 a night, and only from people within about 100 m.
          {!walker && " Turn on Trojan Walker above to save your hours."}
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-[12px] bg-surface p-4">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-gold" />
          <h2 className="font-display text-xl font-semibold">Notifications</h2>
        </div>
        <p className="text-sm text-dim" data-testid="push-status">
          {push === "subscribed"
            ? "On. You'll be notified of requests."
            : push === "denied"
              ? "Blocked in your browser settings. Allow notifications for this site to turn this on."
              : push === "unsupported"
                ? "Not available in this browser. On iPhone, add TrojanWalk to your Home Screen first. You'll still see requests while the app is open."
                : push === "error"
                  ? "Couldn't turn on notifications. You'll still see requests while the app is open."
                  : "Off. You'll only see requests while the app is open."}
        </p>
        {push !== "subscribed" && push !== "unsupported" && (
          <Button
            onClick={enablePush}
            className="h-12 rounded-[12px] bg-cardinal font-display text-base font-semibold text-ink hover:bg-cardinal/90"
          >
            Turn on notifications
          </Button>
        )}
        <p className="text-xs text-dim">
          To be matched, keep TrojanWalk open with{" "}
          <Link href="/map" className="underline">Walking alone</Link> on while you are on duty.
        </p>
      </section>

      {msg && <p className="text-sm text-gold" data-testid="walker-msg">{msg}</p>}
      <Button
        onClick={save}
        disabled={busy || needsProfile}
        className="h-14 rounded-[12px] bg-cardinal font-display text-lg font-semibold text-ink hover:bg-cardinal/90 disabled:opacity-50"
      >
        {needsProfile ? "Answer all four questions to save" : "Save"}
      </Button>
    </div>
  );
}
