import type { Metadata, Viewport } from 'next';
import './globals.css';
import RegisterServiceWorker from '@/components/RegisterServiceWorker';

export const metadata: Metadata = {
  title: 'Klasio — School Management',
  description: 'AI-powered school management for African private schools',
  manifest: '/manifest.webmanifest',
  // icon.png and apple-icon.png sit beside this file; Next wires them up by convention.
  // The Apple one is the white-background artwork on purpose — iOS composites a transparent
  // touch icon onto black, which would bury the emblem's navy.
};

export const viewport: Viewport = {
  // viewportFit lets the guardian portal pad against the notch/home indicator via env().
  viewportFit: 'cover',
  themeColor: '#0d3627', // --color-forest-deep, matching the portal header
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="paper-bg min-h-dvh antialiased">
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
