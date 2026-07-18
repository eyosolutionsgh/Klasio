import { getMe } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return (
    <div className="flex">
      <Sidebar school={me.school.name} userName={me.user.name} role={me.user.role} />
      <div className="flex-1 min-w-0">
        <header className="no-print flex items-center justify-between px-8 h-14 border-b border-mist bg-paper/70 backdrop-blur sticky top-0 z-40">
          <p className="text-[13px] text-oat">
            {me.currentTerm
              ? `${me.currentTerm.academicYear?.name ?? ''} · ${me.currentTerm.name}`
              : 'No current term set'}
          </p>
          <span
            data-tip="Your school's package — features unlock by package"
            className="tip text-[11px] uppercase tracking-widest font-medium text-forest bg-forest-mist rounded-full px-3 py-1"
          >
            {me.school.tier}
          </span>
        </header>
        <main className="px-8 py-8 max-w-6xl">{children}</main>
      </div>
    </div>
  );
}
