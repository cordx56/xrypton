"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import nav from "./nav";
import type { Locale } from "@/i18n/types";

export default function DocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const locale = (pathname.split("/")[2] ?? "en") as Locale;
  const items = nav[locale] ?? nav.en;

  const otherLocale: Locale = locale === "ja" ? "en" : "ja";
  const switchPath = pathname.replace(
    `/docs/${locale}`,
    `/docs/${otherLocale}`,
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-3 left-3 z-50 md:hidden rounded-lg p-2 bg-bg/80 backdrop-blur-sm border border-accent/30"
        aria-label="Toggle navigation"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          {open ? (
            <path d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" />
          ) : (
            <path d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
          )}
        </svg>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-40 h-full w-64 bg-bg border-r border-accent/20 p-6 pt-14 transition-transform md:static md:translate-x-0 md:z-auto ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link
          href={`/docs/${locale}`}
          className="block text-lg font-bold text-fg mb-6 no-underline"
        >
          Xrypton Docs
        </Link>

        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            const href = `/docs/${locale}${item.slug ? `/${item.slug}` : ""}`;
            const isActive = pathname === href;
            return (
              <Link
                key={item.slug}
                href={href}
                onClick={() => setOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm no-underline transition-colors ${
                  isActive
                    ? "bg-accent/15 text-accent font-medium"
                    : "text-muted hover:text-fg hover:bg-fg/5"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 border-t border-accent/20 pt-4">
          <Link
            href={switchPath}
            onClick={() => setOpen(false)}
            className="text-sm text-muted hover:text-fg no-underline"
          >
            {locale === "ja" ? "English" : "日本語"}
          </Link>
        </div>
      </aside>
    </>
  );
}
