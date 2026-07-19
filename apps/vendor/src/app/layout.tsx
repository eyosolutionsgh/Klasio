import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Klasio — Licensing',
  description: 'Vendor licensing and monitoring for Klasio deployments',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
