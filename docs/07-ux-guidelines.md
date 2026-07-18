# 07 — UX & HCI Guidelines

The product must look professional and distinctive — a crafted tool schools are proud to show parents — and be operable by low-digital-literacy staff on mid-range Android phones over slow connections.

## 7.1 HCI principles we commit to

Grounded in established heuristics (Nielsen's 10, Fitts's law, progressive disclosure), applied to our users:

1. **Recognition over recall.** Bursars and teachers use the system in bursts (term start, report season). Navigation is labeled in their vocabulary — "Terminal Reports", "Fees", "Pickup" — never system jargon. No feature is reachable only by memory.
2. **Visibility of system status.** Every long operation (report generation, bulk invoicing, sync) shows progress and completes with a clear outcome. Offline/sync state is always visible but calm — a quiet indicator, not an alarm.
3. **Error prevention over error messages.** Bulk actions preview affected students before commit ("This will invoice 214 students in JHS 2 — review"). Destructive actions are reversible (ledger reversals, soft deletes) rather than confirmed-and-gone.
4. **Match the school's mental model.** The system mirrors paper artifacts staff already trust: the register, the broadsheet, the terminal report, the receipt book. Screens earn trust by resembling what they replace, then improving on it.
5. **Forgiving input.** Phone-first forms: numeric keypads for scores, fuzzy student search (names get misspelled), tolerant date entry, autosave everywhere (connections drop mid-form).
6. **Progressive disclosure.** Basic-tier screens are simple; advanced options unfold only when the entitlement exists and the user asks. Locked features appear as tasteful upgrade hints, not dead buttons — and never with internal jargon.
7. **Accessibility:** WCAG 2.1 AA targets — contrast, touch targets ≥ 44px, keyboard navigation on web, screen-reader labels; legible at arm's length in bright sunlight (gate scanner use case).
8. **Performance is UX.** Interactive < 3s on 3G for daily screens; skeleton loading; aggressive caching; PWA offline shell.

## 7.2 Visual identity (unique, not template)

- **Not another admin-template dashboard.** We design a proprietary design system — bespoke layout rhythms, purposeful color, and real data-density where power users need it (broadsheets, ledgers) — so the product doesn't read as AI-generated or off-the-shelf.
- **Typography:** premium pairing — a distinctive display face for headings + a highly-legible workhorse for data (licensed webfonts; fallback stack for offline installs). Numerals get tabular figures in ledgers and broadsheets.
- **Color:** a confident primary palette with warm accents; semantic colors reserved strictly for meaning (arrears = warning, cleared = success). Per-school branding (logo + accent color) on portals, receipts, reports, ID cards.
- **Iconography:** one coherent, licensed premium icon set used consistently; no mixed icon families; custom icons for domain objects (terminal report, SBA, MoMo, pickup card).
- **Report cards and receipts are print-first artifacts** — designed at print fidelity (A4/A5), pixel-faithful GES format plus a refined modern format, both looking excellent photocopied in black-and-white.
- Empty states, illustrations, and micro-interactions are custom and restrained — polish without noise.

## 7.3 Tooltips & in-app guidance

- **Contextual tooltips** on every non-obvious control (icon buttons always; domain terms like "SBA scaling" get a short explainer with a "learn more" link). Tooltips state what happens, not what the thing is called.
- **First-run guided tours** per role (bursar tour ≠ teacher tour), skippable, resumable, re-launchable from Help. Checklist-driven onboarding ("Set up your first term: structure → students → fees → invoices").
- **Inline user guide:** searchable help center embedded in-app, task-oriented articles ("How to generate terminal reports"), short screen-recordings for key flows; works offline in standalone installs.
- **Copy rules:** plain language, second person, no internal/system jargon, no change-log narration in the UI (users are never told where a feature _used to_ live — the UI simply makes its current home obvious). English first; localizable strings from day one.
- Season-aware nudges: at term end, the dashboard surfaces "Generate terminal reports" and "Send fee reminders before vacation" — the system anticipates the school calendar.

## 7.4 Key persona-critical flows to prototype first

1. **Bursar:** bulk-invoice a term → record a cash payment → reconcile a MoMo settlement → chase defaulters. (Desktop-density UI.)
2. **Teacher:** enter SBA + exam scores for 45 students on a phone, offline, in under 15 minutes (from Phase 3: → approve AI-drafted remarks).
3. **Gate staff:** verify a pickup in < 5 seconds with one hand, in sunlight, offline.
4. **Guardian:** check balance and pay on WhatsApp/MoMo in < 1 minute without installing anything.
5. **Head:** term dashboard → sign off reports → publish to guardians.

Each flow gets usability-tested with pilot-school staff before build-out hardens (Phase 1–2 checkpoints).
