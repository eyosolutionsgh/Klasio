# EYO School Management System — Planning Documentation

Planning docs for an AI-powered school management system for private schools in Ghana and other African countries, covering pre-school (creche/nursery/KG) through high school (SHS).

**One school, one server.** Every school runs its own deployment — a cloud VM it controls, or a
mini-PC in the school office, online or fully offline on the school LAN. The package tier comes
from a vendor-signed licence file the school installs, verified locally with no call home, and
only the vendor can mint one.

> **Note (July 2026).** The product was previously multi-tenant SaaS plus a standalone variant.
> The hosted estate, the vendor console and subscription billing were removed; see
> `03-architecture.md` §3.1 and §3.5, which are current. Sections of `01-market-research.md` and
> `05-roadmap.md` still describe the SaaS commercial model and have not been rewritten — treat the
> architecture doc as authoritative where they disagree.

## Document index

| Doc                                                        | Contents                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [01-market-research.md](01-market-research.md)             | Competitive landscape — global leaders, African/Ghanaian players, gaps we exploit     |
| [02-feature-catalog.md](02-feature-catalog.md)             | Full feature catalog mapped to Basic / Medium / Advanced packages                     |
| [03-architecture.md](03-architecture.md)                   | System architecture — multi-tenancy, offline sync, standalone licensing, integrations |
| [04-tech-stack.md](04-tech-stack.md)                       | Recommended technology stack and rationale                                            |
| [05-roadmap.md](05-roadmap.md)                             | Phased development roadmap and milestones                                             |
| [06-engineering-practices.md](06-engineering-practices.md) | Tooling: husky, CI/CD, migrations discipline, testing, monitoring                     |
| [07-ux-guidelines.md](07-ux-guidelines.md)                 | HCI best practices, design language, tooltips and in-app guidance                     |

## Product principles

1. **Fees first.** Fee collection is the #1 reason African private schools buy software. Billing, payments and reconciliation must be flawless before anything else matters.
2. **Terminal reports are the emotional product.** GES-format report cards (scores, positions, remarks, "Next Term Begins") must be pixel-faithful and effortless.
3. **Safety is a moat.** Pickup/drop-off security is under-served in the region and is a strong emotional sell to parents of young children.
4. **Meet parents where they are.** WhatsApp and SMS, not email. Feature-phone parents matter (USSD, SMS, printed QR/PIN cards).
5. **AI as a differentiator, not a gimmick.** AI writes report remarks, reads marked scripts, predicts fee defaults, and answers guardian questions — tasks that save real hours.
6. **Offline is a feature, not an afterthought.** Schools with poor connectivity get the same product, synced when the network returns.
7. **Licence-gated tiers.** Entitlements decide what is on, and only the vendor can change them — a signed file the school installs, not a switch we flip remotely.
8. **No LMS (yet).** Full LMS is deferred; the only learning feature at launch is school-published documents/resources students can access from home.
