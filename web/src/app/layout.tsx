"use client";

import "./globals.css";

import { ThemeProvider } from "@/contexts/ThemeContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { DialogProvider, useDialogs } from "@/contexts/DialogContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ChatProvider } from "@/contexts/ChatContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ErrorToastProvider } from "@/contexts/ErrorToastContext";

const DialogRenderer = ({ children }: { children: React.ReactNode }) => {
  const { dialogs } = useDialogs();
  return (
    <>
      {children}
      {dialogs}
    </>
  );
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-mode="dark" data-theme="muted-blue">
      <head>
        <title>Crypton</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        <meta
          name="description"
          content="Secure messaging with end-to-end encryption"
        />
        {/* OGP */}
        <meta property="og:title" content="Crypton" />
        <meta
          property="og:description"
          content="Secure messaging with end-to-end encryption"
        />
        <meta property="og:type" content="website" />
        <meta
          property="og:image"
          content={`https://${process.env.NEXT_PUBLIC_SERVER_HOSTNAME ?? ""}/crypton.png`}
        />
        {/* Twitter Card */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Crypton" />
        <meta
          name="twitter:description"
          content="Secure messaging with end-to-end encryption"
        />
        <meta
          name="twitter:image"
          content={`https://${process.env.NEXT_PUBLIC_SERVER_HOSTNAME ?? ""}/crypton.png`}
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#6c8ebf" />
        <link rel="icon" href="/crypton.svg" type="image/svg+xml" />
        <link rel="icon" href="/crypton.png" type="image/png" />
        <link rel="apple-touch-icon" href="/crypton.png" />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <I18nProvider>
            <DialogProvider>
              <ErrorToastProvider>
                <AuthProvider>
                  <ChatProvider>
                    <NotificationProvider>
                      <DialogRenderer>{children}</DialogRenderer>
                    </NotificationProvider>
                  </ChatProvider>
                </AuthProvider>
              </ErrorToastProvider>
            </DialogProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
