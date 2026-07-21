'use client';

import { useCallback, useEffect, useState } from 'react';
import { TemplateEditor, type Template } from './ReminderSettings';

/**
 * The wording of the non-fee automatic texts — absence alerts, results notifications, pickup
 * confirmations. The school writes every word that goes out under its name (FEATURES.md §11);
 * fee reminder wording lives with the reminder schedule on the fees settings page.
 */
export default function AutoMessages() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/proxy/fees/reminders/templates');
    if (!res.ok) return;
    const list: Template[] = ((await res.json()) as Template[]).filter(
      (t) => !t.kind.startsWith('FEE_'),
    );
    setTemplates(list);
    setDrafts(Object.fromEntries(list.map((x) => [x.kind, x.body])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (templates.length === 0) return null;

  return (
    <section className="card p-6 rise rise-3">
      <h2 className="font-display text-xl">Automatic messages</h2>
      <p className="text-sm text-oat mt-1.5">
        These go out under your school&apos;s name without anyone pressing send — so the words are
        yours to choose. Fee reminder wording is on the fees settings page, with its schedule.
      </p>
      <div className="mt-5 space-y-5">
        {templates.map((t) => (
          <TemplateEditor
            key={t.kind}
            template={t}
            draft={drafts[t.kind] ?? ''}
            onDraftChange={(next) => setDrafts({ ...drafts, [t.kind]: next })}
            onSaved={load}
          />
        ))}
      </div>
    </section>
  );
}
