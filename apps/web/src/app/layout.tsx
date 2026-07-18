import type { Metadata, Viewport } from 'next';
import './globals.css';
import RegisterServiceWorker from '@/components/RegisterServiceWorker';

export const metadata: Metadata = {
  title: 'EYO — School Management',
  description: 'AI-powered school management for African private schools',
};

export const viewport: Viewport = {
  // viewportFit lets the guardian portal pad against the notch/home indicator via env().
  viewportFit: 'cover',
  themeColor: '#0d3627', // --color-forest-deep, matching the portal header
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="paper-bg min-h-screen antialiased">
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
