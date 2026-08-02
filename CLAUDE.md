# Gateway Smash Pickleball

This file provides architectural context for AI assistants working on this codebase. For human contributor setup, build commands, and general site overview, see the authoritative [README.md](README.md).

## Project Structure

- `index.html` - The main homepage containing the copy, schedule, and layout.
- `faq/index.html` - The FAQ, served at `/faq/`. A directory rather than `faq.html` so the clean URL works on any static host without a rewrite rule.
- `subs/index.html` - Substitute player page, served at `/subs/`.
- `code-of-conduct/index.html` - Conduct policy, served at `/code-of-conduct/`. Linked from the footer rather than the nav.
- `404.html` - Error page for broken links.
- `css/style.css` - Custom styles and layout rules.
- `js/app.js` - Main JavaScript logic (implements mobile nav toggle, outside-click and Escape dismissal, `inert` sync and focus trap for the mobile drawer, scroll-driven header shadow, the date-derived league schedule status described under Pages, and the footer year). Also imports the stylesheet, which is how CSS enters the build.
- `fonts/` - Self-hosted DM Sans and DM Serif Display woff2, plus the OFL 1.1 licence text each family requires when redistributed. Not in `public/`, deliberately: the `@font-face` rules in `css/style.css` reference them with relative `url()` paths so Vite content-hashes them.
- `partials/` - Shared `header.html` and `footer.html`, pulled into pages with `{{> header}}` via vite-plugin-handlebars. `404.html` deliberately does not use them, which is why it carries no code of conduct link.
- `public/` - Copied to `dist/` verbatim by Vite. Holds `img/`, `favicon.ico`, `site.webmanifest`, and `robots.txt`. Anything here ships at the same path it has in `public/`.
- `LICENSE.txt` - Project license.
- `vite.config.js` - Build configuration. Declares `index.html`, `faq/index.html`, `subs/index.html`, `code-of-conduct/index.html` and `404.html` as entry points. A new page needs an entry here, a line in `public/sitemap.xml`, an entry in the `PAGES` array in `scripts/check-links.js`, and a link from somewhere: the nav in `partials/header.html` for a page people navigate to, the footer for one they do not. It does **not** need adding to the html-validate command or to the per-page smoke checks; both walk `dist/`.
- `scripts/smoke-build.js` - Dependency-free assertions against `dist/` after a build. Run via `npm run smoke`.
- `scripts/check-links.js` - Dependency-free outbound link check. Not part of `npm test`; see below.
- `eslint.config.js`, `.htmlvalidate.json` - Lint configuration. Run via `npm run lint`.
- `.github/workflows/ci.yml` - CI check. Runs `npm ci` and `npm test` on pull requests to `main` and on pushes to `main`. It does not deploy.
- `.github/workflows/links.yml` - Weekly outbound link check, kept out of CI on purpose.

## Build

Vite. One config, `vite.config.js`, and one devDependency.

Asset paths in `dist/` are content-hashed, so **never hardcode a built filename**.
`css/style.css` becomes something like `assets/main-tEWbBYpj.css` and the hash changes
whenever the file does. That is the point: it is what makes cache busting work. Anything
that needs the built name must read it out of `dist/index.html`, which is what
`scripts/smoke-build.js` does.

How each kind of asset reaches `dist/`:

| Source | Route | Result |
| --- | --- | --- |
| `css/style.css` | imported by `js/app.js` | hashed, minified, `<link>` injected by Vite |
| `js/app.js` | `<script type="module">` in `index.html` | hashed, minified, `src` rewritten in place |
| `fonts/*.woff2` | relative `url()` in `css/style.css` | hashed into `assets/`, `url()` rewritten |
| `partials/*.html` | `{{> name}}` in a page | inlined at build time |
| `public/**` | verbatim copy | same path, unchanged bytes |

The page makes **no third-party requests**. Fonts were on `fonts.googleapis.com`,
which meant a render-blocking stylesheet on another origin before the font URLs were
even known. `npm run smoke` fails if any third-party subresource reappears.

`index.html` deliberately has **no** hardcoded stylesheet link. Adding one back would
ship the unhashed, unminified copy alongside the hashed one.

## Checks

`npm test` is `npm run lint` then `npm run smoke`, and is what CI runs.

Assert against **built output**, not source. A green build is not evidence the site
works: issue #1 compiled cleanly and shipped a page that loaded `app.js` twice. When
adding a check, add it to `scripts/smoke-build.js`, which stays dependency-free, and
**negative-test it** by breaking the thing it guards. A check that cannot fail is
worse than no check, because it reads as coverage.

Prefer `scripts/smoke-build.js` over reaching for a new linter. html-validate is
there for structural HTML errors, but it does not know that a `type="image/svg+xml"`
on a `.png` is wrong, because that markup is structurally valid. Semantic checks like
that belong in the smoke script.

**Read attribute values with `metaContent()`, never with a `[^"']*` class.** That
class excludes both quote characters, so it stops dead at the first apostrophe inside
a double-quoted value. #54 put "St. Louis'" into the three description tags and the
"three description tags agree" check silently became a comparison of their first 33
characters: all three truncated to the same prefix, so the tags could have said three
different things and it would still have passed. The helper captures the opening
delimiter and matches to its next occurrence instead. Nothing errored and no output
changed, which is the shape of every failure this file exists to catch.

html-validate is pointed at `"dist/**/*.html"`, a glob, and the quotes matter: they
stop the shell expanding it so html-validate does its own recursion. It used to name
the four pages one by one, which meant #46 built and shipped a fifth page that was
never structurally validated at all, and nothing went red. Any list of pages that has
to be kept in step by hand is the same trap.

**Lint and link checking run against `dist/`, not source.** The source now contains
`{{> header}}`, which is not HTML, and `dist/` is what visitors actually receive.
Checking source silently stopped covering the FAQ link when the nav moved into a
partial, and the total still read as three because the canonical URL took its place,
so `check-links` now fails if it finds fewer links than expected.

**`MINIMUM_EXPECTED` in `scripts/check-links.js` must equal the real number of
outbound links in `dist/`, not sit below it.** A floor with slack in it cannot do the
job the paragraph above describes. It read 4 while `dist/` carried 6, because #19 added
the substitute page's two links without moving it, so both DUPR links could have
vanished with the check still green. #48 set it to 7 and it is now exact. Adding a link
means raising it; removing one on purpose means lowering it, and having to edit this
line is the point.

`npm run check-links` is deliberately outside `npm test`. Third-party hosts can
rate-limit a CI runner, and a pull request that goes red for that reason teaches
people to ignore red.

Not adopted, on purpose: **stylelint** costs 95 packages to lint a hand-written
stylesheet that has produced no defects, and **prettier** would reformat every file
in the repo for a formatting problem `.editorconfig` already covers.

## Icons and the web manifest

One manifest, `public/site.webmanifest`, referenced from `index.html`. Its
`theme_color` and `background_color` must stay equal to the `theme-color` meta tag
and to `--cream`; `npm run smoke` fails if the three drift apart. Icon `src` values
are root-relative and are checked to exist in `dist/`, because a manifest icon that
404s fails silently: nothing breaks, the install prompt just shows no icon.

`public/icon.svg` is the canonical form of the mark, and its geometry is identical to
the inline logo in the header of `index.html`. Every PNG in `public/img/` and the
`favicon.ico` are raster exports of it, as is the 1200x630 `og-share.png`. If the mark
changes, change `icon.svg` and the header SVG together, then re-export.

The exports were produced by drawing the same primitives (one stroked circle, three
dots, three lines) at 8x and downsampling, rather than by tracing a bitmap. That is
why they are crisp at 16px and why the whole set costs a fraction of what the
inherited artwork did.

## SEO and metadata

The canonical origin is `https://www.gatewaysmash.com/`. It is declared in
`rel=canonical`, `og:url`, `sitemap.xml`, the `Sitemap:` line in `robots.txt`, and the
JSON-LD `url`. `npm run smoke` fails if they disagree, and `scripts/smoke-build.js`
holds it in one constant.

`og:image` and `twitter:image` must be **absolute**. Scrapers do not resolve relative
URLs, and a relative one fails silently.

The JSON-LD may only state things the visible page also states. Smoke checks enforce
this for the email, the venue, the venue's municipality, the street address, the
postal code, the `description`, and every `sameAs` URL, which has to appear as a real
`href` a visitor can follow. Structured data that disagrees with the page is worse
than none.

`description` joined that list in #54 and was the last property in the block sourced
from `<head>` instead of from the page. That is why it had drifted: it still described
the league the old way while every other copy had moved on, and no check could see it,
because the rule above is checked against `visiblePage()` and `<head>` is not in it.
The hero carrying the pitch is what made it checkable at all.

**"The visible page" means `visiblePage()` in `scripts/smoke-build.js`, never the raw
file.** It drops `<head>`, the JSON-LD block, and HTML comments, and all three matter:
the block would otherwise satisfy itself, `<head>` holds text no reader sees, and
nothing in this build strips comments, so they reach `dist/` intact. #48 proved the
last one by deleting the address from the Contact card and leaving the comment above
the JSON-LD that explains where the address comes from. Every check stayed green. Any
new "the page must say this too" assertion has to search `visiblePage()` output or it
can be satisfied by a sentence describing the rule instead of the page obeying it.

The address is stated **twice** in the JSON-LD, on the `SportsClub` and on the venue
`Place`, and a smoke check requires the two to agree field for field. `SportsClub`
descends from `LocalBusiness`, whose only required properties are `name` and
`address`, so a club carrying an address only on the nested `Place` reads to a local
search consumer as a business with no address at all. That was the state #48 shipped
in on its first pass, and every check passed.

A property set on a type that does not define it does not error. It is silently
dropped, which reads as coverage while doing nothing. `sport` was set on `SportsClub`
(schema.org defines it on `SportsEvent` and `SportsOrganization` only) and
`addressRegion` / `addressCountry` were set straight on the `areaServed` `City`
(defined on `PostalAddress`), leaving a bare "St. Louis" that names a city in nine
states. #48 removed the first and nested the second in a `PostalAddress`. Check the
domain before adding a property.

There is no `telephone`, deliberately. The league has no phone number, and Arch
Pickleball's front desk is a different organisation that cannot answer for the league.
This is a decision, not a gap: reopen it only if the league gets its own number.

The homepage must name **St. Louis** and **ladder** in its `<title>` and in at least
one `h2`. The `h1` is exempt, because it is a wordmark. This is one smoke check over a
`SEARCH_TERMS` list, and each half has its own history. The city is there because the
title once said "STL" while every other tag said "St. Louis": searchers type the full
name, so the abbreviation was competing for the wrong string while nothing appeared
broken. The format is there because of #54: "pickleball ladder league st louis" is the
phrase, and "ladder" appeared exactly once on the whole site, in an `h3`, which is a
slot neither half of this check can see.

The city is matched **case-sensitively and the format is not**, and that asymmetry is
deliberate. "St. Louis" is a proper noun with one correct spelling, so folding case
would quietly stop the check rejecting "st. louis". "ladder" is an ordinary word whose
casing follows its slot: the title is title case and headings are sentence case, so
one entry has to match both "Ladder League" and "ladder leagues". Adding a term means
deciding which of the two it is.

The pitch itself is checked separately, and that check requires it in three places at
once: the visible page, the description tags, and the JSON-LD `description`. The
constant is hardcoded rather than sliced out of the structured data, because the
sentence contains "St. Louis'" and splitting on the first full stop yields "One of
St". Editing that constant by hand when the league changes its pitch is the point.

The page states a location twice, in the League Info list and in the Contact section.
A smoke check requires both to name the venue and municipality the JSON-LD claims, so
all three move together. They previously disagreed, Bridgeton against St. Louis, which
is the kind of contradiction no build step can see.

Note that the served `robots.txt` is **not** the one in this repo. Cloudflare prepends
a managed block that disallows AI crawlers, and the repo file is appended underneath.
Changing crawl rules for those agents is a Cloudflare dashboard setting, not a repo
change.

## Pages

Nav links in `partials/header.html` are root-relative (`/#about`, not `#about`), because
an anchor alone only resolves on the homepage and every page shares this header.

The substitute rules are deliberately blunt. That is a real human voice and the copy
style guide says not to flatten it. The only edits made when moving that copy from a
group chat to a public page were factual: a reference to "this chat" that had no
referent on a web page, and "message an admin" needing a channel.

The FAQ lives here, not on Notion. `npm run smoke` fails if any built page links to
`notion.site` or mentions GroupMe, both of which this site has moved off.

`FAQPage` structured data must match the visible page: a smoke check compares each
question and the opening clause of each answer against the rendered text with the
JSON-LD stripped out. Rich results that promise text a visitor cannot find are worse
than no markup.

**Nothing states the two hours of court time as a number of its own.** The `Court
time:` line in League Info and the court-time bullet in the FAQ both say "Two
hours", and a smoke check derives that number from the `Time:` line's own window
(`6:00–8:00 PM`) rather than hardcoding it, then requires both pages to agree with
it. Widen the league to 6:00–9:00 PM and all three claims are silently wrong: the
markup stays valid and the sentence stays present, it just stops being true, which
is the Bridgeton-against-St. Louis failure one list further up the same page. The
FAQ half reads `visiblePage()` output, because that page's JSON-LD carries the same
sentence verbatim and would otherwise satisfy the check on its own.

Adding the court time also required rewriting the FAQ's "One more game" note, which
told the reader to book with Arch for court time after league matches. The site
would otherwise sell an included hour and then send people to buy it. Anything that
changes what league night includes has to be checked against that note.

The code of conduct is linked from the **footer**, not the nav, which was already six
items and is the path to joining rather than to policy. It carries no JSON-LD on
purpose: no schema.org type fits a conduct policy, and markup that fits nothing is
dead weight that reads as coverage.

Three smoke checks hold that page to the rest of the site, and the second exists
because the first cannot see the difference:

- Every content page links to it. One edit to `partials/footer.html` would otherwise
  drop the link from every page at once.
- The FAQ and the subs page link to it **from their prose**, checked with the
  `<footer>` stripped out first. Each states a rule this page completes, and the
  shared footer link would satisfy a naive check on every page.
- Its `mailto:` matches the one the homepage publishes, and the page never says
  "confidential". More than one organizer reads that inbox, so promising
  confidentiality would be a promise the league cannot keep. Change who reads the
  inbox and that check is what has to be revisited.

## The schedule drives the page, and nothing states a season by hand

Season status is **derived from the dates**, never written into the markup. A
hand-written "Summer 2026 is in progress" is wrong the moment the season ends,
which is the state issue #10 found the site in. `js/app.js` reads `data-start`,
`data-end` and `data-registration` off each schedule row and from them writes the
Status column, the callout above the table, the hero CTA label and note, and
whether the hero's "Play as a sub" offer is shown.

This is **progressive enhancement**, and it has to stay that way. `index.html`
ships the CTA as "Join the League", the note as an empty `hidden` paragraph, and
the subs offer as a `hidden` one carrying its own static copy, so a visitor
without JavaScript gets a correct, season-neutral page rather than an empty gap.
Baking a season name into the markup would reintroduce the original defect. A
smoke check reads `dist/index.html` and fails if the season-neutral label or
either `hidden` attribute goes missing.

The subs offer is the one piece of the hero JS **reveals rather than writes**.
Its copy names no season, so there is nothing to derive, and a `textContent`
write would take the `/subs/` link inside it with it. The same trap is why the
14 `target="_blank"` links still have no visually-hidden new-tab warning: adding
one inside `#hero-join` would be wiped by the label rewrite, so it has to hang
off a second `aria-describedby` id instead.

Four rules that are easy to break by accident:

- **Compare local calendar days, not UTC ones.** `today` is built from
  `getFullYear/getMonth/getDate`, not the `getUTC*` variants. Reading UTC parts
  off a local `Date` rolls the date over during the evening for every visitor
  west of UTC, so the page announced open registration hours early and retired a
  season on its own closing night, in the league's own timezone. A smoke check
  pins both boundaries at 19:30 Central by setting `process.env.TZ`.
- **Registration is a 24-hour window, not the month before the season.** It
  closes a day after it opens or as soon as 56 players sign up, whichever comes
  first, so `data-registration` names the single day a season is joinable.
  `statusOf` reads `today === registration` for open and `today > registration`
  for **Full**, and treating it as `today >= registration` is the bug that was
  there: 214 days of "Registration open" across the seven seasons the table
  ships, against seven that are real, with the hero reading "Join Fall 2026" for
  a month after Fall 2026 had filled. That is #10's defect class pointing the
  other way, retiring a window late rather than announcing it early. **Full is
  not derived from capacity**, which a static page cannot know; it is the honest
  label for a window that closed the usual way. The hero needs no branch for it,
  because the next season is picked from the rows still `open` or `upcoming` and
  a filled one drops out of that set on its own.
- **The next season is the soonest one**, chosen by comparing start dates, not
  the first matching row. The rows are hand-maintained and nothing orders them.
- **The hero and the callout say the running season in one shared string.**
  `inProgressSentence` and `registrationSentence` are written once and used by
  both. #51 was filed because the two had drifted: the callout said what was
  being played and the hero, three screens above it, did not, so for 310 of the
  342 days a scheduled season is on court the button named a season nobody could
  join for weeks. Two copies kept level by hand is what let that happen.
- **The hero names the next season only when it also names a running one.**
  `registrationSentence(next, Boolean(current))`. With nothing running the button
  beside the note already says "Join Fall 2026", so "Registration opens August
  13, 2026." is unambiguous and stays as it is; once a running season puts a
  second name in the sentence, the next one gets named too. A smoke check pins
  both halves, because a version that always names the season also passes every
  in-season check.

Renaming the CTA still requires the note to be on the page, which is why that
branch is nested. The subs offer is not: it makes no season claim, so it carries
none of the obligation the rename does and survives the note going missing.

### The rows the page ships are now checked, and until #58 they were not

Everything above this line is driven by a synthetic fixture, `CHRONOLOGICAL_SEASONS`
in `scripts/smoke-build.js`, which mounts made-up rows against a frozen clock. That
is still the right way to pin the bundle's behaviour, but it meant the table
`index.html` actually carries, the thing this file calls the most frequently edited
part of the site, was the one part of it no check could read. Nothing parsed a real
`data-start`.

#58 is what that bought. The Fall 2026 row spanned nine playing Sundays with no bye
against the eight-week season sold in six places on the homepage and twice more in
the FAQ. Valid markup, 53 green checks, and it was the next season players would have
paid for. Three checks now read the shipped rows:

- **Every season plays the number of weeks the price copy sells.** Counts league
  nights between `data-start` and `data-end` inclusive, subtracts the byes, and
  requires the result to equal the week count the League Info `Cost:` line states.
  Both the play night and the week count are **derived from League Info**, not
  hardcoded: the night comes from the `Day:` line and the count from the word before
  "-week" in `Cost:`, so moving the league to Saturdays or selling a six-week season
  is one copy edit and none in the check.
- **Each row shows the dates its attributes claim.** The `data-*` dates and the two
  human-readable cells beside them are one fact written twice, and the paragraph
  under Maintenance Notes has always told a maintainer to keep them in step by hand.
  Nothing enforced it, and the check above would have been satisfied by whichever
  half happened to be right.
- **Every bye falls on a league night inside its own season.** The first check counts
  byes by reading month-day tokens out of the bye cell, so a bye typo'd onto a
  Tuesday, or onto a date outside its season, still counts as one token and still
  balances the arithmetic. The table would go on telling a player to skip the wrong
  night with every check green. The bye cell carries no year, so the year is taken
  from the season the bye sits in, trying both ends because a winter season can
  straddle December.

**The table is selected by class token, not by one regex reaching from `<table` to
`league-table`.** Any such pattern has to cross the opening tag's `>`, so it does not
actually constrain the class to the table it started at, and a second table added
above this one would silently redirect all three checks at the wrong rows.

Still unchecked, deliberately: **nothing ties the other "eight-week" claims to the
`Cost:` line.** The hero, the three description tags, the JSON-LD and the FAQ each
state the season length independently, and the checks above read only League Info.
The pitch check pins the description tags to each other, but a hero rewritten to
"nine-week" against a League Info still reading "eight-week" would pass everything.
That is the same defect class this section exists for, one level up.

## Colour contrast

`--amber-dark` means "you can act on this now": the hero note and the
Registration open row. It is text at 14px, so it needs 4.5:1 against both
`--cream` and `--white`, and `npm run smoke` computes the ratios from the built
stylesheet and fails below that. It shipped at 3.5:1, which made the single most
actionable sentence on the page the hardest to read, and no other check could see
it: the markup stays valid and the text stays present, it just stops being
legible.

The footer link added in #46 is checked the same way. It is 0.85rem on `--ink`, so
it also needs 4.5:1, and the check resolves whichever custom property
`.footer-links a` names rather than hardcoding a colour, so recolouring the link is
enough to re-run the sum. `--cream` gives 15.95:1.

The hero subs line added in #51 is checked the same way again, both halves of it:
`.hero-sub-cta` at `--ink-soft` and `.hero-sub-cta a` at `--court-green`, on
`--cream`, at 0.9rem. `--court-green` clears it at **4.94:1**, which is not much
room, so that rule restates its colour rather than inheriting from the base `a`
rule purely so the check can resolve it.

## Copy style

The league's pitch is that it is the human alternative to disorganized corporate
leagues, so the copy should not read like a corporate league wrote it.

- Sentence case for headings. The `h1` is the exception: it is a wordmark.
- Headings carry search language as well as voice. The About `h2` names the city and
  the format; "Built by players, for players" moved into the lead paragraph rather
  than being cut, because a heading that tells a search engine nothing is a wasted
  slot. A smoke check fails if no `h2` names St. Louis, or ladder.
- No em dashes. En dashes only in numeric ranges (`Apr 12 – Jun 7`, `6:00–8:00 PM`),
  never as a general separator.
- Straight quotes and apostrophes. The pitch uses `St. Louis'`, not `St. Louis's`,
  and it is the only possessive form of the city on the site.
- **Prefer a number to an adjective.** "$50 for eight weeks" beats "affordable".
  **The pitch line is the standing exception**, chosen by the league and worked in by
  #54: "One of St. Louis' largest and most affordable indoor pickleball ladder
  leagues." Both "largest" and "most affordable" are exactly the adjectives this rule
  argues against, and the numbers are available: the roster was 56 players on
  2026-07-31, and the fee is $70. It stays as written anyway, because it is the
  league's own claim about itself and not a description this repo gets to tune. Do
  not quietly rewrite it into a roster count or a price. A smoke check now requires
  it verbatim in the hero, the description tags and the JSON-LD, so a rewrite fails
  the build rather than shipping.
- Prefer `is` and `has` to `serves as`, `offers`, `features`, `fosters`.
- Descriptive link text. Never "click here", which reads as nothing at all in a
  screen reader's link list.
- Watch for lists of exactly three, and for adjective pairs bolted to abstract
  nouns ("welcoming and supportive environment").
- Do not flatten every register. The blunt voice in the substitute rules is a real
  human voice and should stay.

## Deployment

Push to `main` deploys to <https://www.gatewaysmash.com> automatically. Render is the
origin host and Cloudflare fronts it. Nothing in this repo triggers the deploy, so do
not add a deploy workflow. See [README.md](README.md) for the full description.

## Integrations & Contact

- **Community Chat:** WhatsApp (linked in `index.html:259` and about copy at `index.html:126`).
- **Global Pickleball Network:** registration and the ladder. The club page is the
  site's one `sameAs` target and is linked from `index.html:127`; the `/register/`
  URL is a separate, action-shaped link and is not an identity claim.
- *Note:* GroupMe was historically used but removed completely.

## Maintenance Notes

The most frequently edited part of the site is the **League Schedule**.
- **Location:** `index.html`, around line 155 under `<h2>League schedule</h2>`.
- **Task:** Update the `<tr>` rows within the `<tbody>` table with the dates, matchups, and times for the current season.

Each row's `data-start`, `data-end` and `data-registration` attributes are the
**single source of truth for four separate things**: the row's own status label,
the callout above the table, the hero at the top of the page, which names the next
joinable season and states both which season is being played and whether
registration is open, and whether the hero offers a sub spot at all. A row edited
here changes the button a visitor sees before they have scrolled at all. Keep the
`data-*` dates and the human-readable dates in the same row in step; only the
`data-*` ones are read by code.

Since #58 that last sentence is enforced rather than merely asked for, and a new
row has to satisfy three things or the build goes red: it plays exactly the number
of weeks the League Info `Cost:` line sells, its cells show the dates its
attributes claim, and any bye falls on a league night inside its own season. The
week count is counted from the dates, so **a season is lengthened or shortened by
moving `data-end`, not by editing the copy**; changing the sold length means
editing the `Cost:` line, and then every row has to match the new number. See "The
rows the page ships are now checked" above for what each one caught.

The rows do not have to be in chronological order, and `js/app.js` picks the next
season by comparing start dates rather than by taking the first row. Adding a
season at the top is safe.

Registration has opened one month before the season starts on every row except
Winter 2027, which is Dec 11, 2026 against a Jan 10, 2027 start. No check asserts
that rule, precisely because that row would fail it. Adding one means settling
Winter 2027 first.

> **CRITICAL RULE FOR AI ASSISTANTS:**
> Whenever a change alters the tech stack, an integration (e.g., WhatsApp), or the project layout, this `CLAUDE.md` file MUST be updated in the same commit to prevent it from drifting from reality.

## Git exception for /work-issue

When executing the /work-issue workflow, Claude may run `git commit` and `git push`
on `issue-*` feature branches only. Never commit or push to the default branch, and
never commit or push outside a /work-issue run. The global no-commit policy applies
in all other circumstances.

The grant is deliberately narrow, and each half of it is doing work. It is scoped to
`issue-*` branches because that is the only place /work-issue creates commits, and
every one of them reaches `main` through a pull request that a human merges: the
exception buys the workflow the right to prepare a branch, not the right to release.
Pushing to `main` **is** the deploy on this project, per the Deployment section, so
the default-branch half of the rule is what keeps an agent from shipping to
production without review.

It exists because the workflow's own instructions cannot grant it. User instructions
outrank skills, so a skill cannot write itself a permission the user's global policy
withholds, which is why this block lives here rather than in the skill. Without it
/work-issue still runs every phase and stops before committing, handing the finished
branch over with the commands to ship it.
