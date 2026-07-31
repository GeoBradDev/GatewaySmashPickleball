# Gateway Smash Pickleball

This file provides architectural context for AI assistants working on this codebase. For human contributor setup, build commands, and general site overview, see the authoritative [README.md](README.md).

## Project Structure

- `index.html` - The main homepage containing the copy, schedule, and layout.
- `faq/index.html` - The FAQ, served at `/faq/`. A directory rather than `faq.html` so the clean URL works on any static host without a rewrite rule.
- `subs/index.html` - Substitute player page, served at `/subs/`.
- `404.html` - Error page for broken links.
- `css/style.css` - Custom styles and layout rules.
- `js/app.js` - Main JavaScript logic (implements mobile nav toggle, outside-click and Escape dismissal, `inert` sync and focus trap for the mobile drawer, scroll-driven header shadow, the date-derived league schedule status described under Pages, and the footer year). Also imports the stylesheet, which is how CSS enters the build.
- `fonts/` - Self-hosted DM Sans and DM Serif Display woff2, plus the OFL 1.1 licence text each family requires when redistributed. Not in `public/`, deliberately: the `@font-face` rules in `css/style.css` reference them with relative `url()` paths so Vite content-hashes them.
- `partials/` - Shared `header.html` and `footer.html`, pulled into pages with `{{> header}}` via vite-plugin-handlebars. `404.html` deliberately does not use them.
- `public/` - Copied to `dist/` verbatim by Vite. Holds `img/`, `favicon.ico`, `site.webmanifest`, and `robots.txt`. Anything here ships at the same path it has in `public/`.
- `LICENSE.txt` - Project license.
- `vite.config.js` - Build configuration. Declares `index.html`, `faq/index.html`, `subs/index.html` and `404.html` as entry points. A new page needs an entry here, a line in `public/sitemap.xml`, and a nav link in `partials/header.html`.
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

**Lint and link checking run against `dist/`, not source.** The source now contains
`{{> header}}`, which is not HTML, and `dist/` is what visitors actually receive.
Checking source silently stopped covering the FAQ link when the nav moved into a
partial, and the total still read as three because the canonical URL took its place,
so `check-links` now fails if it finds fewer links than expected.

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

The JSON-LD may only state things the visible page also states. A smoke check
enforces this for the email, the venue, and the venue's municipality by searching the
page with the JSON-LD block stripped out. Structured data that disagrees with the page
is worse than none.

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

## The schedule drives the page, and nothing states a season by hand

Season status is **derived from the dates**, never written into the markup. A
hand-written "Summer 2026 is in progress" is wrong the moment the season ends,
which is the state issue #10 found the site in. `js/app.js` reads `data-start`,
`data-end` and `data-registration` off each schedule row and from them writes the
Status column, the callout above the table, and the hero CTA label and note.

This is **progressive enhancement**, and it has to stay that way. `index.html`
ships the CTA as "Join the League" and the note as an empty `hidden` paragraph, so
a visitor without JavaScript gets a correct, season-neutral page rather than an
empty gap. Baking a season name into the markup would reintroduce the original
defect. A smoke check reads `dist/index.html` and fails if the season-neutral
label or the `hidden` attribute goes missing.

Two rules that are easy to break by accident:

- **Compare local calendar days, not UTC ones.** `today` is built from
  `getFullYear/getMonth/getDate`, not the `getUTC*` variants. Reading UTC parts
  off a local `Date` rolls the date over during the evening for every visitor
  west of UTC, so the page announced open registration hours early and retired a
  season on its own closing night, in the league's own timezone. A smoke check
  pins both boundaries at 19:30 Central by setting `process.env.TZ`.
- **The next season is the soonest one**, chosen by comparing start dates, not
  the first matching row. The rows are hand-maintained and nothing orders them.

## Colour contrast

`--amber-dark` means "you can act on this now": the hero note and the
Registration open row. It is text at 14px, so it needs 4.5:1 against both
`--cream` and `--white`, and `npm run smoke` computes the ratios from the built
stylesheet and fails below that. It shipped at 3.5:1, which made the single most
actionable sentence on the page the hardest to read, and no other check could see
it: the markup stays valid and the text stays present, it just stops being
legible.

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

- **Community Chat:** WhatsApp (linked in `index.html:257` and about copy at `index.html:126`).
- *Note:* GroupMe was historically used but removed completely.

## Maintenance Notes

The most frequently edited part of the site is the **League Schedule**.
- **Location:** `index.html`, around line 136 under `<h2>League schedule</h2>`.
- **Task:** Update the `<tr>` rows within the `<tbody>` table with the dates, matchups, and times for the current season.

Each row's `data-start`, `data-end` and `data-registration` attributes are the
**single source of truth for three separate things**: the row's own status label,
the callout above the table, and the hero CTA at the top of the page, which names
the next joinable season and states whether registration is open. A row edited
here changes the button a visitor sees before they have scrolled at all. Keep the
`data-*` dates and the human-readable dates in the same row in step; only the
`data-*` ones are read by code.

The rows do not have to be in chronological order, and `js/app.js` picks the next
season by comparing start dates rather than by taking the first row. Adding a
season at the top is safe.

> **CRITICAL RULE FOR AI ASSISTANTS:**
> Whenever a change alters the tech stack, an integration (e.g., WhatsApp), or the project layout, this `CLAUDE.md` file MUST be updated in the same commit to prevent it from drifting from reality.
