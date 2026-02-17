"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMessage, faAddressBook } from "@fortawesome/free-regular-svg-icons";
import { faGear, faGlobe } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

type TabDef = {
  href: string;
  /** このタブがアクティブかを判定するパスのプレフィックス */
  match: (pathname: string) => boolean;
  icon: IconDefinition;
};

const tabs: TabDef[] = [
  {
    href: "/chat",
    match: (p) => p.startsWith("/chat"),
    icon: faMessage,
  },
  {
    href: "/contact",
    match: (p) => p.startsWith("/contact"),
    icon: faAddressBook,
  },
  {
    href: "/atproto",
    match: (p) => p.startsWith("/atproto"),
    icon: faGlobe,
  },
  {
    href: "/config",
    match: (p) => p.startsWith("/config"),
    icon: faGear,
  },
];

const BottomTabs = () => {
  const pathname = usePathname();

  return (
    <nav className="border-t border-accent/30 bg-bg">
      <div className="flex max-w-[1400px] mx-auto w-full">
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 pt-5 pb-7 flex items-center justify-center transition-colors
                ${active ? "text-accent border-t-2 border-accent" : "text-muted hover:text-fg"}`}
            >
              <FontAwesomeIcon icon={tab.icon} className="text-xl" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomTabs;
