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
postal code, and every `sameAs` URL, which has to appear as a real `href` a visitor
can follow. Structured data that disagrees with the page is worse than none.

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

The homepage must name **St. Louis** in its `<title>` and in at least one `h2`. The
`h1` is exempt, because it is a wordmark. This is a smoke check, and it exists because
the title once said "STL" while every other tag said "St. Louis": searchers type the
full name, so the abbreviation was competing for the wrong string while nothing
appeared broken.

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
- Headings carry search language as well as voice. The About `h2` names the city;
  "Built by players, for players" moved into the lead paragraph rather than being
  cut, because a heading that tells a search engine nothing is a wasted slot. A
  smoke check fails if no `h2` names St. Louis.
- No em dashes. En dashes only in numeric ranges (`Apr 12 – Jun 7`, `6:00–8:00 PM`),
  never as a general separator.
- Straight quotes and apostrophes.
- **Prefer a number to an adjective.** "$50 for eight weeks" beats "affordable".
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
- **Location:** `index.html`, around line 138 under `<h2>League schedule</h2>`.
- **Task:** Update the `<tr>` rows within the `<tbody>` table with the dates, matchups, and times for the current season.

Each row's `data-start`, `data-end` and `data-registration` attributes are the
**single source of truth for four separate things**: the row's own status label,
the callout above the table, the hero at the top of the page, which names the next
joinable season and states both which season is being played and whether
registration is open, and whether the hero offers a sub spot at all. A row edited
here changes the button a visitor sees before they have scrolled at all. Keep the
`data-*` dates and the human-readable dates in the same row in step; only the
`data-*` ones are read by code.

The rows do not have to be in chronological order, and `js/app.js` picks the next
season by comparing start dates rather than by taking the first row. Adding a
season at the top is safe.

> **CRITICAL RULE FOR AI ASSISTANTS:**
> Whenever a change alters the tech stack, an integration (e.g., WhatsApp), or the project layout, this `CLAUDE.md` file MUST be updated in the same commit to prevent it from drifting from reality.
