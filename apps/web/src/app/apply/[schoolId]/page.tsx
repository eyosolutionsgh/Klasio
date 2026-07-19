import type { Metadata } from 'next';
import ApplyForm from '@/components/ApplyForm';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface PublicForm {
  school: { name: string };
  levels: { id: string; name: string }[];
}

export const metadata: Metadata = {
  title: 'Apply for admission',
};

async function load(schoolId: string): Promise<PublicForm | null> {
  // Read server-side, straight from the API, exactly as the public pay page does: the parent is
  // on a slow phone and the school's name should arrive with the first paint, not a round trip
  // later. The browser only needs the narrow /api/apply passthrough to POST the form.
  const res = await fetch(`${API_URL}/admissions/apply/${encodeURIComponent(schoolId)}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json();
}

/**
 * The public admissions form. No login, no cookie — this is a stranger arriving from a flyer,
 * a WhatsApp message or the school's own website.
 */
export default async function ApplyPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const data = await load(schoolId);

  // The API answers the same 404 for a school that does not exist, one whose package excludes
  // admissions, and a mistyped link — so this page must not guess which, and simply points the
  // parent back at the school.
  if (!data) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="card w-full max-w-md p-8 text-center relative overflow-hidden">
          <div className="kente-stripe h-1.5 absolute top-0 left-0 right-0" />
          <p className="font-display text-2xl mt-2">Applications are not open here</p>
          <p className="text-sm text-oat mt-3 leading-relaxed">
            This school is not taking applications online at the moment, or the link you followed
            is not quite right. Please call the school office and they will help you apply.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh flex items-start justify-center p-4 sm:p-6">
      <div className="card w-full max-w-md p-6 sm:p-8 my-4 relative overflow-hidden">
        <div className="kente-stripe h-1.5 absolute top-0 left-0 right-0" />
        <p className="text-[11px] uppercase tracking-widest text-oat mt-2">Apply for admission</p>
        <h1 className="font-display text-2xl mt-1">{data.school.name}</h1>
        <p className="text-sm text-oat mt-2 leading-relaxed">
          Fill in this form to apply for a place for your child. It takes about two minutes. The
          school will call you after they have looked at it.
        </p>

        <ApplyForm schoolId={schoolId} levels={data.levels} />
      </div>
    </main>
  );
}
