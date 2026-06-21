import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/providers/Providers';
import { themeInitScript } from '@/providers/ThemeProvider';

export const metadata: Metadata = {
  title: 'Erp Grid8',
  description: 'Erp Grid8 — Modular ERP Control Panel',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme: runs before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
