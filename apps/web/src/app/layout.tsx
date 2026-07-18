import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EYO — School Management',
  description: 'AI-powered school management for African private schools',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="paper-bg min-h-screen antialiased">{children}</body>
    </html>
  );
}
