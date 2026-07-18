# EYO School Management System — Planning Documentation

Planning docs for an AI-powered school management system for private schools in Ghana and other African countries, covering pre-school (creche/nursery/KG) through high school (SHS).

The system ships two ways from one codebase:

- **SaaS** — multi-tenant cloud subscription (Free/Basic, Medium, Advanced packages).
- **Standalone** — deployed for a single school (online or fully offline on a school LAN), with the package tier locked by a vendor-signed license that only the vendor can change.

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
7. **One codebase, license-gated tiers.** SaaS subscriptions and standalone installs share code; entitlements decide what's on, and only the vendor can change them.
8. **No LMS (yet).** Full LMS is deferred; the only learning feature at launch is school-published documents/resources students can access from home.
