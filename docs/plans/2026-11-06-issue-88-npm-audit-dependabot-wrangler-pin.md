# Plan: npm audit findings, stale Dependabot group, unpinned wrangler (issue #88)

Risk tier: Medium. Dev toolchain only and no site or Worker source changes, but the
bump alters what `vite build` emits (see "What the bump changes") and the deploy
path for the production `/join` route gets a new command. Altering existing behaviour
across more than a few files raises it from Low twice.

Domain skills: none applicable. No framework, UI, API, data, payments or email code
changes. Context7 not needed: wrangler's commands were read from the pinned binary's
own `--help`.

Companion controls: no `.claude/work-issue.md`, `REVIEW.md`, finder or verifier agent,
or edit-guard hook. Fallbacks apply. Gate is `npm test`, derived from CLAUDE.md.

## Acceptance criteria

From the issue, verbatim:

1. `npm audit` reports no critical or high findings on `main`.
2. The Dependabot grouping matches packages that exist in `package.json`.
3. The Worker deploy command uses a wrangler version pinned in a lockfile.

Made checkable for this run:

4. Every statement in CLAUDE.md and `scripts/smoke-build.js` that the bump makes false
   is corrected, and each 404 check still fails when its target is broken on the new
   toolchain.
5. Root `npm ci` installs no wrangler, and `npm test` needs no `worker/node_modules`.
6. `worker/README.md` and the `worker/wrangler.toml` comment name no `npx wrangler`.
   Nothing deploys and no secret is set during this run.

## Fresh baseline (2026-11-06, 12683bf, Node 24.18.0, npm 11.16.0)

`npm ci && npm audit`: 10 findings, 1 critical, 5 high, 4 moderate. Matches the issue.
Trial in a scratch copy with `vite@^8.3.6 eslint@^10.14.0 html-validate@^11.18.0` then
`npm update`: audit is 4 moderate, 0 high, 0 critical. `npm test` exits 0.

`vite` 8.3.6 brings rolldown 1.2.1 to 1.2.16, handlebars 4.7.10, eslint 10.14.0,
html-validate 11.18.0.

## What the bump changes (measured, not predicted)

Comparing `dist/` from 8.2.0 and 8.3.6:

- **`dist/404.html`'s inline `<style>` is now minified.** Vite 8.2.0 left it verbatim.
  Tokens now reach the parity check as `--white:#fff`, the same spelling as the
  stylesheet, and the block arrives on one line. Every check is green, which is
  exactly why this needs negative tests rather than trust: the 404 parsers were
  written against the unminified form. Outside `<style>` the page is unchanged.
- **The minifier also removes a declaration, so this is more than spelling and
  layout.** `404.html` has `min-height: 100vh` then `min-height: 100dvh`, and
  `dist/404.html` ships only `min-height:100dvh`. Vite 8.3.6's default target,
  `baseline-widely-available` (chrome111, edge111, firefox114, safari16.4, ios16.4),
  is inherited by `cssTarget`, and Lightning CSS keeps both lines only for a target
  older than `dvh`, confirmed by running it directly. A browser without `dvh` loses
  the vertical centring. **Accepted:** it is cosmetic, it matches `css/style.css`,
  whose mobile drawer uses `height: 100dvh` with no fallback, and neither `404.html`
  nor the target changes. A render comparison in a current browser cannot see this.
- **The bundle is 5,074 bytes, not 5,078**, one De Morgan rewrite of the Tab handler's
  guard, from `if(!(k!==`Tab`||!open))` to `if(k===`Tab`&&open)`. Behaviour identical. Still exactly one `$`.
- CSS, fonts and the four content pages differ only by the bundle's hash.

Remeasured on rolldown 1.2.16, all unchanged and all stated correctly today:
`'$' + 70`, `'$'.concat(70)`, `'$' + (35 * 2)`, `String.fromCharCode(36) + 70` and a
`FEE` used once emit `$70`; `FEE` used twice does not. A `$`-then-digit identifier
first appears between 3,000 and 3,050 names in one scope on both 1.2.1 and 1.2.16.

## Decision: wrangler in `worker/package.json` with its own lockfile

Not a root devDependency. Measured: wrangler is 35 packages and 223 MB of
`node_modules` (workerd, esbuild, miniflare), against
69 MB for the whole site toolchain, so a root pin would roughly quadruple every
`npm ci` in CI and on Render for a tool neither uses. It would also put a Cloudflare
runtime's advisories into the site's audit and need Node 22 while root `engines`
allows 20.19. #87 does not change this: it specifies a dependency-free `node --test`
that imports the handler with a stubbed `fetch`, so `npm test` needs nothing from
wrangler and must keep passing with `worker/node_modules` absent.

Not an npm workspace: a workspace would pull wrangler back into root `npm ci`.

Costs accepted, each handled below: root `npm audit` cannot see the Worker's tree,
Dependabot needs a second entry, and CI never installs it, so a green Dependabot PR on
`worker/` proves only that nothing broke the site. `worker/` audits at 0 today.

Pin exactly (`npm install -D -E wrangler@4.158.0`, latest today, `found 0
vulnerabilities`). Called through npm scripts, not `npx`: when `node_modules` is
missing, `npx wrangler` falls back to fetching latest, which is the defect in the
issue, while an npm script fails with "not found" unless a global wrangler is on
`PATH`. `which wrangler` is empty on this machine.

## Files that change

- `package.json`, `package-lock.json`: floors raised to `vite ^8.3.6`,
  `eslint ^10.14.0`, `html-validate ^11.18.0`; lockfile refreshed.
- `worker/package.json` (new): `private`, `type: module`, `engines.node >=22.0.0`,
  scripts `dev` (`wrangler dev`), `deploy` (`wrangler deploy`), `secret:put`
  (`wrangler secret put`), exact devDependency `wrangler`.
- `worker/package-lock.json` (new).
- `worker/README.md`: `npm ci` as the first setup step and why the scripts rather
  than `npx`; `npm run secret:put -- TURNSTILE_SECRET`, `-- INVITE_URL`;
  `npm run deploy`; rotation; `npm run dev`; a line that root `npm audit` does not
  cover this directory, so run `npm audit` here before a deploy.
- `worker/wrangler.toml`: header comment's `npx wrangler secret put`.
- `.github/dependabot.yml`: replace the `webpack` group with `toolchain`, patterns
  `vite*`, `eslint*`, `@eslint/*`, `html-validate`; rewrite its comment; add an npm
  entry for `directory: "/worker"`, monthly, with a comment that CI does not install
  that tree.
- `vite.config.js`: comment only. "emits byte-identical to the source" is false now
  that the 404 inline style is minified.
- `scripts/smoke-build.js`: comments only. Line ~1114 (5,078 bytes). Lines ~2632 and
  ~2672 ("the 404 page's inline block is not" minified). No logic change.
- `CLAUDE.md`:
  - Project Structure `worker/` bullet, and line 29 "one devDependency", which is
    already false and is the sentence describing what this change splits in two.
  - Bundle size at line 329 and in the matching comment: write "about 5 KB", not a new
    exact figure that the next minifier bump falsifies. "exactly one `$`" stays.
  - "`#ffffff` and `#fff` compare equal" under #67: the 404 block is minified since the
    Vite 8.3 line, so the spelling difference and `--white` "live proof" no longer
    exist, and the `rgba()` caveat changes for the same reason. Keep the rule: whether
    the block is minified is a Vite default a minor bump just flipped, and flipping it
    back must not read as a drift. `--white` is the only token that shortens today.
  - Comment-stripping bullet: state whether a comment can still reach the parser, per
    the negative test below (`/*! */` may survive Lightning CSS).
  - Integrations: `npx wrangler secret put INVITE_URL`.
  - The removed `100vh` declaration, under #67: see "What the bump changes".
  - A note that `npm audit` at root does not cover `worker/`.

`worker/src/index.js` is not touched. #87 owns it.

## Order of work

1. Root bump and lockfile. `npm test`.
2. Negative tests below on a build of the new toolchain, reverting each.
3. `worker/package.json`, lockfile, README, `wrangler.toml` comment.
4. `.github/dependabot.yml`.
5. Comments in `scripts/smoke-build.js`, then CLAUDE.md.
6. Full gate with `worker/node_modules` present, then again with it deleted.

## Risks

- Riskiest: the 404 parsers passing vacuously on minified CSS. Green is not evidence
  here. Covered by negative tests.
- Lightning CSS changing what the 404 page renders. Covered by a before and after
  render. A failure here is fatal to the bump and goes back to the orchestrator.
- `npm run` picking up a global wrangler. None is installed here; on another machine
  an unpinned global would win only if `worker/node_modules` were absent. README says
  run `npm ci` first.
- npm 11 prints an `allow-scripts` warning for esbuild and workerd postinstalls. Both
  run correctly without them: `npm ci` then `wrangler dev` served `/join` 200 in
  scratch. Not adding `allowScripts`; the binaries come from optional dependencies.
- `eslint .` reaching `worker/node_modules`: eslint ignores `**/node_modules/` by
  default. Proved by step 6.

## Chosen not to do

- No `npm audit` step in CI. A new advisory would turn unrelated PRs red for a reason
  outside them, the argument CLAUDE.md already makes for `check-links`.
- No smoke check on the Dependabot file, the pin or the README. `npm ci` already
  rejects a lockfile out of step with `package.json`, and CLAUDE.md scopes
  `scripts/smoke-build.js` to the shipped site. The new behaviour is tested by the
  negative tests on existing checks.
- No `overrides` for minimatch. See below.
- No wrangler in CI and no `wrangler deploy --dry-run`, which the run's brief excludes.

## Left open

minimatch: 4 moderates remain (GHSA-g3hv-75wg-m249 through `eslint`, `@eslint/js`,
`@eslint/config-array`). Advisory range is `>=7.0.0 <11.0.1`, so a patched minimatch exists (11.0.1 to 11.0.5),
but eslint 10.14.0 declares `^10.2.6` and `@eslint/config-array` `^10.2.4`, so it is a
major outside what eslint asks for. An `overrides` entry would force that untested, and
`npm audit fix --force` proposes downgrading to eslint 9. Globs here come from the
repo's own config, so the DoS needs a maintainer attacking themselves. Left for eslint
to widen its range.

## Proof

| Criterion | Evidence |
| --- | --- |
| 1 | `npm audit --json` metadata after step 1: 0 critical, 0 high |
| 2 | Script listing each group pattern with the `package.json` deps it matches; none empty. YAML parses |
| 3 | `worker/package-lock.json` resolves wrangler to the exact `package.json` version; `npm ci` in `worker/`; `npx --no-install wrangler --version` prints it (not `npm run dev -- --version`, measured: `wrangler dev` ignores the flag and starts the server); with `node_modules` deleted, `npm run dev` fails "not found" and downloads nothing |
| 4 | Each below goes red on the 8.3.6 build, then reverts to green |
| 5 | `npm ls wrangler` empty at root; gate green with `worker/node_modules` deleted |
| 6 | `git grep -n "npx wrangler"` empty outside `docs/plans/`. No deploy or secret commands in the run log |

Negative tests, all against a fresh 8.3.6 build:

- `404.html` `--cream` drifted from the stylesheet: parity check red.
- `404.html` `--amber-dark` set to `#c26f06`: eyebrow contrast red near 3.43:1.
- Declared and unused token added to the 404 block: exactness check red. It must not
  be dropped by the minifier first; if it is, record that.
- `var(--undeclared)` used in the 404 block: exactness check red.
- `/*! note */` at the start of the 404 `:root`: confirm parity still reads all eight.
  Measured: the minifier removes it, and a drifted `--cream` beside it goes red. Only
  a `/*! */` at the very top of the `<style>` survives, outside `:root`.
- 404's `:root` renamed so the block empties: both floors red by name.
- Third-party `@import` or `url()` in 404's inline style: standalone check red.
  **Departure, measured:** neither goes red, on 8.3.6 or on 8.2.0. The check matches
  `<link>` and `<script>` tags only, so this expectation was wrong and the bump did
  not cause it. A third-party `<link rel="preload">` and a `<link rel="stylesheet">`
  in the same place both go red on 8.3.6. Left open: this change edits only comments
  in `scripts/smoke-build.js`, so the gap needs its own issue.

Live drive:

- Render `dist/404.html` from 8.2.0 and 8.3.6 in a browser at 375px and 1280px; the two
  must match by eye or by pixel diff.
- Serve `dist/` with `vite preview`, open the homepage, exercise the mobile drawer's
  Tab trap (the one function the minifier rewrote) and Escape; no console errors.
- From `worker/`: `npm ci`, a `.dev.vars` of Cloudflare's published test values, then
  `npm run dev`; `GET /join` returns the challenge. Delete `.dev.vars`. No Cloudflare
  account call is made.
