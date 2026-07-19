import type { Metadata, Viewport } from 'next';
import './globals.css';
import RegisterServiceWorker from '@/components/RegisterServiceWorker';
import { BrandProvider, type Branding } from '@/components/Brand';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
  themeColor: '#001d40', // --color-forest-deep, matching the portal header
};

const UNBRANDED: Branding = {
  configured: false,
  name: null,
  motto: null,
  brandColor: null,
  hasLogo: false,
  photoSlots: [],
};

/**
 * Whose school this is, fetched once for the whole app.
 *
 * Revalidated rather than fetched per request: the answer changes when someone edits the branding
 * screen, which happens a handful of times in a school's life. A failure is not fatal — the pages
 * fall back to Klasio's own colours, which is exactly how they looked before this existed.
 */
async function loadBranding(): Promise<Branding> {
  try {
    const res = await fetch(`${API_URL}/public/branding`, { next: { revalidate: 60 } });
    if (!res.ok) return UNBRANDED;
    const data = (await res.json()) as Partial<Branding>;
    // photoSlots defaulted rather than assumed: an older API answering this route without it
    // should degrade to the shipped pictures, not crash every sign-in page on `.includes`.
    return { ...UNBRANDED, ...data, photoSlots: data.photoSlots ?? [] };
  } catch {
    return UNBRANDED;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await loadBranding();

  return (
    <html lang="en">
      {/*
        `brand-scope` at the root, not only inside the portal.

        globals.css derives --brand-deep and --brand-mist from --brand wherever this class lands,
        so a school's own colour now reaches the sign-in pages — the first thing anyone ever sees
        of the product. It could not before: on a shared hostname the login page had no idea which
        school was at the door. PortalShell still sets its own, which is harmless duplication —
        it resolves to the same value.
      */}
      <body
        className="paper-bg brand-scope min-h-dvh antialiased"
        style={
          branding.brandColor
            ? ({ '--brand': branding.brandColor } as React.CSSProperties)
            : undefined
        }
      >
        <RegisterServiceWorker />
        <BrandProvider value={branding}>{children}</BrandProvider>
      </body>
    </html>
  );
}
