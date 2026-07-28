import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Non-Employee Risk Management',
  description: 'Onboarding and lifecycle management for external workers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Resolve the theme before first paint so a dark-mode user never sees a
          white flash. Served as a static file rather than inlined, so the CSP
          can stay at script-src 'self' with no inline allowance or nonce.
          A synchronous script in <head> blocks parsing, so it runs before paint.
        */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- deliberately
            synchronous: it must run before first paint to avoid a flash of the
            wrong theme. It is a few lines of local script with no network cost. */}
        <script src="/theme.js" />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
