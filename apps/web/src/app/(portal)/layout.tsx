import { getMe } from '@/lib/api';
import PortalShell from '@/components/PortalShell';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
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
      {children}
    </PortalShell>
  );
}
