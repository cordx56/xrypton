import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const acceptLang = request.headers.get("accept-language") ?? "";
  const locale = acceptLang.includes("ja") ? "ja" : "en";
  return NextResponse.redirect(new URL(`/docs/${locale}`, request.url));
}

export const config = {
  matcher: "/docs",
};
