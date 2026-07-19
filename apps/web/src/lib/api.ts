import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Server-side API fetch with the session token. Redirects to /login on 401. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const jar = await cookies();
  const token = jar.get('eyo_token')?.value;
  if (!token) redirect('/login');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  user: { id: string; name: string; email: string; role: string };
  school: {
    id: string;
    name: string;
    motto: string | null;
    tier: string;
    currency: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    brandColor: string | null;
    hasLogo: boolean;
  };
  currentTerm: {
    id: string;
    name: string;
    nextTermBegins: string | null;
    academicYear: { name: string };
  } | null;
  /** What this person may do — gates which actions the UI offers. The API enforces it too. */
  permissions?: string[];
  entitlements: string[];
}

export const getMe = () => api<Me>('/me');

export const money = (n: number, currency = 'GHS') =>
  `${currency} ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
