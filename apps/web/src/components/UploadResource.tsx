'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import FileField from './FileField';

const field =
  'w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

const ACCEPT = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
].join(',');

/**
 * Share a file with a class. It lands as a draft — publishing is a separate, deliberate step,
 * so a wrong file can be replaced before any parent sees it.
 */
export default function UploadResource({
  levels,
  classes,
  subjects,
}: {
  levels: { id: string; name: string }[];
  classes: { id: string; name: string; level: string }[];
  subjects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [levelId, setLevelId] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title);
    if (description) fd.append('description', description);
    if (levelId) fd.append('levelId', levelId);
    if (classId) fd.append('classId', classId);
    if (subjectId) fd.append('subjectId', subjectId);
    const res = await fetch('/api/proxy/resources', { method: 'POST', body: fd });
    setBusy(false);
    if (res.ok) {
      setTitle('');
      setDescription('');
      setClassId('');
      setSubjectId('');
      setLevelId('');
      setFile(null);
      router.refresh();
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.message ?? 'Could not upload the file.');
    }
  }

  return (
    <form onSubmit={submit} className="card p-6 h-fit rise rise-2">
      <h2 className="font-display text-xl">Share a file</h2>

      <label className="block text-sm font-medium mt-5 mb-1.5" htmlFor="res-title">
        Title
      </label>
      <input
        id="res-title"
        required
        minLength={3}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Week 4 fractions worksheet"
        className={field}
      />

      <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="res-file">
        File
      </label>
      <FileField
        id="res-file"
        accept={ACCEPT}
        value={file}
        onChange={setFile}
        disabled={busy}
        hint="PDF, Word, PowerPoint, Excel, text or an image, up to 8MB."
      />

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="res-level">
            Level
          </label>
          <select
            id="res-level"
            value={levelId}
            onChange={(e) => setLevelId(e.target.value)}
            className={field}
          >
            <option value="">Whole school</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="res-class">
            Class
          </label>
          <select
            id="res-class"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className={field}
          >
            <option value="">Every class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="res-subject">
        Subject <span className="text-oat font-normal">(optional)</span>
      </label>
      <select
        id="res-subject"
        value={subjectId}
        onChange={(e) => setSubjectId(e.target.value)}
        className={field}
      >
        <option value="">No subject</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <label className="block text-sm font-medium mt-4 mb-1.5" htmlFor="res-desc">
        Description <span className="text-oat font-normal">(optional)</span>
      </label>
      <textarea
        id="res-desc"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What is this, and what should the class do with it?"
        className={`${field} resize-y`}
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-5 rounded-lg bg-brand text-paper text-sm font-medium px-5 py-2.5 hover:bg-brand-deep transition disabled:opacity-60"
      >
        {busy ? 'Uploading…' : 'Upload as draft'}
      </button>
    </form>
  );
}
