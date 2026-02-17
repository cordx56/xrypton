import type { ReactNode } from "react";
import Link from "next/link";
import DocsSidebar from "@/components/docs/DocsSidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh flex flex-col bg-bg text-fg">
      {/* Header */}
      <header className="shrink-0 border-b border-accent/20 px-4 py-3 flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-muted hover:text-fg no-underline"
        >
          &larr; Xrypton
        </Link>
      </header>

      <div className="flex flex-1 min-h-0">
        <DocsSidebar />

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-6 py-8 md:px-12">
          <article className="prose prose-sm md:prose-base max-w-3xl prose-headings:text-fg prose-p:text-fg prose-strong:text-fg prose-a:text-accent prose-blockquote:text-muted prose-blockquote:border-accent/40 prose-code:text-accent prose-li:text-fg prose-hr:border-accent/20 prose-th:text-fg prose-td:text-fg prose-th:border-accent/20 prose-td:border-accent/20">
            {children}
          </article>
        </main>
      </div>
    </div>
  );
}
