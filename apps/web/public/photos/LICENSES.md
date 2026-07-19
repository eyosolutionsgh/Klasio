# Photography

Every image in this directory is committed to the repository on purpose. A school's login page
must render on a LAN box with no internet, so nothing here may be fetched from a CDN at runtime.

## The selection rule

Read this before adding or replacing anything.

**No identifiable children.** A licence covers copyright; it does **not** carry a model release,
and most photographs of school life are photographs of children. Prefer buildings, courtyards,
empty classrooms, wide shots and distant figures. Reject close-ups of faces however permissively
they are licensed.

There is a product reason as well as an ethical one: these images sit on _a particular school's_
sign-in page. A parent at Achimota seeing a stock photograph of children would reasonably assume
they are Achimota's children. They are not, and implying otherwise misrepresents the school to the
families it serves. Architecture carries the same warmth and claims nothing false.

Several excellent, correctly-licensed photographs were rejected on exactly this basis while these
were chosen — including a public-domain USAID classroom shot that was the best-composed candidate
by some distance.

**CC0 and public domain only.** Not a legal necessity — CC BY would be manageable — but resizing
and re-encoding creates an adapted work, and under CC BY-SA that adaptation inherits share-alike.
A proprietary product should not have to reason about which of its assets carry that obligation.
If you add a CC BY image, record the attribution requirement here and honour it on the page.

**Art direction.** West African, Ghana-first. Hard natural light, ochre and dust, painted block
walls, corrugated roofing. Avoid the two stock failure modes: Western classrooms with radiators
and carpets, and aid photography — visible NGO signage, Western visitors, saturated poverty.

## Files

Sizes are 800w and 1400w. The art panel renders around 530 CSS pixels wide and is hidden below
`lg`, so 1400 already covers a retina display; anything larger is bytes no screen shows. Encoded
hard on purpose — every one of these sits behind a 65% scrim in `AuthShell`, where compression
artefacts are invisible.

### `auth/schoolyard-{800,1400}.webp`

- **Source:** https://commons.wikimedia.org/wiki/File:Bright_Junior_High_School.jpg
- **Photographer:** Wikimedia Commons user "Iphone thirteen"
- **Licence:** CC0 1.0 (Public Domain Dedication) — no attribution required
- **Date:** 25 May 2024
- **Subject:** Bright Junior High School, Boi community, Jirapa District, Upper West Region, Ghana
- **Changes:** resized, converted to WebP (q42)
- **Fetched:** 19 July 2026

Used on the staff sign-in, setup and public admissions pages.

### `auth/courtyard-{800,1400}.webp`

- **Source:** https://commons.wikimedia.org/wiki/File:A_Classroom_Block_in_Tamale.jpg
- **Photographer:** Wikimedia Commons user "KBimam 1997"
- **Licence:** CC0 1.0 (Public Domain Dedication) — no attribution required
- **Date:** 25 November 2023
- **Subject:** Classroom block courtyard, Savannah International Academy, Tamale, Ghana
- **Changes:** resized, converted to WebP (q70)
- **Fetched:** 19 July 2026

Used on the guardian, student and password pages.

## Replacing these

A school's own photographs are better than any stock library — they are true, and they are of that
school. Drop replacements in at the same filenames and sizes and nothing else needs to change. If
you do, the consent question becomes the school's own to answer, which is where it belongs.
