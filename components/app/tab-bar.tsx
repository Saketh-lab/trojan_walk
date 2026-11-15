"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Clock, Footprints, User } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/map", label: "Home", icon: Home },
  { href: "/history", label: "History", icon: Clock },
  { href: "/walker", label: "Walker", icon: Footprints },
  { href: "/profile", label: "Profile", icon: User },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[430px] px-4 pb-4"
    >
      <div className="flex items-center justify-around rounded-[16px] border border-border bg-surface p-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 w-16 items-center justify-center rounded-[12px] transition-colors",
                active ? "bg-cardinal text-gold" : "text-dim hover:text-ink"
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={2} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
