# Gateway Smash Pickleball

This file provides architectural context for AI assistants working on this codebase. For human contributor setup, build commands, and general site overview, see the authoritative [README.md](README.md).

## Project Structure

- `index.html` - The main homepage containing the copy, schedule, and layout.
- `404.html` - Error page for broken links.
- `css/style.css` - Custom styles and layout rules.
- `js/app.js` - Main JavaScript logic (implements mobile nav toggle, outside-click and Escape dismissal, `inert` sync and focus trap for the mobile drawer, and scroll-driven header shadow). Also imports the stylesheet, which is how CSS enters the build.
- `fonts/` - Self-hosted DM Sans and DM Serif Display woff2, plus the OFL 1.1 licence text each family requires when redistributed. Not in `public/`, deliberately: the `@font-face` rules in `css/style.css` reference them with relative `url()` paths so Vite content-hashes them.
- `public/` - Copied to `dist/` verbatim by Vite. Holds `img/`, `favicon.ico`, `site.webmanifest`, and `robots.txt`. Anything here ships at the same path it has in `public/`.
- `LICENSE.txt` - Project license.
- `vite.config.js` - Build configuration. Declares `index.html` and `404.html` as the two entry points.
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

The icon artwork is inherited and is **not** the paddle mark the header uses. See
the open question logged in [WORKLOG.md](WORKLOG.md).

## SEO and metadata

The canonical origin is `https://www.gatewaysmash.com/`. It is declared in
`rel=canonical`, `og:url`, `sitemap.xml`, the `Sitemap:` line in `robots.txt`, and the
JSON-LD `url`. `npm run smoke` fails if they disagree, and `scripts/smoke-build.js`
holds it in one constant.

`og:image` and `twitter:image` must be **absolute**. Scrapers do not resolve relative
URLs, and a relative one fails silently.

The JSON-LD may only state things the visible page also states. A smoke check
enforces this for the email and the venue by searching the page with the JSON-LD
block stripped out. Structured data that disagrees with the page is worse than none.

Note that the served `robots.txt` is **not** the one in this repo. Cloudflare prepends
a managed block that disallows AI crawlers, and the repo file is appended underneath.
Changing crawl rules for those agents is a Cloudflare dashboard setting, not a repo
change.

## Copy style

The league's pitch is that it is the human alternative to disorganized corporate
leagues, so the copy should not read like a corporate league wrote it.

- Sentence case for headings. The `h1` is the exception: it is a wordmark.
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

- **Community Chat:** WhatsApp (linked in `index.html:242` and about copy at `index.html:101`).
- *Note:* GroupMe was historically used but removed completely.

## Maintenance Notes

The most frequently edited part of the site is the **League Schedule**.
- **Location:** `index.html`, around line 135 under `<h2>League Schedule</h2>`.
- **Task:** Update the `<tr>` rows within the `<tbody>` table with the dates, matchups, and times for the current season.

> **CRITICAL RULE FOR AI ASSISTANTS:**
> Whenever a change alters the tech stack, an integration (e.g., WhatsApp), or the project layout, this `CLAUDE.md` file MUST be updated in the same commit to prevent it from drifting from reality.
