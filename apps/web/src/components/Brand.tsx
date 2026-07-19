'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Who this server belongs to, available before anyone signs in.
 *
 * Only possible since the product went single-tenant. On a shared hostname the login page could
 * not know which school was at the door, which is why every sign-in screen used to be branded
 * Klasio and nothing else. One school per server makes the answer a constant, so the crest and the
 * name can lead every page in the product — including the ones you see before you have an account.
 *
 * Fetched once by the root layout and handed down, rather than fetched per page: it is the same
 * answer everywhere, and a per-page fetch would flash the fallback on every navigation.
 */
export interface Branding {
  configured: boolean;
  name: string | null;
  motto: string | null;
  brandColor: string | null;
  hasLogo: boolean;
  /** Sign-in pages the school has put its own photograph on. Everything else uses the default. */
  photoSlots: BrandPhotoSlot[];
}

/** One per sign-in door, plus GENERAL for the pages nobody arrives at on purpose. */
export type BrandPhotoSlot = 'STAFF' | 'FAMILY' | 'STUDENT' | 'GENERAL';

const FALLBACK: Branding = {
  configured: false,
  name: null,
  motto: null,
  brandColor: null,
  hasLogo: false,
  photoSlots: [],
};

const BrandContext = createContext<Branding>(FALLBACK);

export function BrandProvider({ value, children }: { value: Branding; children: ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): Branding {
  return useContext(BrandContext);
}

/**
 * The school's name for display, or the product's when there is no school yet.
 *
 * A brand-new box genuinely has no school — the setup page runs before one exists — and "Klasio"
 * is the honest answer there rather than an empty heading.
 */
export function useSchoolName(): string {
  return useBrand().name ?? 'Klasio';
}
