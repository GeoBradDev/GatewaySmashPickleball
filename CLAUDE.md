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
description-agreement check silently became a comparison of their first 33
characters: all three truncated to the same prefix, so the tags could have said three
different things and it would still have passed. The helper captures the opening
delimiter and matches to its next occurrence instead. Nothing errored and no output
changed, which is the shape of every failure this file exists to catch.

html-validate is pointed at `"dist/**/*.html"`, a glob, and the quotes matter: they
stop the shell expanding it so html-validate does its own recursion. It used to name
the four pages one by one, which meant #46 built and shipped a fifth page that was
never structurally validated at all, and nothing went red. Any list of pages that has
to be kept in step by hand is the same trap.

### The asset and description checks read every page, and until #61 they read one

The paragraph above fixed that trap for html-validate. Four checks in the smoke
script still had the single-page version of it: exactly one hashed module script,
exactly one hashed stylesheet, no third-party subresources, and the three
description tags agreeing, all reading `dist/index.html` alone. The FAQ, subs and
code of conduct pages are full entry points in `vite.config.js` with their own
`<head>` and their own `<script type="module">`, so #1's double-loaded bundle, an
unhashed stylesheet link, a Google Fonts tag, or three descriptions saying three
different things could land on any of them with `npm test` green. Pushing to `main`
is the deploy, so the smoke script was standing in front of one page out of five.
All four now loop over `CONTENT_PAGES`, which is derived from `dist/`, and each
failure names the page it found, or a red build sends a maintainer to the wrong file.

`CONTENT_PAGES` moved to the **top** of the file to make that possible. `check()`
runs its callback immediately, so a const declared beside its old only caller is in
the temporal dead zone for every check above it, and `check()` catches the
ReferenceError and reports it as an ordinary content failure. A wiring mistake would
read as a copy bug. `NUMBER_WORDS` is hoisted for the same reason.

The two asset checks also require every page to name the **same** bundle and the
**same** stylesheet, which is stricter than the issue asked for and is what keeps the
rest of the file honest. Seven checks resolve `styleRef` once, from the homepage, and
read the file it names: minification, the emitted-CSS scan, the self-hosted fonts and
the four contrast sums. `runBundle()` does the same with `scriptRef` for every bundle
behaviour check. Give one page its own chunk and all of them go on passing while
covering the homepage's copy of the asset. Vite splits exactly that way the moment a
page's script list stops matching the others, which is how the negative test for it
was built rather than imagined.

**A loop over a derived list passes vacuously when the list is empty**, and three of
those four did: a `forEach` over nothing pushes no problems, so they reported `ok`
against zero pages. Deriving `CONTENT_PAGES` from `dist/` is what makes it
maintenance-free and equally what makes it silently emptiable. The floor is asserted
once, ahead of all of them, from `sitemap.xml`'s own entry count rather than a number
written into the script. The canonical check already requires every built page to
appear in the sitemap, so this is that requirement pointing the other way, and a page
dropped from `vite.config.js` now fails by name instead of shrinking the set every
loop runs over. The hardcoded "at least 4 pages" guard it replaced is gone.

`404.html` is deliberately outside `CONTENT_PAGES`. It is not an `index.html`, it
carries no module script and no stylesheet link by design, and the check that it
stays standalone already scans it for third-party subresources itself.

Still index-only, deliberately: **the icon and manifest URL checks**. `every icon and
manifest URL in dist/index.html resolves` and `every declared link type matches the
file it points at` read the homepage alone, while every subpage ships the same five
icon links and the same manifest link. #61 scoped itself to the four checks it named.
This is the same defect class one surface over, and closing it is its own issue. #62
found and closed a fifth, the price agreement check, which has its own section below.

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

### The price check, and what a `$` cannot see

A wrong price is the worst bug this site can ship, and until #62 the check guarding
against it read `dist/index.html`, sliced it from `<body>`, and asserted one distinct
`$NN`. That is three of the ten copies the site ships. The FAQ states the fee four
times, twice in prose and twice in its own JSON-LD, and none of them were compared to
the homepage's. The realistic failure is the one the check was written for, one page
further out: the league changes the fee, one page is edited, the other page's copies
are missed, and `npm test` is green while the site quotes two prices to the same
player. The FAQ's own JSON-LD-matches-page check does not close it, because it
compares each answer's opening clause only and the FAQ's four copies drift together
anyway. It now walks every built page, `404.html` included rather than
`CONTENT_PAGES`, and keys each amount by the page it came from.

**The floor and the comparison read deliberately different things, and collapsing
them back together reintroduces a bug.** The comparison takes the raw document,
because `og:description` and the JSON-LD are where a link preview and a rich result
get the fee, and the three description tags in `index.html`'s `<head>` were compared
to nothing: the per-page description check requires only that a page's own three tags
agree with **each other**, so all three could say $75 against a body saying $70 and
stay green. The floor takes `visiblePage()`, because "the page states a price" has to
mean one a player can read. Widening both halves together is what the first pass at
#62 shipped and what review caught: three `<meta>` tags nobody reads, or a single
HTML comment, discharged an error message that says this is the first thing a player
asks, and a homepage showing a visitor no price at all passed green. The pre-#62
check goes red on that build, the first pass goes green, the shipped version goes
red.

Comments are stripped before the comparison, which is the #48 rule pointing the other
way. A comment cannot show a visitor a price, so it cannot disagree with one, but it
can fail the build: a line recording that the fee was $60 before Spring 2026 reads as
a second amount, and the repair that invites is deleting the history that makes the
next fee change safe.

The failure message names `scripts/smoke-build.js` alongside the pages, because every
failure here has two opposite repairs. Either a copy drifted, or the site genuinely
states a second amount and the check is the thing that is wrong. A message reading
only "conflicting prices" makes editing the copy the cheaper repair, which on the
second reading means making a true sentence false to get a green build.

**What this check calls a price is the byte `$` followed by digits, in a file named
`*.html`.** That is narrower than its name, and an adversarial pass on #62 confirmed
six realistic edits that leave the site quoting two prices with the full suite green.
Each is left open as a decision, because a check that half-recognises a spelling is
worse than one that names the spelling it ignores:

- **A price split by a tag**, `$<strong>70</strong>`, matches nothing. Nested
  `<strong>` is structurally valid, so html-validate has nothing to say either.
- **`&#36;70` and `&dollar;70`** are the same price and a different byte.
- **"70 dollars" and "70 USD"** are ordinary English, and this check silently rewards
  writing the fee that way.
- **A schema.org `Offer` carrying `"price": "70"`** is the canonical way to state a
  price in structured data, and it is the one spelling that never carries a `$`. The
  comment beside the check argues that scanning JSON-LD is right because a rich result
  surfaces it, and that argument does not reach the markup Google actually reads.
- **`public/` ships verbatim and is not `.html`**, so `site.webmanifest` is out of
  scope, and so is the 1200x630 `og-share.png`. A fee baked into the social image is
  unreachable by any text check and is the likeliest place for a stale price to sit
  after a fee change.

**`js/app.js` is never opened, and that one is #70 rather than a decision.**
The bundle already writes the hero copy beside the Join button, so a fee written into
`registrationSentence()` would be the first price a visitor sees and this check could
not see it at all. Adding `.js` to the filter is one line, but minified identifiers
may begin with `$` and continue with digits, so a larger bundle could emit a `$0`
token and turn a fee check red against an asset file. Today's bundle contains no `$`
at all, which is exactly why that risk is untested.

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

Six rules that are easy to break by accident:

- **A row whose dates the bundle cannot read gets no status at all**, and
  **`parseDate` is the only place a string becomes a date.** The two halves are
  one rule, and #63 needed two passes to get there. `statusOf` answers `null`
  when any of its three dates is `NaN`, and the row loop skips those rows, which
  leaves the row exactly as the page without JavaScript already shows it. Before
  that the row read Upcoming forever and won the `nextRegistration` selection the
  moment it was reached, after which no later row could displace it because
  `start < NaN` is false for every one of them, so the hero named a season off a
  row nothing could read.

  **Rejecting `NaN` is not the same as requiring a date**, which is what review
  of the first pass caught. `Date.UTC(2026, 12, 1)` is January 1 2027, not an
  error, so `data-registration="2026-13-01"` passed an `isNaN` guard, and
  `longDate` then read `MONTHS[12]` off the raw attribute and rendered
  "Registration opens undefined 1, 2026." beside the Join button, confirmed in a
  browser against a real build. That is the string #63 was filed about, still
  reachable after the guard meant to close it. The cause was **two parsers**:
  `nextRegistration.opens` carried the raw string and `longDate` split it a
  second time with no guard of its own. `parseDate` now requires the
  `yyyy-mm-dd` shape and reads the three fields back off the result, which is
  what separates a date from a sum that happens to produce one, and `longDate`
  only formats a timestamp that has already been through it. **Do not give
  `longDate` a string again.**

  `parseDate` also returns `NaN` for a non-string, because a missing attribute
  reads as `null` and `null.split()` threw out of this IIFE and stopped the
  footer year updating along with it.

  One consequence worth knowing: if the row that gets skipped is the **running**
  season, `current` stays null, so the hero loses its "X is in progress" half and
  the subs offer never appears. That is the conservative answer rather than a
  bug, since the offer is only true when a season really is on court, but the
  subs offer is documented above as independent of the note branch and it is not
  independent of `current`.
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
paid for. Nine checks now read the shipped rows, six of them added by #63. The
first two below are about the dates being dates; the next four are about the row
being the season it says it is, which is a failure no amount of date validation
can see, because every row they reject carries dates that are impeccable:

- **Every `data-*` value is a real calendar date.** `^\d{4}-\d{2}-\d{2}$`, then a
  round-trip through `Date.UTC`. **Part message, part coverage, and which half
  applies depends on the attribute.** For an unparseable value the build was
  already red, because the four checks below all reach the dates through
  `parseDay`, which throws: what they reported was "unparseable date: 2026-09-2O"
  from a check named after a week count, or a cell that "does not show Dec 1"
  when the attribute is the thing that is wrong, and both send a maintainer to
  the wrong repair. For **`data-registration` it is the only check there is**: a
  roll-forward moves a start or an end by one to three days, never a multiple of
  seven, so the league-night check always catches those, and nothing catches a
  registration date. `data-registration="2027-09-31"` with the cell written as
  October 1, where it lands, is the sole failure in the suite. It is also the only
  statement of the contract that does not depend on `parseDay` throwing, which is
  a side effect of a helper written for something else: make `parseDay` lenient
  enough to accept an unpadded `2026-8-20`, which `js/app.js` reads quite happily,
  and every guarantee below it evaporates with the suite green. The round-trip is
  what makes the regex mean anything, because V8's string parser and `Date.UTC`
  both accept `2026-11-31` and roll it forward to December 1 without complaining.
  `js/app.js` enforces the same rule in its own `parseDate`, and that is not
  duplication: this one names the row a maintainer has to open, that one stops a
  visitor being shown the result, and pushing to `main` is the deploy while CI
  does not gate it.
- **Every season starts and ends on a league night.** This one is coverage. The
  week count below counts league nights *between* the two dates, so nudging a
  start off the play night still balances: Sat Sep 19 to Sun Nov 8 holds the same
  eight Sundays that Sun Sep 20 does, and the cell beside it agrees, because both
  halves are written in the same edit. Moving Fall 2026 back one day leaves the
  other four row checks green while the table opens a season on a night the league
  does not play and `js/app.js` flips the row to In progress a day early. The play
  night comes from the League Info `Day:` line through the shared `playNight()`
  helper, which the week-count and bye checks also use: the three had been
  deriving it separately and had already drifted to three different failure
  messages, one of which did not echo the line it had rejected.
  `data-registration` is exempt: it opens on a Thursday or a Friday on every row
  the table ships, because it is a window rather than a night of play.
- **Every registration window belongs to the season beside it.** Two failures in
  one check. Opening **on or after** the first night is not a window: `statusOf`
  tests `today >= start` before it tests the registration day, so the row runs
  Upcoming straight into In progress, "Registration open" is unreachable, and the
  hero can never announce the one season a visitor could join. And a registration
  date **left behind from the row it was copied out of** is how this goes wrong
  in practice, invisible to everything else because the date is real, matches its
  own cell and falls before its start. A Winter 2028 row carrying Winter 2027's
  `data-registration` reads Full forever.
  **Neither half hardcodes an interval**, and that is the point: the one-month
  practice is recorded under Maintenance Notes as deliberately unchecked, because
  Winter 2027 would fail it. The first half is strictly weaker than that rule and
  Winter 2027 clears it; the second asks only which `data-start` the date is
  **nearest**, which the table already answers. The league can change how far
  ahead it opens registration without editing this check.
- **Every season name states the year its own dates fall in, and no two rows name
  the same season.** `js/app.js` reads `cells[0]` straight into the hero CTA, so
  the Season cell is the name a visitor is asked to join, and nothing had ever
  looked at it. Roll a row forward a year and forget the name and the page offers
  "Join Fall 2027" for a season playing October 2028. Copy the row instead and
  the table ships two rows called Fall 2027, one Completed and one Registration
  open, with the button naming whichever the selection reaches. Either end's year
  satisfies it, because a winter season can straddle December.
- **No two seasons are on court at the same time.** The row loop assigns
  `current` unconditionally, so two overlapping rows both reading In progress
  leave the callout and the hero naming whichever sits **later in the document**.
  That is the mirror image of a bug already pinned for the *next* season, which
  is chosen by comparing start dates precisely so document order cannot decide
  it; the running season had the same exposure with no rule and no check. Every
  pair is compared rather than each row and the one after it, because nothing
  orders the rows.
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
above this one would silently redirect all nine checks at the wrong rows.

**`scheduleRows()` counts the `<tr>` in the tbody and fails if any of them lacks
`data-start`.** It selects rows *by* that attribute, so without the count a row
that lost it was not a failure, it was a smaller set: #63 review deleted
`data-start` from the Fall 2026 row and every check above went green over the five
rows that were left, reporting a whole season as though it were not there. The browser's own `tbody tr[data-start]` selector drops
that row too, while the bundle still appends the Status header, so the page ships
a column the row has no cell for. **Any check that selects its subjects by an
attribute has this hole**, and the repair is always to assert the count against
something that does not depend on the attribute.

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

### The eyebrow pills, and why one of them needed its own check

The three checks above all read the built stylesheet, and #60 was the colour that
proved a fourth surface existed which none of them could reach. `.hero-eyebrow`
and the 404 page's `.eyebrow` both put `--amber` on an `--amber-light` pill, which
is **2.44:1**: not merely under the 4.5:1 their 0.85rem text needs, but under even
the 3:1 that large text gets. Both are now `--amber-dark`, at **5.31:1**. That is
the same darkening the comment beside `--amber-dark` in `css/style.css` records,
arriving at the two places it never reached.

`--amber` survives, and is now used exactly once, as the `border-left` on the
callout. It is a border, not text, so no contrast rule applies to it.

The two checks share `ruleContrast`, which differs from the three above in
resolving **both** sides from the custom properties the rule itself names. The
subs check has to hardcode `--cream` because `.hero-sub-cta` sets no background
and inherits the hero's; a pill sets its own, so hardcoding would only invent a
second copy to keep in step.

**The 404 half cannot be checked against the stylesheet, and that is the point.**
That page carries its own copy of the palette so it still renders when the hashed
stylesheet is the thing that failed, so there is no stylesheet for a check to
read. Its check reads the page's own inline `<style>`, tokens included, and
judges the pair on the values that page actually ships. Point its `--amber-dark`
at the old `#c26f06` and it goes red at 3.43:1 while the homepage stays green,
which is what a copied palette drifting looks like.

### The copied palette is now held to the stylesheet, and until #67 a comment asked

Parity between the 404 palette and `css/style.css` used to be listed here as not
adopted: the comment at the top of `404.html` asked a maintainer to keep the
eight copied tokens in step by hand, and nothing enforced it. That is the trap
this file names in four other places, and #67 closed it.

**All eight agreed when the check went in**, which is the reason to add one then
rather than later. It ships as a guard, green, instead of arriving beside a fix
and proving nothing.

The copy is permanent and cannot be refactored away. `404.html` carries its own
styles precisely so it renders when the hashed stylesheet is the thing that
failed, so it can never link or `@import` the real palette. A check was the only
option.

**Parity and contrast are different questions and must not be merged.** The
check above asks whether a pair is legible; this one asks whether the two files
agree. A token that drifts to some other perfectly legible colour passes
contrast and fails parity, and contrast is blind to the six tokens the eyebrow
does not use at all. Two pairs on that page have little headroom, `--ink-muted`
on `--cream` at 4.99:1 and `--white` on `--court-green` at 5.27:1, so lightening
either token in `css/style.css` alone leaves the error page on the old value,
and doing it in `404.html` alone drops that page under 4.5:1 by itself.

**It iterates the 404 page's tokens, not the stylesheet's.** The stylesheet
declares the whole type, shadow, spacing and radius scale on top of a wider
palette, so comparing the other way would demand the error page carry the entire
design system. The subset is deliberate. `rootTokens` reads the **first**
`:root` block, because the stylesheet reopens `:root` in two media queries to
shrink `--section-pad` and `--container-pad`; neither is a colour and neither is
copied, so that only decides which value wins for an overridden token.

Three things the parser has to keep doing:

- **`#ffffff` and `#fff` compare equal.** The stylesheet is minified and the 404
  block is not, so the two halves of one palette arrive spelled differently, and
  `--white` is live proof: the page ships the long form against a stylesheet
  that ships the short one. Compare raw text and every shortened token reads as
  a drift. Named rather than hidden: minification also rewrites `rgba()` to
  eight-digit hex, so a token copied in longhand would fail as a spelling
  difference. All eight are bare six-digit hex, and that failure would be red
  with both spellings in the message, not a silent pass.
- **Comments are stripped before the declarations are matched.** The only
  boundary in front of the first declaration is the start of the block, so a
  comment sitting there pushes it past the anchor and it drops out of the map,
  leaving the check reporting `ok` over seven of eight tokens. `css/style.css`
  opens its own `:root` with `/* Palette */`, so that is a plausible edit and
  not a hypothetical. Review of #67 caught it in the first pass, and the
  pre-strip parser was confirmed green against a drifted `--cream`.
- **The empty list cannot pass vacuously.** The token list is derived by reading
  a `:root` block out of an HTML file, so a rewritten `<style>` block empties it
  and a `forEach` over nothing pushes no problems. The check asserts its own
  floor before looping.

A second check requires `404.html` to declare **exactly** the tokens it uses.
#60 removed `--amber` from that block when the eyebrow stopped using it, and
nothing would have caught it staying: an unused token is one more line for the
parity check to hold in step for no benefit, and it is the copy most likely to
drift, because no rendered pixel changes when it does. The reverse is sharper
and is why this is set equality rather than a scan for leftovers. A token the
page uses but never declares resolves to nothing, so `color` goes black and
`background` goes transparent. The page still renders, which is the whole point
of it carrying its own styles, it just renders wrong. That half also derives its
count from the `var()` calls rather than from the `:root` regex, so it fails by
name when the block empties.

Still not adopted, deliberately: **nothing checks the non-colour half of that
file**. The fallback font stacks in `404.html` are copied from the ones
`css/style.css` declares behind DM Serif Display and DM Sans, and the comment
above them is still all that asks for those to stay in step.

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

Since #58 and #63 that last sentence is enforced rather than merely asked for, and
a new row has to satisfy nine things or the build goes red. Four are about the
dates: every `data-*` value is a real calendar date, the season starts and ends on
a league night, it plays exactly the number of weeks the League Info `Cost:` line
sells, and its cells show the dates its attributes claim. Four are about the row
being the season it claims to be: its registration window opens before its own
first night and nearer to its own start than to any other row's, its name states a
year its dates fall in, no other row shares that name, and it does not overlap
another season. The ninth is that any bye falls on a league night inside its own
season. A row that fails the first of those is not merely unchecked, it is
unreadable, and `js/app.js` now gives it no status rather than a wrong one. The
week count is counted from the dates, so **a season is lengthened or shortened by
moving `data-end`, not by editing the copy**; changing the sold length means
editing the `Cost:` line, and then every row has to match the new number. See "The
rows the page ships are now checked" above for what each one caught.

The rows do not have to be in chronological order, and `js/app.js` picks the next
season by comparing start dates rather than by taking the first row. Adding a
season at the top is safe.

Registration has opened one month before the season starts on every row except
Winter 2027, which is Dec 11, 2026 against a Jan 10, 2027 start. **That rule is
still unchecked, precisely because that row would fail it**, and adding one means
settling Winter 2027 first.

What #63 added instead are two weaker rules that Winter 2027 satisfies: a window
opens **before** its own first night, and it is **nearer to its own start than to
any other row's**. Between them they catch the two ways this actually goes wrong,
a window opening after the season has begun and a date left behind from the row
it was copied out of, without anyone having to decide how far ahead registration
ought to open. Keep it that way. A check that hardcodes an interval is a second
place to edit when the league changes its practice, and the one that gets
forgotten.

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
