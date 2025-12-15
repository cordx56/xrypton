"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ContextProvider, useContexts } from "@/utils/context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BaseRenderer = ({ children }: { children: React.ReactNode }) => {
  const { dialogs } = useContexts();
  return (
    <>
      {children}
      {dialogs?.dialogs}
    </>
  );
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ContextProvider>
          <BaseRenderer>{children}</BaseRenderer>
        </ContextProvider>
      </body>
    </html>
  );
}
