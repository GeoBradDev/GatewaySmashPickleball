# Gateway Smash Pickleball

This file provides architectural context for AI assistants working on this codebase. For human contributor setup, build commands, and general site overview, see the authoritative [README.md](README.md).

## Project Structure

- `index.html` - The main homepage containing the copy, schedule, and layout.
- `404.html` - Error page for broken links.
- `css/style.css` - Custom styles and layout rules.
- `js/app.js` - Main JavaScript logic (implements mobile nav toggle, outside-click and Escape dismissal, and scroll-driven header shadow). Also imports the stylesheet, which is how CSS enters the build.
- `public/` - Copied to `dist/` verbatim by Vite. Holds `img/`, the site icons (`icon.svg`, `icon.png`, `favicon.ico`), `site.webmanifest`, and `robots.txt`. Anything here ships at the same path it has in `public/`.
- `LICENSE.txt` - Project license.
- `vite.config.js` - Build configuration. Declares `index.html` and `404.html` as the two entry points.
- `scripts/smoke-build.js` - Dependency-free assertions against `dist/` after a build. Run via `npm run smoke`.
- `.github/workflows/ci.yml` - CI build check. Runs `npm ci` and `npm run smoke` on pull requests to `main` and on pushes to `main`. It does not deploy.

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
| `public/**` | verbatim copy | same path, unchanged bytes |

`index.html` deliberately has **no** hardcoded stylesheet link. Adding one back would
ship the unhashed, unminified copy alongside the hashed one.

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
