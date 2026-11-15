"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contact, UserPlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { hashPhone, phoneSaltConfigured, toE164 } from "@/lib/phone";
import { Button } from "@/components/ui/button";

type Friend = { friend_id: string; first_name: string; source: "contacts" | "in_app" };

const field =
  "h-14 w-full rounded-[12px] border border-border bg-surface px-4 text-base text-ink placeholder:text-dim outline-none focus:border-gold";

type PickerContact = { tel?: string[] };
type ContactsApi = { select: (props: string[], opts?: { multiple?: boolean }) => Promise<PickerContact[]> };

export function FriendsSection() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [hasNumber, setHasNumber] = useState(false);
  const [email, setEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [myNumber, setMyNumber] = useState("");
  const [numberMsg, setNumberMsg] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setUserId(auth.user.id);
    const { data: f } = await supabase.from("my_friends").select("friend_id,first_name,source").order("first_name");
    setFriends((f ?? []) as Friend[]);
    const { data: p } = await supabase.from("profiles").select("phone_hash").eq("id", auth.user.id).single();
    setHasNumber(!!p?.phone_hash);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addByEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setEmailMsg(null);
    const { data, error } = await supabase.rpc("add_friend_by_email", { p_email: email });
    setBusy(false);
    if (error) return setEmailMsg("Couldn't add that person. Try again.");
    const s = data as { status: string; first_name?: string };
    setEmailMsg(
      {
        added: `Added ${s.first_name}. You're now friends.`,
        already: `You're already friends with ${s.first_name}.`,
        self: "That's your own email.",
        invalid: "Use a @usc.edu email address.",
        not_found: "No Trojan found with that email.",
      }[s.status] ?? "Couldn't add that person."
    );
    if (s.status === "added") setEmail("");
    load();
  }

  async function saveMyNumber(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const e164 = toE164(myNumber);
    if (!e164) return setNumberMsg("Enter a phone number, with country code if it isn't a US number.");
    if (!phoneSaltConfigured) return setNumberMsg("Phone matching isn't set up yet (missing app salt).");
    setBusy(true);
    setNumberMsg(null);
    const { error } = await supabase.from("profiles").update({ phone_hash: await hashPhone(e164) }).eq("id", userId);
    setBusy(false);
    if (error) {
      return setNumberMsg(
        error.code === "23505" ? "That number is already linked to another account." : "Couldn't save your number."
      );
    }
    setMyNumber("");
    setNumberMsg("Saved. Friends with your number in their contacts can now find you.");
    load();
  }

  async function syncNumbers(numbers: string[]) {
    if (!phoneSaltConfigured) return setSyncMsg("Contact matching isn't set up yet (missing app salt).");
    const hashed = await Promise.all(
      numbers.map(async (n) => {
        const e = toE164(n);
        return e ? hashPhone(e) : null;
      })
    );
    const hashes = Array.from(new Set(hashed.filter((h): h is string => !!h)));
    if (!hashes.length) return setSyncMsg("No usable phone numbers found.");
    setBusy(true);
    setSyncMsg(null);
    const { data, error } = await supabase.functions.invoke("contacts-sync", { body: { phone_hashes: hashes } });
    setBusy(false);
    if (error || !data) return setSyncMsg("Couldn't sync contacts. Try again.");
    setSyncMsg(
      data.matched === 0
        ? `Checked ${hashes.length} number${hashes.length === 1 ? "" : "s"}. No one is on TrojanWalk yet.`
        : `Found ${data.matched} Trojan${data.matched === 1 ? "" : "s"} in your contacts${
            data.added < data.matched ? ` (${data.added} new)` : ""
          }. They're now in your friends.`
    );
    load();
  }

  async function syncContacts() {
    setSyncMsg(null);
    const api = (navigator as unknown as { contacts?: ContactsApi }).contacts;
    if (api?.select) {
      try {
        const picked = await api.select(["tel"], { multiple: true });
        return syncNumbers(picked.flatMap((c) => c.tel ?? []));
      } catch {
        return; // picker dismissed
      }
    }
    // iPhone Safari and desktop browsers have no contact picker: paste numbers instead.
    setPasteOpen(true);
  }

  async function remove(id: string) {
    await supabase.rpc("remove_friend", { p_friend: id });
    load();
  }

  return (
    <section className="flex flex-col gap-5" aria-label="Friends">
      <div>
        <h2 className="font-display text-2xl font-semibold">Friends</h2>
        <p className="mt-1 text-sm text-dim">
          Friends get your walk requests first. Being friends never shares your location; they see you only for a walk
          they say yes to.
        </p>
      </div>

      <form onSubmit={addByEmail} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm text-dim">
          Add friend by email
          <input
            className={field}
            type="email"
            autoComplete="off"
            placeholder="friend@usc.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {emailMsg && <p className="text-sm text-gold" data-testid="email-msg">{emailMsg}</p>}
        <Button
          type="submit"
          disabled={busy || !email.trim()}
          className="h-12 rounded-[12px] bg-cardinal font-display text-base font-semibold text-ink hover:bg-cardinal/90"
        >
          <UserPlus className="mr-2 h-5 w-5" /> Add friend
        </Button>
      </form>

      <div className="flex flex-col gap-3 rounded-[12px] bg-surface p-4">
        <p className="font-display text-xl font-semibold">Find friends from your contacts</p>
        <p className="text-sm text-dim">
          Your contacts stay on your phone. Only scrambled (hashed) numbers are sent to match against other Trojans.
        </p>
        <Button
          onClick={syncContacts}
          disabled={busy}
          className="h-12 rounded-[12px] bg-cardinal font-display text-base font-semibold text-ink hover:bg-cardinal/90"
        >
          <Contact className="mr-2 h-5 w-5" /> Sync contacts
        </Button>
        {pasteOpen && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-2 text-sm text-dim">
              Your browser can&apos;t open contacts. Paste numbers, one per line.
              <textarea
                rows={4}
                className={`${field} h-auto py-3`}
                placeholder={"(213) 555-0123\n+1 310 555 0199"}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
            </label>
            <Button
              onClick={() => syncNumbers(pasted.split(/[\n,;]+/))}
              disabled={busy || !pasted.trim()}
              className="h-12 rounded-[12px] bg-background font-display text-base font-semibold text-ink hover:bg-background"
            >
              Sync these numbers
            </Button>
          </div>
        )}
        {syncMsg && <p className="text-sm text-gold" data-testid="sync-msg">{syncMsg}</p>}
      </div>

      <form onSubmit={saveMyNumber} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm text-dim">
          Your number, so friends can find you
          <input
            className={field}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={hasNumber ? "Saved. Enter a new number to change it" : "(213) 555-0123"}
            value={myNumber}
            onChange={(e) => setMyNumber(e.target.value)}
          />
          <span className="text-xs">We store only a scrambled version, never the number itself.</span>
        </label>
        {numberMsg && <p className="text-sm text-gold" data-testid="number-msg">{numberMsg}</p>}
        <Button
          type="submit"
          disabled={busy || !myNumber.trim()}
          className="h-12 rounded-[12px] bg-surface font-display text-base font-semibold text-ink hover:bg-surface"
        >
          {hasNumber ? "Update my number" : "Save my number"}
        </Button>
      </form>

      <div className="flex flex-col gap-3">
        <h3 className="font-display text-xl font-semibold">
          Your friends{friends.length ? ` (${friends.length})` : ""}
        </h3>
        {friends.length === 0 ? (
          <p className="rounded-[12px] bg-surface px-4 py-5 text-dim" data-testid="no-friends">
            No friends yet. Add one by email or sync your contacts.
          </p>
        ) : (
          friends.map((f) => (
            <div key={f.friend_id} data-testid="friend-row" className="flex items-center gap-3 rounded-[12px] bg-surface px-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-semibold">{f.first_name}</p>
                <p className="text-sm text-dim">{f.source === "contacts" ? "From your contacts" : "Added by email"}</p>
              </div>
              <button
                aria-label={`Remove ${f.first_name}`}
                onClick={() => remove(f.friend_id)}
                className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-background text-dim"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
