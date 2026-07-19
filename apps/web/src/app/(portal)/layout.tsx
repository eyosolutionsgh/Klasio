import { api, getMe } from '@/lib/api';
import PortalShell from '@/components/PortalShell';
import PlatformNotices, { type Notice } from '@/components/PlatformNotices';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  // A message from EYO should reach whoever next opens the portal, not wait to be looked for,
  // so it is fetched in the layout rather than on any one page. Failing quietly is deliberate:
  // a vendor notice is never worth taking a school's own dashboard down over.
  const notices = await api<Notice[]>('/notices').catch(() => [] as Notice[]);
  const termLabel = me.currentTerm
    ? `${me.currentTerm.academicYear?.name ?? ''} · ${me.currentTerm.name}`
    : 'No current term set';

  return (
    <PortalShell
      school={me.school.name}
      hasLogo={!!me.school.hasLogo}
      brandColor={me.school.brandColor ?? null}
      userName={me.user.name}
      userEmail={me.user.email}
      role={me.user.role}
      termLabel={termLabel}
      tier={me.school.tier}
      entitlements={me.entitlements ?? []}
    >
      <PlatformNotices notices={notices} />
      {children}
    </PortalShell>
  );
}
