# Worklog

A running record of issue work: what changed, how it was verified, where it landed,
and what was deliberately left undone.

## Baseline

Recorded before any changes, against `origin/main` at commit `de38f13`.

- `npm run build` succeeds. Node v24.18.0, npm 11.16.0, webpack 5.109.2.
- `npm audit`: 0 vulnerabilities.
- Build emits 2 warnings, both for `img/android-chrome-512x512.png` at 402 KiB
  exceeding the 244 KiB asset size limit. That is issue #16.
- `dist/` totals 579,809 bytes across 18 files:

| Bytes | File |
|---|---|
| 411246 | img/android-chrome-512x512.png |
| 59259 | img/android-chrome-192x192.png |
| 53255 | img/apple-touch-icon.png |
| 18864 | css/style.css |
| 15406 | img/favicon.ico |
| 10603 | index.html |
| 4029 | icon.png |
| 2472 | img/favicon-32x32.png |
| 1054 | 404.html |
| 1032 | js/app.js |
| 822 | img/favicon-16x16.png |
| 766 | favicon.ico |
| 429 | icon.svg |
| 263 | img/site.webmanifest |
| 231 | site.webmanifest |
| 78 | robots.txt |
| 0 | img/.gitkeep |
| 0 | js/vendor/.gitkeep |

## Batch 1: security and dependencies

### #3 npm vulnerabilities in the webpack toolchain

Already closed before this pass began, by PR #25 (commit `b34eaa2`). Confirmed
rather than redone: `npm audit` and `npm audit --omit=dev` both report 0
vulnerabilities on `origin/main`. No further work needed.

### #4 Add Dependabot

Added `.github/dependabot.yml` with two update streams, both monthly:

- `npm` at `/`, limit 5 open PRs, with `webpack*` and `*-webpack-plugin`
  grouped into a single `webpack` group so a toolchain major arrives as one PR
  instead of five partial ones.
- `github-actions` at `/`, which covers the `actions/checkout` and
  `actions/setup-node` pins in `.github/workflows/ci.yml`.

Monthly rather than weekly matches a site that changes a few times a year.

Verified: `npm run build` and `npm run smoke` both pass unchanged, and the
`dist/` file list and byte counts are byte-identical to the baseline above.
Config-only change with no build surface, so that is the whole verification
that applies. Dependabot itself cannot be exercised until the file is on
`main`, since GitHub reads it from the default branch.

Merged as PR #26, merge commit `a90e2e4`.

## Batch 2: build correctness

### #17 Is webpack still the right tool, and #5 no cache busting

#17 was a question, not a defect, so it got a recommendation comment rather than a
patch. Two of its premises had expired: #3 had already cleared the 22 advisories it
cited, and #24 plus #4 had supplied the CI and drift automation it wanted. The
remaining case rested on what the build does for the site.

A working Vite proof of concept was built and measured before recommending anything.
The deciding factor turned out not to be a build question: #18, #19, and #20 all
propose new pages, and neither webpack nor Vite does shared header and footer partials
natively. The webpack route (`handlebars-loader`) last shipped in March 2023. The Vite
route (`vite-plugin-handlebars`) is current, and was tested against this repo's real
34-line header across two pages before recommending it.

Decision from the maintainer: the new pages are happening, so migrate. That resolves
#17 as option 3 and makes #5 redundant, since content hashing and CSS minification
both come with the migration rather than as added loader config.

What changed:

- Deleted `webpack.common.js`, `webpack.config.dev.js`, `webpack.config.prod.js`.
  Added `vite.config.js`, which declares `index.html` and `404.html` as entries.
- Swapped 6 devDependencies for 1. The tree went from 334 packages to 46.
- Moved the nine copy-pattern sources into `public/`. Output paths and public URLs
  are unchanged, so nothing referencing them needed editing.
- `js/app.js` now imports `../css/style.css`, which is how the stylesheet enters the
  build. Under webpack it was copied verbatim and never processed.
- `index.html` declares `<script type="module" src="/js/app.js">` and no longer
  hardcodes a stylesheet link. Vite rewrites the one and injects the other.
- Rewrote `scripts/smoke-build.js`. Content hashing broke three of its five checks,
  all of which hardcoded the old layout.

Measured, same source files, webpack on `main` rebuilt for the comparison:

| Asset | webpack raw | webpack gz | Vite raw | Vite gz |
|---|---|---|---|---|
| `index.html` | 10,603 | 3,433 | 12,937 | 3,639 |
| stylesheet | 18,864 | 4,193 | 12,727 | 3,341 |
| JS bundle | 1,032 | 432 | 1,717 | 751 |
| **Render path total** | **30,499** | **8,058** | **27,381** | **7,731** |

Net on the critical render path: 327 fewer gzipped bytes, a 4.1% reduction. Total
`dist/` went from 579,809 to 576,691 bytes. The total barely moves because
`img/android-chrome-512x512.png` at 411 KB dominates everything, which is #16.

Two honest regressions. Vite does not minify HTML where `HtmlWebpackPlugin` did, so
`index.html` grows 2,334 raw bytes and 206 gzipped. Fixing that would mean adding
`html-minifier-terser`, last published September 2023 and carrying 7 dependencies,
which would undo most of the dependency reduction that justified the migration. Not
worth it for 206 bytes. The JS bundle also grows 319 gzipped bytes because Vite
prepends a modulepreload polyfill.

Verification:

- `npm run smoke`: all 7 checks pass.
- Negative test on the smoke checks: disabling content hashing in `vite.config.js`
  makes exactly the two hashing checks fail with the offending filenames named. The
  checks are not vacuous.
- Output file diff against the webpack build: 15 files byte-identical, `css/style.css`
  and `js/app.js` replaced by their hashed equivalents, `js/vendor/.gitkeep` no longer
  shipped. That last one is an empty boilerplate directory that #14 wants removed
  anyway; it is not in `public/`, so Vite has nothing to copy.
- CSS equivalence: 150 rule blocks in both source and output. Every declaration-level
  difference is a provably equivalent esbuild rewrite (`#ffffff` to `#fff`,
  `rgba(28,28,28,.06)` to `#1c1c1c0f`, the default `ease` timing function dropped,
  `::after` to `:after`, `transform-origin: center` to `50%`, `nth-child(1)` to
  `first-child`). No rule was dropped.
- Every asset serves 200 at the expected size from `npm run preview`, including both
  hashed assets, `404.html`, `robots.txt`, `site.webmanifest`, and the icons.
- Browser verification, driven over the Chrome DevTools Protocol against a headless
  Chrome. The same 14-check suite was run against **both** the Vite build and the
  webpack build rebuilt from `main`, so that any failure could be attributed to the
  migration rather than to the test. Both pass 14/14: stylesheet applied, display font
  resolved, desktop nav versus hamburger visibility, table renders with 7 season rows,
  scroll adds and removes `.scrolled`, no failed subresources, and on a 390px viewport
  the closed nav sits off-screen, the toggle opens it, and Escape, nav-link click, and
  outside click each close it, with focus restored to the toggle.
- Visual parity: full-page screenshots of both builds at 1280px and 390px, captured
  after `document.fonts.ready` so webfont loading could not race the capture. Zero
  pixels differ by more than 8/255 at either width. The residual sub-threshold noise
  is confined to the header band, where `backdrop-filter: blur(12px)` renders
  non-deterministically. Layout geometry is identical to the hundredth of a pixel:
  `scrollHeight` 3499, logo top 18.19, contact section top 2856, footer top 3396 in
  both builds.

Deferred and flagged: the Render dashboard build command and publish directory could
not be verified from the repo, since there is no `render.yaml`. The publish directory
stays `dist/`, so this is expected to be a no-op, but it is the one thing that could
take the site down and it needs a human with dashboard access to confirm.

Merge commit: pending
