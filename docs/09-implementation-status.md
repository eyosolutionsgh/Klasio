# 09 — Implementation Status

Audited against [08-user-types-and-user-stories.md](08-user-types-and-user-stories.md) on
21 Jul 2026, then closed. The original audit found 63 stories implemented, 13 partial, 10 missing
and 2 skipped by decision; everything it named has since been built on
`feat/audit-gap-completion`. This document is now the record of what was found, what was done, and
what is deliberately still absent.

**Verification:** 721 unit tests, 127 integration tests against live PostgreSQL as the non-owner
`eyo_app` role, `pnpm lint` and `pnpm typecheck` clean across four workspaces, migration chain
drift-free, plus a browser pass over every new screen.

---

## Defects the audit found in features believed shipped

| Defect | Where | Resolution |
|---|---|---|
| **A clerk could confirm their own bank deposit** | `fees.module.ts` | `submittedById` was recorded but never compared to the reviewer, so anyone holding both permissions could claim a deposit and post it to the ledger. Guarded on confirm **and** reject — quietly rejecting your own entry hides a payment as well as confirming a fictitious one. Mutation-verified: removing the guard fails exactly the two separation tests. |
| **Republish consent was unreachable** | `ReportActions.tsx` | The API had refused regeneration over published reports without an explicit flag since the guard was added, and no caller could send it — a head correcting a marking error could only ever read the refusal. Now a counted confirmation naming how many families read the original. |
| **No SMS on morning drop-off** | `pickup.module.ts` | Release texted; arrival wrote a log row and said nothing. Both ends now share one path, so BLOCKED custody is excluded from the morning text too. |
| **Video/audio not licence-gated** | `resources.module.ts` | The gated, streaming build existed only on an unmerged branch; `main` had ungated 200MB buffered uploads. Branch merged. |
| **Targeted notices reached the whole school** | `broadcasts.module.ts` | Found while exposing the picked-list audience: the notice-board post carried only *which portal*, never *who for*, so every class- or level-targeted broadcast was also posted to every family's board. Announcements now carry the scope and both portals filter on it. |
| **The integration suite sent real SMS** | `vitest.integration.config.ts` | vitest loads `.env` into `process.env`, so every spec touching an absence alert, fee reminder or gate notification fired live texts through the school's Nalo account at the seed's invented numbers. Credentials blanked, as the payment credentials already were. |

## Features the audit found missing, and what was built

| Gap | Built |
|---|---|
| **Fee clearance on report release** | `School.reportsRequireFeeClearance` (off by default) plus a per-child `FeeClearance` override with a required reason. Enforced at all three doors onto the same document — family portal, pupil portal, WhatsApp — and on the PDF as well as the list, since an unrendered link is not a gate. Held reports are listed and explained rather than hidden; withheld marks are absent rather than zeroed. |
| **Term and year close lifecycle** | `closedAt` on `Term` and `AcademicYear`, with close/reopen operations behind `school.close_term`. A closed term refuses attendance, scores and report generation. Money and publishing deliberately stay open. The pre-close checklist informs rather than gates. Reopening demands a reason. |
| **Per-child promotion** | A reviewed run seeded with the server's suggestion, so promoting a class stays one click and only exceptions cost anything. `PromotionRecord` makes a repeated year a fact the cumulative record can state. Graduation carries its count on the request. |
| **WhatsApp report-card delivery** | Provider `sendDocument`, uploading to Meta's media endpoint rather than linking — the only URL serving a report card sits behind the family's own session. Forced the report-card builder out of its two near-identical copies into one. |
| **Mock exam series** | `MockSeries`/`MockResult` hanging off the academic year, scored by the same four-cores-plus-best-two function the outlook screen uses. Comparison reports improvement as improvement, since a BECE aggregate falls as a candidate improves. |
| **Leaver documents** | Transfer letters and testimonials on the school's letterhead, stating only what the record already holds. |
| **Regulator surface** | WAEC candidate registration (flagging names nobody checked against a birth certificate), WAEC SBA export, CSSPS choice capture and selection sheet (counting how many of the eight are recorded), EMIS census, and a dedicated admission register. `certificateName` on students; `ntcNumber`/`qualification` on staff. |
| **The six paper registers** | Log book, duty roster, lesson-note vetting, discipline book, visitors book, and daily feeding money — with the rules that make each worth keeping enforced, not implied. |
| **Smaller items** | Conduct, discipline and medical history on the cumulative record; a `vetted` state between generating and publishing; printable financial summaries; outbound webhooks signed with HMAC over the exact bytes. |

## Still deliberately absent

⛔ **Skipped by prior decision** — do not build without revisiting: USSD flows, live GPS vehicle
tracking, native mobile apps, full LMS, canteen wallets, hostel/boarding.

**Not built, and honestly still open:**

- **Streams as a first-class concept.** Streams remain free-text class names ("Basic 6 Gold"). The
  promotion suggester reads the trailing word to keep a child in their stream, which is enough for
  what the product does with them today.
- **A purpose-built exam-timetable builder.** Exam dates are published as audience-scoped calendar
  events. An exams officer is served; a subject × date × room grid is not modelled.
- **An alumni records-request workflow.** Export works for a graduated student, which is what the
  requests actually need; there is no ticket to track one.

---

## Notes for whoever audits this next

Two things the first audit got wrong, both worth remembering:

1. It reported the cumulative record as missing entirely when it existed and was academic-only, and
   reported a stubbed 422 fixture in the email spec as a live API call. **An audit finding is a
   hypothesis until the code is read.** Every finding here was re-checked before being acted on,
   and one ("unit tests hit MailerSend") was withdrawn.
2. Six of the ten new tables are tenant-owned, and each needed **both** an RLS policy and a grant.
   The missing policy is the one that fails open and silently, so every new table's spec includes
   a negative test that reads it as another school.
