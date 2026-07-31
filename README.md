# Gateway Smash Pickleball

Welcome to the Gateway Smash Pickleball club website! This is a grassroots, volunteer-run alternative to corporate pickleball leagues in St. Louis.

- **Live Site:** [https://www.gatewaysmash.com](https://www.gatewaysmash.com)

## Prerequisites

- Node.js 20.19 or newer, or 22.12 or newer. Vite 8 sets that floor. CI builds on Node 24.
- npm

## Getting Started

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Start the local development server:
   ```bash
   npm start
   ```
3. Build the production site:
   ```bash
   npm run build
   ```
4. Run everything CI runs, which is lint plus a build plus the output checks:
   ```bash
   npm test
   ```
5. Serve the production build locally to check it before pushing:
   ```bash
   npm run preview
   ```

## Checks

`npm test` is the one to run before pushing. It is `npm run lint` followed by
`npm run smoke`, and it is exactly what CI runs.

| Command | What it does |
| --- | --- |
| `npm test` | Lint, then build, then assert against `dist/` |
| `npm run lint` | ESLint over `js/` and `scripts/` |
| `npm run smoke` | Production build, then html-validate and `scripts/smoke-build.js` against `dist/` |
| `npm run check-links` | Fetches every outbound link on the site |

`scripts/smoke-build.js` uses no dependencies and asserts against the built output
rather than the source: content hashing, one script tag and one stylesheet, the
manifest being installable with icons that exist, declared MIME types matching the
files they point at, no third-party subresources, and the mobile nav actually
opening. It exists because a green build is not evidence the site works. The bug in
issue #1 compiled cleanly and shipped a page that loaded `app.js` twice.

`npm run check-links` is **not** part of `npm test`. Every outbound link points at a
third party that can rate-limit or block a CI runner, and a pull request that goes
red for that reason teaches people to ignore red. It runs weekly instead, via
`.github/workflows/links.yml`, and can be triggered by hand from the Actions tab.

## Project Layout

- `index.html` - The main homepage and schedule
- `404.html` - Error page
- `css/` - Stylesheets. Enters the build via an import in `js/app.js`
- `js/` - JavaScript logic (mobile nav, outside-click, scroll-driven header shadow)
- `fonts/` - Self-hosted DM Sans and DM Serif Display woff2 plus their OFL licences, referenced by `@font-face` in `css/style.css`
- `partials/` - Shared header and footer, included with `{{> header}}`. Edit the nav here, not in each page
- `public/` - Static files copied to `dist/` unchanged: `img/`, site icons, `robots.txt`, `site.webmanifest`
- `vite.config.js` - Build configuration

## Build

The site is built with [Vite](https://vite.dev). CSS and JS are minified and
content-hashed, so `dist/` contains names like `assets/main-tEWbBYpj.css`. The hash
changes when the file does, which is what stops browsers serving a stale stylesheet
after a deploy. Vite injects the hashed names into `index.html` at build time, so
neither the stylesheet link nor the script `src` should be hardcoded to a built path.

Files in `public/` bypass all of that and are copied to `dist/` byte for byte at the
same relative path.

Fonts are self-hosted rather than loaded from Google Fonts, so the page makes no
third-party requests at all. The `@font-face` rules at the top of `css/style.css`
use relative `url()` paths, which is what gets the woff2 files content-hashed along
with everything else. `npm run smoke` fails if a third-party subresource reappears.

## 🗓️ How to Update the League Schedule

Updating the schedule is the most common recurring maintenance task.
1. Open `index.html`.
2. Locate the league schedule section (starts around line 135 `<h2>League Schedule</h2>`).
3. Update the `<tr>` rows within the `<tbody>` table with the new dates, times, and matchup details for the current season.

## Deployment

The production site is [https://www.gatewaysmash.com](https://www.gatewaysmash.com).

| Layer | Service |
| --- | --- |
| DNS and CDN | Cloudflare |
| Origin host | Render |
| Release trigger | Push to `main` |

Pushing to `main` is the release. Render rebuilds from the branch and publishes the
production build output from `dist/`, typically within seconds of the merge. There is no
manual deploy step and no deploy workflow in this repository. The apex domain and plain
HTTP both redirect to the canonical `https://www.gatewaysmash.com`.

The Render service settings and the Cloudflare DNS records live in those dashboards,
not in this repo. Moving the site to a different host means changing them there and
updating this section to match.

Because a push to `main` reaches production without review, the CI workflow in
`.github/workflows/ci.yml` runs `npm ci` and `npm run smoke` on every pull request
targeting `main`. Keep it green before merging. The check reports its result but does
not block merges, since `main` has no branch protection rule requiring it.

## License & Contact

- **License:** MIT
- **Contact:** Join our WhatsApp group (link available on the website) for community chat and updates.
