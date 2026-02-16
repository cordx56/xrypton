import { notFound } from "next/navigation";
import fs from "fs";
import path from "path";
import type { ComponentType } from "react";

type Params = { locale: string; slug?: string[] };

const DOCS_DIR = path.resolve(process.cwd(), "..", "crypton-docs");

// webpack require.context to discover all .md/.mdx files under crypton-docs
const mdxContext = require.context("@docs", true, /\.mdx?$/);

function loadMDX(locale: string, slug: string): ComponentType | null {
  const keys = mdxContext.keys();
  // .mdx takes priority over .md
  const key =
    keys.find((k) => k === `./${locale}/${slug}.mdx`) ??
    keys.find((k) => k === `./${locale}/${slug}.md`);
  if (!key) return null;
  return mdxContext(key).default;
}

export default async function DocsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale, slug } = await params;
  const slugPath = slug?.join("/") || "index";
  const Content = loadMDX(locale, slugPath);
  if (!Content) notFound();
  return <Content />;
}

export function generateStaticParams(): Params[] {
  const params: Params[] = [];

  for (const locale of ["en", "ja"]) {
    const dir = path.join(DOCS_DIR, locale);
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;
      const name = file.replace(/\.mdx?$/, "");
      if (name === "index") {
        params.push({ locale, slug: undefined });
      } else {
        params.push({ locale, slug: [name] });
      }
    }
  }

  return params;
}
