import { getMe } from '@/lib/api';
import PortalShell from '@/components/PortalShell';
import LicenceBanner from '@/components/LicenceBanner';

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
      {/*
        In the layout rather than on the dashboard, so a lapse reaches whoever is next in the
        portal rather than only whoever happens to land on the front page. It renders nothing at
        all in the ordinary case, which is what makes that affordable.

        This slot used to hold PlatformNotices — messages from the vendor console, which no longer
        exists. The fetch behind it had been 404ing on every portal page load since that was
        removed, silently, because it was wrapped in a catch.
      */}
      <LicenceBanner
        status={me.licence ?? null}
        canManage={me.permissions?.includes('school.settings') ?? false}
      />
      {children}
    </PortalShell>
  );
}
