'use client';

import { useEffect, useState } from 'react';
import Combobox from '@/components/Combobox';
import FileField from '@/components/FileField';
import { Button, useAsyncAction } from '@/components/Button';
import { SaveIcon, UploadIcon } from '@/components/icons';

interface Suggestion {
  readName: string | null;
  readAdmissionNo: string | null;
  score: number;
  studentId: string | null;
  matchedName: string | null;
}
interface Options {
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
}
interface Component {
  id: string;
  name: string;
  maxScore: number;
  subjectId: string | null;
}

/**
 * §21's script capture: photograph a marked list, the model reads (name, score) pairs, and a
 * PERSON reviews every row — the matched child is shown, unmatched rows say so, scores stay
 * editable — before anything is saved through the same endpoint hand-entry uses.
 */
export default function ScriptCapturePage() {
  const [options, setOptions] = useState<Options | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [componentId, setComponentId] = useState('');
  const [termId, setTermId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/proxy/timetable/options')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setOptions({ classes: d.classes, subjects: d.subjects }));
    fetch('/api/proxy/me')
      .then((r) => r.json())
      .then((me) => setTermId(me.currentTerm?.id ?? ''));
  }, []);

  useEffect(() => {
    fetch('/api/proxy/assessment/components')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setComponents(Array.isArray(d) ? d : []));
  }, []);

  const read = useAsyncAction(async () => {
    if (!file) return;
    setNote(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/proxy/ai/script-capture', { method: 'POST', body: form });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(d.message ?? 'AI is not available on this server.');
      throw new Error('rejected');
    }
    setRows(d.suggestions);
    if (d.suggestions.length === 0) setNote('Nothing legible was found in that photo.');
  });

  const save = useAsyncAction(async () => {
    const entries = rows
      .filter((r) => r.studentId !== null)
      .map((r) => ({ studentId: r.studentId!, componentId, rawScore: r.score }));
    if (entries.length === 0) {
      setNote('Nothing to save — no rows are matched to a child.');
      throw new Error('nothing');
    }
    const res = await fetch('/api/proxy/assessment/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termId, subjectId, classId, entries }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(d.message ?? 'Could not save.');
      throw new Error('rejected');
    }
    setNote(`${entries.length} score${entries.length === 1 ? '' : 's'} saved to the gradebook.`);
    setRows([]);
    setFile(null);
  });

  const ready = classId && subjectId && componentId && termId;

  return (
    <div>
      <div className="rise rise-1">
        <a href="/marks" className="text-[13px] text-oat hover:text-brand transition">
          ← Back to marks entry
        </a>
        <h1 className="font-display text-3xl mt-3">Read marks from a photo</h1>
        <p className="text-sm text-oat mt-1.5">
          Photograph the marked list; the reading is a suggestion, and every row is yours to check
          before it is saved.
        </p>
      </div>

      <section className="card p-6 mt-6 rise rise-2">
        <div className="flex flex-wrap gap-3">
          <Combobox
            label="Class"
            className="w-44"
            allowClear={false}
            placeholder="Class…"
            options={(options?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={classId}
            onChange={setClassId}
          />
          <Combobox
            label="Subject"
            className="w-44"
            allowClear={false}
            placeholder="Subject…"
            options={(options?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))}
            value={subjectId}
            onChange={setSubjectId}
          />
          <Combobox
            label="Assessment"
            className="w-52"
            allowClear={false}
            placeholder="Which assessment…"
            options={components
              .filter((c) => !c.subjectId || c.subjectId === subjectId)
              .map((c) => ({
                value: c.id,
                label: c.name,
                hint: `out of ${c.maxScore}`,
              }))}
            value={componentId}
            onChange={setComponentId}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <FileField
            id="script-photo"
            accept="image/jpeg,image/png,image/webp"
            hint="JPEG, PNG or WebP — good light, straight on."
            value={file}
            onChange={setFile}
          />
          <Button
            onClick={read.run}
            state={read.state}
            disabled={!file || !ready}
            icon={<UploadIcon />}
            pendingLabel="Reading…"
            doneLabel="Read!"
            failedLabel="Couldn't read"
          >
            Read the photo
          </Button>
        </div>
        {note && <p className="text-sm text-oat mt-3">{note}</p>}
      </section>

      {rows.length > 0 && (
        <section className="card p-6 mt-6 rise rise-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl">Check every row</h2>
            <Button
              onClick={save.run}
              state={save.state}
              icon={<SaveIcon />}
              pendingLabel="Saving…"
              doneLabel="Saved!"
              failedLabel="Couldn't save"
            >
              Save matched scores
            </Button>
          </div>
          <ul className="mt-4 space-y-2">
            {rows.map((r, i) => (
              <li
                key={i}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  r.studentId ? 'border-mist' : 'border-clay/40 bg-clay/5'
                }`}
              >
                <div className="text-sm">
                  <span className="font-medium">{r.matchedName ?? r.readName ?? 'Unreadable'}</span>
                  <span className="block text-[11px] text-oat">
                    read as “{r.readName ?? '—'}
                    {r.readAdmissionNo ? ` · ${r.readAdmissionNo}` : ''}”
                    {!r.studentId && ' — no matching child; will not be saved'}
                  </span>
                </div>
                <input
                  type="number"
                  value={r.score}
                  onChange={(e) =>
                    setRows(
                      rows.map((x, j) => (j === i ? { ...x, score: Number(e.target.value) } : x)),
                    )
                  }
                  className="w-20 min-h-11 rounded-lg border border-mist bg-white px-2 py-2 text-sm tabular outline-none focus:border-brand"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
