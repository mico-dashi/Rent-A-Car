"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem { href: string; label: string }

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map((i) => {
        const active = i.href.split("/").length <= 3 ? path === i.href : path === i.href || path.startsWith(i.href + "/");
        return <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className="nav-link whitespace-nowrap">{i.label}</Link>;
      })}
    </nav>
  );
}
