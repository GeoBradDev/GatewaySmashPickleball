---
name: Gateway Smash Pickleball
description: A volunteer-run indoor pickleball ladder league in St. Louis, presented like a well-kept clubhouse noticeboard.
colors:
  court-green: "#1a7a5c"
  court-green-dark: "#0f5e44"
  court-green-light: "#e8f5ef"
  amber: "#e8860c"
  amber-dark: "#96550a"
  amber-light: "#fef3e2"
  cream: "#faf7f2"
  white: "#ffffff"
  ink: "#1c1c1c"
  ink-soft: "#3d3d3d"
  ink-muted: "#6b6b6b"
  ink-faint: "#9a9a9a"
  border: "#e2ddd5"
  border-light: "#ece8e1"
typography:
  display:
    fontFamily: "'DM Serif Display', Georgia, 'Times New Roman', serif"
    fontSize: "3.75rem"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'DM Serif Display', Georgia, 'Times New Roman', serif"
    fontSize: "2.75rem"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'DM Serif Display', Georgia, 'Times New Roman', serif"
    fontSize: "1.3rem"
    fontWeight: 400
    lineHeight: 1.15
  body:
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  body-small:
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.65
  numeral:
    fontFamily: "'DM Serif Display', Georgia, 'Times New Roman', serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1
  lead:
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
    letterSpacing: "0.1em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "28px"
  pill: "50px"
spacing:
  container-pad: "24px"
  section-pad: "100px"
  header-height: "72px"
  container-max: "1120px"
  prose-max: "760px"
components:
  button-primary:
    backgroundColor: "{colors.court-green}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "14px 32px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.court-green-dark}"
    textColor: "{colors.white}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "14px 32px"
    height: "48px"
  button-ghost-hover:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
  section-tag:
    backgroundColor: "{colors.court-green-light}"
    textColor: "{colors.court-green}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
  hero-eyebrow:
    backgroundColor: "{colors.amber-light}"
    textColor: "{colors.amber-dark}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  ladder-panel:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.lg}"
    padding: "2.25rem 2.5rem"
  league-panel:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.lg}"
    padding: "2.5rem"
  season-callout:
    backgroundColor: "{colors.court-green-light}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
  prose-note:
    backgroundColor: "{colors.amber-light}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
  footer:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-faint}"
    padding: "2.5rem 0"
---

# Design System: Gateway Smash Pickleball

## Overview

**Creative North Star: "The Clubhouse Noticeboard"**

The site reads like the board by the front desk of a club that is run well: warm
paper, one confident green, a serif headline pinned at the top, and below it the
facts a player came for, set out plainly and kept current. The credibility comes
from being organized, not from looking expensive. A visitor comparing this league
with the corporate ones should come away thinking "these people have their act
together" and never "this is a sales funnel".

Density is relaxed on the homepage and closer to reading density on the inner
pages. Sections alternate cream and white like sheets on a board, each opening with
a small pill tag and a centred serif heading. Ornament is kept to near nothing:
three faint radial washes behind the hero, numerals and ruled lines where content
is a sequence or a listing, and a small lift on the buttons. Information such as the schedule table, the League Info list
and the callouts is where the care shows.

What it must never become: a corporate league's SaaS page (glossy gradients, stock
photos of smiling players, dark promo banners), an aggressive sports brand
(black-and-neon, italic condensed type, energy-drink intensity), or a generic
startup template (purple gradients, icon-card grids for everything, glass).

**Key Characteristics:**
- Warm cream paper, never stark white as the page ground.
- One accent, court green, carries every action and link.
- Amber is the reserved "act today" signal, not decoration.
- DM Serif Display headings over DM Sans text, both self-hosted.
- Soft, rounded, approachable forms: pill buttons and tags, 20px cards.
- Facts first: tables, labelled lists and callouts do the persuading.

## Colors

A warm, paper-and-felt palette: cream grounds, near-black ink, one court green and
a sparing amber.

### Primary
- **Court Green** (`court-green`): every primary button, link, section tag, icon
  tile, focus ring and the in-progress season status. It is the voice of the site.
- **Deep Court Green** (`court-green-dark`): hover state for buttons and links.
- **Court Wash** (`court-green-light`): tinted backgrounds for section tags, icon
  tiles, the season callout, table row hover and the current season's row.

### Secondary
- **Registration Amber** (`amber-dark`): text only, and only for what a visitor can
  act on today: the hero note on registration day, the "Registration open" status,
  and the hero eyebrow. It clears 4.5:1 on cream and white, which the build checks.
- **Amber Glow** (`amber-light`): the eyebrow pill and the `prose-note` background.
- **Signal Amber** (`amber`): used exactly once, as the 3px left border on the
  prose note. It is never text: at 2.44:1 on its own tint it fails every contrast
  bar.

### Neutral
- **Clubhouse Cream** (`cream`): the page ground, the header (at 92% opacity with
  blur), the ladder panel, and table headers.
- **Sheet White** (`white`): alternate section bands (About, Contact, inner pages)
  and the league panel, so the schedule sits on a clean sheet.
- **Scoreboard Ink** (`ink`): headings, strong labels and the footer background.
- **Soft Ink** (`ink-soft`): default body text.
- **Muted Ink** (`ink-muted`): leads, card copy, nav links and past seasons. 4.99:1
  on cream, which is close to the floor, so don't lighten it.
- **Faint Ink** (`ink-faint`): footer text on ink only. Never on cream.
- **Line** (`border`) and **Hairline** (`border-light`): the table frame and the
  ghost button outline; card outlines, row dividers and the header rule.

### Named Rules
**The One Voice Rule.** Court green is the only interactive colour. A link,
button or focus ring in any other hue is a bug.

**The Amber Means Today Rule.** Amber text marks what a visitor can act on today.
Adding it for emphasis or decoration spends the one signal that tells a player
registration is open.

**The 404 Copy Rule.** `404.html` carries its own copy of the palette, which must
match `:root` in `css/style.css` token for token. The build fails if they drift.

## Typography

**Display Font:** DM Serif Display (with Georgia, Times New Roman, serif)
**Body Font:** DM Sans, variable 400 to 700 (with the system UI stack)

**Character:** A bookish, slightly old-fashioned serif in a single regular weight,
paired with a clean geometric sans. The serif gives the noticeboard its headline,
and the sans keeps the facts easy to scan.

### Hierarchy
- **Display** (400, 3.75rem, 1.15, -0.02em): the homepage `h1` wordmark only,
  "People Over Profits. Pickleball For Everyone." Steps down to 2.5rem at 768px and
  2rem at 480px. Title case is reserved for this one slot.
- **Headline** (400, 2.75rem, 1.15, -0.01em): section `h2`s in the centred section
  header. 2.25rem at 900px. Inner page `h2`s use 1.6rem.
- **Title** (400, 1.3rem to 1.5rem): card and panel `h3`s (features 1.3rem, contact
  1.15rem, league panel 1.5rem).
- **Body** (400, 16px, 1.65): `ink-soft` on cream or white. Prose pages cap the
  measure at 760px. The hero description is the pitch sentence alone, centred at 560px and
  balanced, with the decision facts under it as a centred list (0.95rem/600 ink,
  each item led by a 6px court-green dot so a wrapped row never starts with a
  separator); the About lead is
  left-aligned at 30em, about 70 characters. Measures are set in `em`, not `ch`:
  a `ch` is the width of "0", and DM Sans averages about 0.42em a character, so
  64ch ran about 100. Body copy wraps with `text-wrap: pretty` and headings with
  `balance`, so no heading carries a hand-placed `<br>`.
- **Body small** (400, 0.95rem, 1.65): card, note, list and callout copy, the
  ladder steps, League Info rows and Contact values. 0.9rem is its compact step
  for table cells and the hero note.
- **Numeral** (DM Serif 400, 2rem, 1): the court-green step numbers in the ladder
  panel, and only where content is a real sequence.
- **Lead** (400, 1.1rem to 1.15rem, 1.7 to 1.75): the hero description and section
  leads, in `ink-muted`.
- **Label** (700, 0.8rem, 0.1em tracking, uppercase): section tags and table
  headers (600, 0.8rem, 0.04em). The hero eyebrow is the same family at 600,
  0.85rem, 0.06em.

### Named Rules
**The One Weight Serif Rule.** DM Serif Display ships at weight 400 only. Never
bold it: the browser will fake a bold that no font file backs.

**The Sentence Case Rule.** Every heading, button and table label is in sentence
case ("Learn more", "Registration opens"). The one exception is the homepage `h1`,
"People Over Profits. Pickleball For Everyone.", which is a wordmark and stays in
title case by the owner's decision.

## Layout

A single centred column with a 1120px container (`container-max`) and 24px side
padding, reduced to 16px at 480px. Prose pages narrow to 760px (`prose-max`).
Sections stack vertically with `section-pad` (100px, then 72px at 900px and 56px at
480px) and alternate cream and white backgrounds. The fixed header is
`header-height` (72px, 60px at 480px), and both the page offset and the mobile nav
panel read that token, so it has to stay the single source.

About is an unequal two-column grid (the ladder panel at about 1.35fr beside two
ruled notes), Contact is a three-column listing capped at 880px, and League Info is
two labelled groups side by side. All three collapse to one column at 900px. League
Info rows are a fixed label column (7.5rem) beside the value, so wrapped values never
knock rules out of line.
At 900px the schedule table turns into a stack of compact entries (see the
schedule table under Components), before the nav collapses at 768px. The nav becomes a drawer behind a hamburger toggle.

Section headers are centred. Body copy on inner pages is left-aligned.

## Elevation & Depth

Mostly flat, with soft ambient shadows used sparingly. Depth comes first from
tone (cream against white bands, tinted tags and callouts) and from hairline borders. Shadows
appear in three places: under the primary button as a faint green glow, around the
league panel to lift the schedule off the cream band, and the header once the page
has scrolled. Cards do not lift on hover: no card on the homepage is a link.

### Shadow Vocabulary
- **Hairline lift** (`box-shadow: 0 1px 3px rgba(28, 28, 28, 0.06)`): the header
  once the page has scrolled.
- **Card rest** (`box-shadow: 0 2px 8px rgba(28, 28, 28, 0.06), 0 0 0 1px rgba(28, 28, 28, 0.03)`):
  the league panel at rest.
- **Green glow** (`box-shadow: 0 4px 14px rgba(26, 122, 92, 0.3)`, 0.35 on hover):
  the primary button only.

### Named Rules
**The Pinned Paper Rule.** Surfaces rest flat. Shadows are for the one panel that
holds the schedule and for the primary button, never for decoration or for a hover
on something that is not clickable.

## Shapes

Soft and rounded throughout. Anything a visitor presses or reads as a label is a
full pill (50px): buttons, section tags, the eyebrow. Containers use a 20px radius
(`rounded.lg`), inner frames such as the table wrapper use 12px
(`rounded.md`), and callouts use 8px (`rounded.sm`) with a 3px left rule in green or
amber. Rules are square: the 1px hairlines and the 2px ink rules that head League
Info groups and Contact entries.

## Components

### Buttons
Soft and approachable: pills that lift a pixel when hovered.
- **Shape:** full pill (50px), 48px minimum height, 2px border.
- **Primary:** court green fill, white text, DM Sans 600 at 0.95rem, 14px 32px
  padding, green glow shadow.
- **Hover:** deep court green, a 1px rise, a slightly stronger glow. 0.25s ease.
- **Ghost:** transparent with a `border` outline and ink text. On hover the outline
  darkens to soft ink and the fill turns white.
- **Focus:** the global 2px court green outline at a 3px offset.
- On inner pages under 768px, action buttons go full width.

### Tags and eyebrow
- **Section tag:** a court-wash pill with green uppercase label text, sitting above
  every section heading.
- **Hero eyebrow:** the same pill in amber (`amber-light` ground, `amber-dark`
  text), naming when and where the league plays.

### Cards / Containers
- **Ladder panel:** cream on a white band, a hairline border, 20px radius,
  2.25rem 2.5rem padding. It holds "How the ladder works" as a numbered list: DM
  Serif court-green numerals (2rem) beside a bold ink label and a muted sentence,
  steps divided by `border` hairlines. Only content that is a real sequence gets
  numbers.
- **About note:** no container. A hairline top rule, a serif `h3`, and muted
  0.95rem copy. Two of them stack beside the ladder panel.
- **Contact listing:** no container. Each entry is a 2px ink top rule, a serif
  `h3` and its value, left-aligned, three across.
- **League panel:** white on the cream band, a hairline border, 20px radius, 2.5rem
  padding, and the card-rest shadow. It holds the schedule, League Info and the sub
  CTA, separated by `h3`s.

### Schedule table (signature component)
The heart of the noticeboard. A 12px-radius frame with a `border` outline, cream
uppercase header cells, hairline row dividers and 0.9rem cells. The current
season's row is tinted court wash. Past rows go to muted ink. The season a
visitor can join next sits on cream with its name and status in ink, and before
its window opens its status reads "Registration Dec 10" rather than Upcoming. The
status column is written by the bundle: green for in progress, amber for
registration open, muted for the rest. At 900px and below each row becomes a compact entry: the season
name with its status at top right, the dates under it, then registration and bye
as small labelled lines. A completed season drops those two lines and sits on the
panel rather than on cream, so the seasons still ahead read first. The next
season is outlined in court green instead of tinted, since every entry is already
cream.

### Closing band
The page's one return to full volume after the hero. It continues the schedule's
cream with no rule or card, and puts the display face at 3.25rem (2.25rem at
768px, 1.85rem at 480px) over a 600-weight `ink-soft` registration sentence and
the same primary and ghost buttons as the hero. No eyebrow. Its copy is derived
from the schedule, and its note turns amber only on registration day.

### Callouts
- **Season callout:** court wash, a 3px green left rule, 8px radius, 0.95rem/500
  ink text. It sits above the table and states the season in play.
- **Prose note:** the amber version for inner-page asides.

### Links
Court green and underlined by default with a 3px offset. Prose contexts tint the
underline to `rgba(26, 122, 92, 0.3)` and bring it to full green on hover. Only
named exceptions (buttons, nav, logo) drop the underline, and the build enforces
that list.

### Navigation
- **Desktop:** a fixed, translucent cream header with a 12px blur and a hairline
  bottom rule. The logo mark is green with the DM Serif wordmark in ink, and nav
  links are DM Sans 500 at 0.9rem in muted ink, with a 2px green underline that
  grows from the left on hover.
- **Mobile:** a 44px hamburger whose bars animate to an X, opening a drawer below
  the header. It works without JavaScript through a native popover.

### Footer
Ink background with faint ink text at 0.85rem, centred. Footer links are cream and
underlined.

## Do's and Don'ts

### Do:
- **Do** ground every page in cream (`cream`) and alternate white bands for
  section rhythm.
- **Do** open each section with a pill tag and a centred DM Serif heading.
- **Do** keep court green as the only colour for links, buttons and focus.
- **Do** reserve amber text (`amber-dark`) for what a visitor can act on today.
- **Do** keep text at 4.5:1 or better. The build computes the contrast of the key
  pairs, so a new pairing needs a check too.
- **Do** keep every link underlined unless it is a button or nav item, and add any
  new exception to the named list.
- **Do** keep all assets self-hosted and the styles in the hashed stylesheet. The
  CSP forbids inline styles and third-party hosts.
- **Do** honour `prefers-reduced-motion`: transitions and animations become
  instant, and smooth scrolling turns off.

### Don't:
- **Don't** use glossy gradients, stock photography, or dark promo banners. That is
  the corporate-league look this site exists to contrast with.
- **Don't** use black-and-neon palettes, italic condensed type or high-energy sports
  styling.
- **Don't** use purple gradients, glassmorphism, or icon-card grids as a default
  layout move.
- **Don't** add photos, testimonials or quotes the league does not have.
- **Don't** bold DM Serif Display or add a second display face.
- **Don't** use `amber` (#e8860c) for text, or `ink-faint` on cream.
- **Don't** add sharp corners or hard drop shadows. Forms stay soft and rounded.
