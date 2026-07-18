import { api, getMe } from '@/lib/api';
import ResourceFilters from '@/components/ResourceFilters';
import UploadResource from '@/components/UploadResource';
import ResourceActions from '@/components/ResourceActions';

interface Resource {
  id: string;
  title: string;
  description: string | null;
  filename: string;
  sizeBytes: number;
  published: boolean;
  downloads: number;
  createdAt: string;
  subjectName: string | null;
  levelName: string | null;
  className: string | null;
}
interface Structure {
  levels: { id: string; name: string }[];
  classes: { id: string; name: string; level: string }[];
  subjects: { id: string; name: string }[];
}

const STATES = [
  { key: 'true', label: 'Published' },
  { key: 'false', label: 'Drafts' },
];

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{
    levelId?: string;
    classId?: string;
    subjectId?: string;
    published?: string;
  }>;
}) {
  const { levelId, classId, subjectId, published } = await searchParams;
  const qs = new URLSearchParams();
  if (levelId) qs.set('levelId', levelId);
  if (classId) qs.set('classId', classId);
  if (subjectId) qs.set('subjectId', subjectId);
  if (published) qs.set('published', published);

  const [resources, structure, me] = await Promise.all([
    api<Resource[]>(`/resources?${qs}`),
    api<Structure>('/school/structure'),
    getMe(),
  ]);

  const canManage = ['OWNER', 'HEAD', 'TEACHER'].includes(me.user.role);

  return (
    <div>
      <div className="rise rise-1">
        <h1 className="font-display text-3xl">Learning Resources</h1>
        <p className="text-sm text-oat mt-1.5">
          Notes, homework and past questions. Nothing reaches a pupil or a parent until it is
          published.
        </p>
      </div>

      <div className="mt-6 rise rise-2">
        <ResourceFilters
          levelId={levelId}
          classId={classId}
          subjectId={subjectId}
          published={published}
          levels={structure.levels}
          classes={structure.classes}
          subjects={structure.subjects}
          states={STATES}
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-6 mt-6">
        {canManage && (
          <UploadResource
            levels={structure.levels}
            classes={structure.classes}
            subjects={structure.subjects}
          />
        )}

        <div className={`card overflow-x-auto rise rise-3 ${canManage ? '' : 'lg:col-span-2'}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-oat border-b border-mist bg-parchment/50">
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">For</th>
                <th className="px-5 py-3 font-medium">Opens</th>
                <th className="px-5 py-3 font-medium">Status</th>
                {canManage && <th className="px-5 py-3 font-medium sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id} className="border-b border-mist/60 last:border-0 align-top">
                  <td className="px-5 py-3">
                    <a
                      href={`/api/proxy/resources/${r.id}/file`}
                      className="font-medium text-brand hover:underline underline-offset-2"
                    >
                      {r.title}
                    </a>
                    <span className="block text-[11px] text-oat">
                      {r.filename} · {kb(r.sizeBytes)}
                    </span>
                    {r.description && (
                      <span className="block text-[12px] text-ink/70 mt-1">{r.description}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-oat">
                    {[r.className, r.levelName, r.subjectName].filter(Boolean).join(' · ') ||
                      'Whole school'}
                  </td>
                  <td className="px-5 py-3 tabular text-oat">{r.downloads}</td>
                  <td className="px-5 py-3">
                    <span className={r.published ? 'text-brand' : 'text-clay'}>
                      {r.published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-5 py-3">
                      <ResourceActions id={r.id} title={r.title} published={r.published} />
                    </td>
                  )}
                </tr>
              ))}
              {resources.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="px-5 py-10 text-center text-oat">
                    Nothing here yet. Upload a file to share it with a class.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
