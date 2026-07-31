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

Merged as PR #30, merge commit `8b5e292`.

## Batch 3: bugs and accessibility

### #6 Closed mobile nav stays focusable, and #7 accessibility gaps

Handled together, because three of #7's five items live in the same nav code as
#6 and could not be reviewed apart from it. Split into two commits: the nav work,
then the table work.

One premise in #6 was off. It located the drawer in "the max-width 900px block",
but the mobile nav rules are in the `max-width: 768px` block; 900px only adjusts
section padding and grid columns. The `matchMedia` gate uses 768px to match the
stylesheet. Getting this wrong in the other direction would have inerted the real
nav between 769px and 900px.

**#6, in two layers.** CSS `visibility` does the work, because it needs no JS.
That matters here: the toggle requires JS to open the drawer at all, so a visitor
without JS would otherwise be left with five permanently focusable links they can
never see. `js/app.js` then syncs `inert` on top, gated on `matchMedia`, since
`inert` is not media-query aware and inerting the desktop nav would take out the
whole navigation.

The visibility transition is `0s linear 0.35s`, not `0.35s`. This was found by
measurement, not by design: with a real duration the computed value stays `hidden`
at progress 0, so the drawer is still unfocusable on the frame it opens and the
focus move for #7 silently fails. Probing it frame by frame showed `hidden`
synchronously after the class change, `hidden` after one `requestAnimationFrame`,
and `visible` only by 100ms. Delaying the flip out instead of stretching it keeps
the panel visible while it slides off-screen, and the reduced-motion block gained
a matching `transition-delay` so an instant close does not leave the drawer
focusable for another 350ms.

**#7.** Skip link targeting `#home`, which gains `tabindex="-1"` so focus actually
lands there instead of only scrolling. `aria-controls` on the toggle plus an
`aria-label` that tracks state, since the hamburger-to-X animation only ever
communicated state to sighted users. A focus trap covering the toggle and the five
links; Escape handling and focus restoration already worked. `scope="col"` on every
`th` and a visually-hidden `caption`, because the mobile card restacking hides the
thead and breaks the cell-to-header association. The em-dash placeholder for an
empty cell moves from `--ink-faint` to `--ink-muted`, roughly 2.6:1 to 5:1 on cream.

Verification, all against the built site rather than the source:

- `npm run smoke`: 11 checks, up from 7. The 4 new ones cover inert on a closed
  drawer, inert cleared plus focus moved on open, inert restored on close, and the
  desktop nav never being inert. The DOM stub grew `removeAttribute`,
  `querySelectorAll` and a `matchMedia` that can report either breakpoint.
- Keyboard-only walkthrough in headless Chrome over CDP, using real dispatched key
  events rather than synthetic clicks: 19 checks at 390px and 1280px. Closed, ten
  Tab presses never enter the drawer and the first stop is the skip link. The
  accessibility tree contains no nav links at all while closed. Enter on the toggle
  opens it and focus lands on Home. Tab cycles Home, About, Leagues, FAQs, Contact,
  toggle, Home; Shift+Tab reverses; neither escapes. Escape closes, restores focus
  to the toggle and re-inerts. At 1280px the nav is never inert and all five links
  are still reachable.
- Layout diff against `main` at 390px, 800px and 1280px, comparing rect and key
  computed styles for all 168 elements. The only differences are the intended
  `visible` to `hidden` flip on the closed drawer, with identical geometry, and a
  0.5px sub-pixel shift on the first table row caused by the new caption.

Not done, and deliberately: #7 suggests considering a horizontally scrollable table
on mobile instead of the card restacking. `scope` plus the caption fixes the stated
defect, and swapping the mobile presentation is a visual redesign rather than an
accessibility fix.

Merged as PR #31, merge commit `2b02c98`.

### #8 Two web manifests, both with empty names, plus broken favicons

Everything the issue lists, plus one finding it did not anticipate.

Consolidated to a single `public/site.webmanifest` with real `name`, `short_name`
and `description`, `display: standalone` (it had no `display`, so it defaulted to
`browser` and installed as a plain shortcut), `start_url: "/"` without the
boilerplate `utm_source`, and `#faf7f2` for both colours so the manifest, the
`theme-color` meta tag and `--cream` finally agree. Deleted the orphaned
`public/img/site.webmanifest`, whose icon paths were root-relative to files that
live one directory down and would all have 404'd.

Generated `public/img/maskable-512x512.png`, which the issue correctly said would
be needed. It is the existing 512 artwork scaled into the central 72% of the canvas
on the source's own background colour, so no mask shape can clip it: the furthest
artwork pixel sits 184.3px from centre against a 204.8px safe radius, a 20.5px
margin. Quantising to a 64-colour palette takes it to 68,754 bytes rather than the
411,246 the unmodified 512 costs, which matters because this is now the third
512px icon shipped. Produced with a one-off Pillow script rather than a committed
generator, to keep the toolchain at one devDependency.

Favicon declarations: `index.html:17` declared a PNG with `type="image/svg+xml"`,
now corrected, and `favicon-32x32.png` is declared alongside the 16 rather than
sitting unreferenced. All icon URLs moved to root-relative. Deduplicated the two
different `favicon.ico` files by keeping the referenced one at the conventional
root path; before this, a browser probing `/favicon.ico` got a different image
from the one the page declared.

Verification:

- `npm run smoke`: 14 checks, up from 11. Three new ones cover every icon and
  manifest URL in the built HTML resolving inside `dist/`, the manifest being
  installable with 192, 512 and maskable icons that exist, and the three theme
  colour declarations agreeing.
- Negative tests on all three: pointing a manifest icon at a missing file,
  dropping the maskable entry, and setting `theme_color` back to `#fafafa` each
  fail the intended check and only that check.
- Chrome parses the manifest itself, via `Page.getAppManifest`, with zero errors.
  Every declared icon fetches and decodes at its declared pixel size. No failed
  subresources and no console errors on load.
- The 19-check keyboard suite from #6 and #7 still passes unchanged, since this
  touched the same `<head>`.

**Open question, needs a decision.** None of the icon artwork is the league's logo.
`icon.png`, `icon.svg` and the root `favicon.ico` were the HTML5 Boilerplate orange
star, and `og:image` pointed at it, so every link preview showed a boilerplate star.
Everything under `img/` is a teal globe with a green map pin, which appears to be
another project's mark. Neither is the pickleball paddle the header draws inline in
`index.html`. This change deletes the three star files and repoints `og:image` at
the globe, so the site is at least self-consistent, but the globe is still wrong.
Replacing the whole icon set with a mark derived from the header logo is a brand
decision and is not done here.

Merged as PR #32, merge commit `2aa32a0`.

## Batch 4: performance

### #16 402 KB icon and render-blocking Google Fonts

Measuring first changed what this issue turned out to be.

**The fonts were already efficient, and that is not what was wrong.** The issue
asks to confirm all five requested DM Sans weights are used, and to consider
self-hosting. Only four weights are used, 400, 500, 600 and 700; weight 300 appears
nowhere in the stylesheet. But trimming it saves nothing at runtime, because Google
was already serving DM Sans as a single **variable** font. A network trace of `main`
shows two font files totalling 87,531 bytes, not five weights. So the real cost was
never the font bytes: it was the two extra origins, the DNS lookups and TLS
handshakes, and a render-blocking stylesheet that had to arrive before the font URLs
were even known.

Self-hosted both families as the same variable woff2 builds Google serves, with the
`@font-face` descriptors and `unicode-range` splits copied verbatim so rendering is
unchanged. They live in `fonts/` rather than `public/` on purpose: relative `url()`
paths from `css/style.css` are what gets them content-hashed like everything else.
Both the latin and latin-ext subsets ship, so latin-ext still only downloads when a
visitor's content needs it.

Static weights were measured as the alternative and rejected: four static DM Sans
weights plus DM Serif Display come to 256,188 bytes across ten files, against
129,564 across four for the variable builds.

**The icon was compressed losslessly, not quantised.** The instruction for this
issue was to keep visual output identical, so every candidate was measured against
the original pixel by pixel:

| Approach | 512px icon | Max channel delta | Pixels differing by >2/255 |
|---|---|---|---|
| lossless re-encode | 309,232 | 0 | 0.00% |
| libimagequant 256 | 169,270 | 37/255 | 12.87% |
| libimagequant 128 | 135,112 | 54/255 | 17.64% |
| median cut + dither 256 | 194,630 | 68/255 | 13.23% |

Quantising is not identical, so it was not taken. These icons carry noise: the
512px file holds 28,531 distinct colours for what looks like flat artwork, and any
palette reduction shifts that noise visibly in the numbers. The lossless route drops
the alpha channel, which every icon carried at a constant 255, and re-encodes at
maximum compression. Pixel identity is asserted programmatically, not eyeballed.

Byte counts:

| | before | after | change |
|---|---|---|---|
| all icons in `dist/` | 611,214 | 486,303 | -124,911 |
| `android-chrome-512x512.png` | 411,246 | 309,232 | -102,014 |
| first-visit payload | 158,052 | 146,508 | -11,544 |
| third-party origins | 2 | 0 | -2 |
| requests on first visit | 8 | 7 | -1 |
| `dist/` total | 642,759 | 648,529 | +5,770 |

`dist/` grows because the 129,564 bytes of fonts now live in the repo instead of on
Google's servers, which the icon savings nearly offset. The first-visit number is
the one that matters, and it falls. The 512px icon is not part of a page visit at
all: only the install prompt and link-preview scrapers fetch it.

Verification:

- Layout diff against `main` at 390px, 800px and 1280px: **0 of 168 elements changed**
  at every width. Self-hosting the fonts did not move a single pixel, which is the
  strongest available evidence that the swap is invisible.
- A network trace confirms both families still resolve: `h1` renders in DM Serif
  Display 400, body in DM Sans 400, nav links 500, `strong` 600. A font that failed
  to load would silently fall back to Georgia and the system sans and still look
  plausible in a screenshot.
- `npm run smoke`: 16 checks, up from 14. Two new ones fail the build if any
  third-party subresource reappears, or if the four woff2 files stop being hashed,
  stop existing, or stop being real woff2. Both negative-tested.
- The 19-check keyboard suite still passes.

Deliberately not done, and worth a decision: dropping the 512px icon to roughly
169 KB is available for a maximum channel delta of 37/255 on 13% of pixels. At the
sizes this icon is actually displayed that is very likely invisible, but it is not
identical, and identical is what this issue was scoped to. Say the word and it is a
one-line change.

Merged as PR #33, merge commit `f997df2`.

## Batch 5: repo hygiene

### #12 Leftover HTML5 Boilerplate, and #14 repo hygiene

Done together: both are scaffold residue, and separating them would have split a
four-line `package.json` edit across two reviews.

**#12.** `LICENSE.txt` said `Copyright (c) HTML5 Boilerplate`. It now names the
holder `package.json` already declares, with the year the site footer already
declares. MIT is unchanged; only the attribution line was wrong. The `robots.txt`
scaffold comment is gone, with crawl behaviour untouched, since that is #18's call
to make rather than a cleanup decision.

`404.html` was the stock boilerplate error page: grey sans on white, no branding, no
way back to the site. Rebuilt to match the site, and kept standalone with inline
styles for the reason the issue gives, that an error page has to render when the
stylesheet is the thing that failed. That decision has a consequence worth writing
down: it cannot use the self-hosted webfonts, because their `@font-face` rules live
in the hashed stylesheet and hashed filenames must never be hardcoded. So it renders
in Georgia and the system sans, which are the same fallbacks `css/style.css` already
declares behind DM Serif Display and DM Sans. The colour tokens are copied from
`:root`, which is a duplication the file comments call out.

**#14.** `.idea/` untracked and ignored, along with `.vscode` and the usual editor
noise. Node pinned two ways: `.nvmrc` at 24 to match CI, and an `engines` field.

The issue suggests `">=20"` for `engines`, which would be wrong. Vite 8 declares
`^20.19.0 || >=22.12.0`, so `>=20` would let Node 20.0 through and it would fail at
install. The pin matches Vite's actual floor.

`package.json` metadata: `version` dropped rather than given a convention, since the
package is `private` and never published. `npm ci` was tested against the regenerated
lockfile to confirm the field is genuinely optional before removing it. The
description said "St. Louis premier pickleball club website", which contradicts the
site copy positioning Gateway Smash as a grassroots alternative to corporate leagues,
explicitly not a premier club; it now matches the manifest description.

Both `.gitkeep` files are gone: `js/vendor/` was webpack-era residue with nothing
referencing it, and `public/img/.gitkeep` was shipping to `dist/img/.gitkeep` on
every deploy. The directory has real files now, so nothing needs holding open.

Also cleaned up the seven merged branches still sitting on the remote. Every
`gh pr merge --delete-branch` in this run failed its local step, because `main` is
checked out in another worktree, so the remote branches survived their merges.

Verification: `npm run smoke` is 17 checks, up from 16. The 404 check was upgraded
from "exists and is non-empty" to asserting it links home, carries inline styles,
depends on no external stylesheet, pulls in no third-party subresources, and
actually says Gateway Smash. Screenshots at 1280px and 390px. `npm ci` from a clean
lockfile. The 19-check keyboard suite still passes.

**One thing you have to do yourself.** The local branch `update-styling` is confirmed
merged into `main` (tip `6e490cd`) and can be deleted, but it lives in your working
copy rather than the repo, so no pull request can remove it:

```
git branch -d update-styling
```

Merged as PR #34, merge commit `a7e7400`.

### #13 No tests, no linting, npm test wired to fail

The issue's highest-value item, a build smoke test, already existed: it was built
during the Vite migration and has grown to 17 checks. What was left was the rest.

`npm test` no longer fails on purpose. It is now `npm run lint && npm run smoke`,
which is what CI runs.

**One of the issue's premises does not hold.** It says html-validate "would have
caught the wrong favicon MIME type". It does not, and this was tested rather than
assumed: reintroducing `type="image/svg+xml"` on a `.png` and running html-validate
passes clean, because the markup is structurally valid and only the claim about the
file is false. That check went into `scripts/smoke-build.js` instead, where it
belongs, and it does catch it.

html-validate still earns its place. Run against the two pages it immediately found
four real problems: a `<button>` with no `type`, which defaults to `submit` and is a
live bug the moment the page grows a form, and three raw `&` characters in feature
headings. All fixed. Its `doctype-style` rule is off, since lowercase `<!doctype
html>` is valid HTML5 and is what both this repo and Vite emit.

ESLint found nothing in `js/app.js`, which is the correct outcome: the null-guard the
issue predicted a linter would flag was added back in #1. It did catch four undefined
globals in the new link checker. Both configs were negative-tested by introducing an
undefined variable.

Dependency cost was measured before choosing rather than assumed, each in a clean
directory:

| Tool | Packages | Adopted |
|---|---|---|
| html-validate | 10 | yes |
| eslint | 53 | yes |
| stylelint | 95 | no |
| prettier | 1 | no |

stylelint costs 95 packages to lint a hand-written stylesheet that has produced no
defects. Prettier is only one package, but running it would reformat every file in
the repo, and `.editorconfig` already encodes the formatting rules that matter. Both
rejections are recorded in `CLAUDE.md` so the question does not get relitigated.

Outbound link checking is `scripts/check-links.js`, dependency-free, using built-in
`fetch`. It is **not** in `npm test`, on purpose: every link points at a third party
that can rate-limit or block a runner IP, and a pull request that goes red for that
reason teaches people to ignore red. It runs weekly instead, with manual dispatch.
All three links currently resolve: the Global Pickleball Network registration, the
Notion FAQ, and the WhatsApp invite.

CI now takes its Node version from `.nvmrc` rather than a hardcoded `'24'`, so the
pin added in #14 cannot drift from what CI actually runs.

Merged as PR #35, merge commit `0f63157`.

## Batch 6: SEO and metadata

### #9 SEO gaps, and the parts of #18 that are not mine to decide

**#9 is done.** The canonical origin is `https://www.gatewaysmash.com/`, which was
already settled by #2 and confirmed by #18's live check of the non-www to www
redirect, so nothing here was blocked on it.

Added `rel=canonical`, a real `og:url`, `og:description`, `og:site_name`,
`og:locale`, the four Twitter Card tags, and `og:image:width`/`height`. `og:image`
and `twitter:image` are now absolute, because scrapers do not resolve relative URLs.

`SportsClub` JSON-LD, containing only claims the page already makes: name and
description from the head, email from the Contact section, venue and municipality
from the League Info list. Deliberately absent are `streetAddress` and `telephone`,
which appear nowhere on the site, and `sameAs`, since there are no social profiles to
point at. Also absent are per-season `SportsEvent` entries, which is what would make
the schedule eligible for event rich results: marking up dates that #10 says are
stale would be worse than not marking them up at all.

`sitemap.xml` with the single URL, and a `Sitemap:` line in `robots.txt`, which is
how search consoles discover it.

Four new smoke checks, five negative tests. One of those negative tests earned its
keep: the check that JSON-LD claims match the page was **vacuous on the first
attempt**. It searched the whole document for the email, and the document contains
the JSON-LD block, so substituting a fake address still passed. It now searches the
page with the block removed, and covers the venue name too. That is exactly the
failure mode `CLAUDE.md` warns about, and it only surfaced because the check was
deliberately broken to see if it would notice.

Two existing checks also had to be taught the difference between a URL and a
subresource, because making `og:image` absolute broke both: `rel=canonical` names a
URL without fetching it, and a same-origin absolute URL still resolves inside
`dist/`. Both were tightened rather than loosened.

**#18 is left open, and most of it is not a code change.** Its own priority list
starts with two items I should not and cannot do:

1. *The Cloudflare AI-crawler block.* `Google-Extended`, `GPTBot` and `ClaudeBot` are
   disallowed by a Cloudflare managed rule that is prepended to the served
   `robots.txt`. The repo's file is appended underneath it, so **editing anything
   here cannot lift it**. It is a dashboard setting, and hosting configuration is
   explicitly out of scope for this pass. Verified: the repo `robots.txt` disallows
   nothing.
2. *Bringing the FAQ on-site.* That is #20, which needs the Notion content.

The rest divides between other issues and decisions that need facts I do not have:
photographs of actual play, a street address, a phone number, social profiles, and a
1200x630 share image. `og:image` is still the square icon, and it is still the wrong
shape for a link preview, but a purpose-made share card is blocked on the same
unresolved question as the icon artwork below.

Merged as PR #36, merge commit `f38617b`.

## Batch 7: content

### #21 Copy edit, partial

The prose fixes are done. The numbers are not, because I do not have confirmed ones.

Done: sentence case throughout, except the `h1`, which functions as a wordmark and
stays. "Click here to join" is now "Join the WhatsApp group", which fixes a copy
problem and an accessibility one at once, since the old text read as nothing in a
screen reader's link list. Dashes used as general separators became commas or
parentheses; the en dashes in date and time ranges are correct typography and stay.

The hero, the About paragraph, and all three feature cards were rewritten to strip
copula avoidance ("offering", "offer", "foster"), adjective pairs on abstract nouns
("welcoming and supportive environment", "fair and fun competition"), false ranges
("from substitute coordination to post-match banter"), the "connection"/"connected"
bookend, and two of the three stacked rule-of-three lists. "Grassroots,
volunteer-run" appeared three times on one page and now appears once. Card headings
went from adjective pairs to descriptions: "How the ladder works", "Off the court".
"Chasing a 4.0" survived, since it is the one genuinely specific detail in the
original.

A copy style guide is now in `CLAUDE.md`.

**Not done, and this is the important part.** #21's central argument is that every
vague adjective on the page has a concrete fact behind it in the Notion FAQ. That is
true, and I have read the FAQ. I did not swap the numbers in, because the FAQ is
demonstrably stale: it describes a Fall league running Aug 10 to Sept 28, and it
routes every reader to **GroupMe**, which this project removed in favour of WhatsApp.
A price taken from that document could be equally out of date, and a wrong price on
the site is worse than a vague one. The specific claims awaiting numbers are in the
questions batch.

Everything else in batch 7 is blocked on those answers. #10, #19 and #20 all need
facts only the organizers have.

Merged as PR #37, merge commit `f591ec6`.

## Follow-up: brand icons

Answering the open question from #8. The decision was to derive the icon set from the
paddle mark the header already draws inline, rather than keep the inherited teal globe.

`public/icon.svg` is now the canonical vector, with geometry identical to the header
logo. Everything else is a raster export of it: the six PNGs, the multi-size
`favicon.ico`, and a 1200x630 `og-share.png` built with the real DM Serif Display and
DM Sans. The exports were drawn from the same primitives at 8x and downsampled, not
traced from a bitmap, which is why the 16px favicon still reads.

This also settles the #16 question that was left open. The choice offered was lossless
309 KB versus a lossy 169 KB for the 512px icon. Neither was the answer: flat vector
art compresses far better than the noisy inherited bitmap, so the 512 is now **35,310
bytes**, losslessly, an order of magnitude under either option.

| Asset | Before | After |
|---|---|---|
| `android-chrome-512x512.png` | 309,232 | 35,310 |
| `android-chrome-192x192.png` | 47,386 | 13,041 |
| `apple-touch-icon.png` | 42,745 | 12,872 |
| `maskable-512x512.png` | 68,754 | 28,765 |
| `favicon.ico` | 15,406 | 6,814 |
| `favicon-32x32.png` | 2,076 | 1,943 |
| `favicon-16x16.png` | 704 | 662 |
| `og-share.png` | did not exist | 42,549 |
| `icon.svg` | did not exist | 915 |
| **Total** | **486,303** | **142,871** |

343,432 bytes saved while *adding* a share card and a scalable icon.

Knock-on fixes: `og:image` and `twitter:image` now point at the share card at its real
1200x630, `twitter:card` is `summary_large_image` rather than `summary`, and
`icon.svg` is wired up as a scalable favicon, which #8 asked for and the site had
never had. One new smoke check reads width and height straight out of the PNG's IHDR
chunk and fails if the declared dimensions disagree with the file, or if the share
image is too small for a large card. Both negative-tested.

Merged as PR #38, merge commit `5ccbff3`.

## Follow-up: shared partials

The decision was to add templating rather than hand-copy the header across the pages
#18, #19 and #20 propose. `vite-plugin-handlebars` 2.0.3, published April 2026, one
devDependency, zero advisories.

`partials/header.html` and `partials/footer.html` are now the single source for the
nav and footer, pulled in with `{{> header}}`. `404.html` deliberately does not use
them: it carries its own inline styles and a cut-down header so it renders when the
hashed stylesheet is the thing that failed, and pulling in the site nav would undo
that. No new pages yet, since those are blocked on content.

Two things had to move as a consequence, and the second was a real bug the refactor
would otherwise have introduced silently:

1. **html-validate now runs against `dist/`, not source.** The source contains
   `{{> header}}`, which is not HTML. Validating the built output is more meaningful
   anyway, since that is what visitors receive.
2. **`check-links` now scans `dist/` too, and it was already broken.** After the
   extraction, the source `index.html` no longer contained the nav, so the Notion FAQ
   link stopped being checked. The failure was invisible: the total still read "3
   links" because the newly added canonical URL took its place in the count. It now
   scans built output and fails outright if it finds fewer links than expected, so a
   future refactor that moves links out of view cannot quietly reduce coverage again.

Verified by editing the partial and confirming the change appears in `dist/index.html`
and disappears when reverted, plus negative tests for a missing `dist/` and for
coverage dropping below the floor.

Merged as PR #39, merge commit `c0d4c51`.

## Batch 7 continued: confirmed pricing

Two figures came back corrected: **$70 for eight weeks** (the Notion FAQ says $50) and
a **56-player cap** (the FAQ says 32). Both are now on the site.

The price is the answer to the first question a prospective player has, and the site
had never stated it. It now appears in the hero, in the League info list alongside the
day, time, venue and courts, and in all three description tags, replacing the word
"affordable" that #21 flagged. The roster cap sits next to it.

Two new smoke checks, both negative-tested, guard drift this change introduces:

- The three description tags must agree. The same sentence is declared three times,
  and search results, link previews and X cards each read a different one.
- Every dollar amount on the page must be the same. A wrong price is the worst bug
  this site can ship, and the fee is now stated in more than one place. If a second,
  genuinely different amount is ever added, that check is the thing to update
  deliberately.

**This breaks the Notion FAQ's cost breakdown, which cannot be ported as-is.** That
section derives $50 from `$24/hour x 2 hours x 4 courts x 8 weeks = $1,536`, divided by
32 players, plus a PayPal fee. None of that arithmetic survives $70 and 56 players, and
it already disagreed with this site, which lists **five** courts (#5, #6, #7, #10, #12)
against the breakdown's four. I am not recomputing it: the court count, hourly rate and
hours are all facts I would be inventing. #20 needs either a current breakdown or a
decision to drop that section.

The refund policy has the same problem. It reads "if we don't reach 32 players, your
$50 will be refunded in full". Substituting 56 and $70 assumes the refund threshold is
still the roster cap, which happened to be true when both were 32. That is a policy,
not arithmetic, so it needs confirming rather than deriving.

Still unanswered from the #21 list: the ladder explanation (pods of four, three
rotating doubles matches), the skill range, and whether Elo still updates weekly.

Merged as PR #40, merge commit `51c359f`.

### #21 ladder mechanics

Confirmed: pods of four, three matches a night, Elo updating weekly. The "How the
ladder works" card used those words without explaining either, which was #21's
sharpest complaint about it. It now says what actually happens on a Sunday night.

"Partnering with each of the other three once" is not an extra claim; it is what three
matches in a pod of four means. "Beating someone rated above you moves you the most" is
both stated in the FAQ and inherent to how Elo works, so it is safe in a way the
league-specific configuration details are not. The FAQ's "only wins and losses count,
point differentials are not factored in" is a configuration choice rather than a
property of Elo, so it stays out until someone confirms it.

One claim from the #21 list is still open: the skill range. "All skill levels play" and
"chasing a 4.0" carry no range, and the FAQ self-rating guide runs 2.0 to 5.0+.

Merged as PR #41, merge commit `bdf7f67`.

### #21 skill range, and the issue closed

Confirmed range is **2.0 to 4.0+**, which is narrower at the top than the FAQ's
self-rating guide suggests (it runs to 5.0+). The site now states the confirmed range,
not the one in the stale document.

It appears in the first feature card, where it replaces the implied range, and in the
League info list beside cost and roster, which is where a prospective player scans for
exactly this.

The meta description deliberately keeps "open to all skill levels" rather than the
number, which is a departure from the style guide's "prefer a number to an adjective".
A description is read by strangers in a search result, where "2.0 to 4.0+" means
nothing unless you already know the rating scale. The number belongs on the page, where
there is context around it.

That closes #21 for the site copy. The issue also asks for the same pass over the FAQ
prose, roughly ten em dashes and the same rule-of-three constructions, but its own
instruction is to do that inside #20 rather than as a second edit later, so it travels
with the FAQ migration.

Merged as PR #42, merge commit `b5f54a7`.

## Batch 7 continued: #10 schedule status

Confirmed: Summer 2026 is running, Fall 2026 is next.

The table presented a finished season, a live one, and one nearing registration
identically, all under the heading "Tentative league dates". A visitor could not tell
what to do next.

Every status label is now **computed from the dates on each row** rather than written
by hand. Writing "Summer 2026, in progress" into the markup would be wrong the moment
the season ends, which is exactly the state #10 found this table in. Each row carries
`data-start`, `data-end` and `data-registration`, and `js/app.js` derives Completed,
In progress, Registration open or Upcoming from them, adds a Status column, tints the
running season, mutes finished ones, and writes a callout above the table.

Progressive enhancement on purpose: without JS the table renders as it always did with
real dates in it. The status column and callout are absent rather than empty or stale.
Crawlers see the dates, which are the content; status is ephemeral.

Also: every season label gained its year, the heading is "Season dates" since a
completed season is not tentative, and the footer year is no longer a January chore,
though the markup still ships the current year so a no-JS visitor sees a correct one.

Four new smoke checks, run against a frozen clock, because the real `Date` is whatever
day the build happens on:

- On 2026-07-31: Completed, In progress, Upcoming, Upcoming, with the callout naming
  Summer 2026 and giving Fall's registration date.
- Fall 2026 reads Upcoming on 2026-08-12 and Registration open on 2026-08-13, and the
  callout switches wording with it.
- Summer 2026 is still In progress on its final day and Completed the day after, not
  before.
- The generated column is a real `th` with `scope="col"`, and its cells carry
  `data-label`, without which they lose their label in the mobile card layout.

That last check exists because the keyboard suite caught the generated header: it went
to 18/19 with `["col","col","col","col","col","col"]`, which was a stale assertion of
exactly five headers rather than a real defect. The generated header does declare
scope.

Not done in this pass: the hero CTA still says "Join the League" without naming a
season, item 6 of the issue. Finished in the next entry.

Merged as PR #43, merge commit `fdd1b3f`.

## Batch 7 continued: #20 the FAQ moves on-site

Confirmed: remove the refund threshold, subs use the GPN waitlist, GroupMe is dead.

The FAQ now lives at `/faq/`, a directory rather than `faq.html` so the clean URL works
on any static host without a rewrite rule. It is the second real page on the site, and
the first use of the partials added in #39, so the header, nav and footer came for
free.

Ported from the Notion source with four substantive changes, all instructed:

- **GroupMe is gone.** Every reference now points at the WhatsApp group. The Notion
  page routed people to a chat that no longer exists.
- **The cost breakdown is gone**, so the site no longer publishes what Arch charges.
- **The refund threshold is gone.** What remains is "no refunds once registration
  closes, unless the whole league is cancelled". Note this reads harder than the
  original, which paired that line with a full refund if the roster did not fill.
- **Figures updated**: $70 not $50, 56 players not 32, range 2.0 to 4.0+.

Season dates are deliberately not repeated here. They live in one place, the schedule
on the homepage, which computes its own status; a second copy would be a second thing
to forget. The FAQ links to it instead. The GPN link is the network page rather than
the season-scoped ladder event the Notion page used, which pointed at a 2025 season.

Copy edited to the same style guide as the homepage: sentence case, no em dashes,
straight quotes, no rule-of-three padding.

The page is **819 words**. The entire site was 483 before it, so this roughly triples
the indexed content and adds a second indexable URL, which was #18's single
highest-leverage recommendation.

Three new smoke checks, all negative-tested:

- The FAQ page has its own canonical, exactly one `h1`, and an entry in `sitemap.xml`.
- The `FAQPage` structured data matches the visible page. Each question and the opening
  clause of each answer must appear in the rendered text **with the JSON-LD stripped
  out**, so the block cannot satisfy itself the way the homepage check once did.
- No built page links to Notion or mentions GroupMe.

That second check earned its place immediately: it failed on the first run because the
JSON-LD asked "When and where does the league play?" while the heading read "When and
where". Fixing the heading to match is also the better heading for search. It failed a
second time on an answer whose wording had drifted from the page.

Two adjustments fell out of adding a second page:

- Nav links in the header partial are now root-relative. `#about` only resolves on the
  homepage, and from `/faq/` those links went nowhere.
- `check-links` now skips our own origin. A canonical tag pointing at a page that is not
  deployed yet fails every time until it ships, which is noise rather than signal. That
  those files exist is already asserted against `dist/`. The checker exists for third
  parties that rotate underneath us.

Verified: both pages pass the keyboard suite. On `/faq/` the drawer is inert when
closed, the skip link moves focus to the page body, opening moves focus to the first
nav link, and Escape restores focus to the toggle. All four outbound links resolve.

Merged as PR #44, merge commit `bbb618f`.

## Batch 7 continued: #19 substitute page

Confirmed: subs are picked up from the GPN waitlist, WhatsApp is the admin channel, and
the blunt voice stays.

`/subs/` is the third page. The source copy in the issue is used close to verbatim, and
the tone is untouched: "No waitlist, no game", "no exceptions", "Please do not ask" all
survive intact. The copy style guide already says not to flatten that register, and the
instruction was explicit.

Only two edits were made, both factual rather than tonal, and both flagged by the issue
itself:

- *"Presumably, you joined this chat to play pickleball"* had no referent on a web page,
  where a first-time visitor has joined nothing. It reads "Presumably you are here to
  play pickleball, so follow through", which keeps the edge and loses the broken
  reference.
- *"Message an admin directly"* was a dead end without a channel. It now links the
  WhatsApp group, and stays a blocking step, because nobody is active as a sub until an
  admin adds them.

Also added the secondary call to action the issue asks for, in the Leagues section
rather than the hero, which already carries two buttons.

**One recommendation in the issue was not followed.** It suggests `HowTo` structured
data for the setup sequence. Google retired `HowTo` rich results in 2023, so that markup
produces nothing now. Adding it would be dead weight that reads like coverage. Skipped
deliberately.

The per-page smoke check was generalised rather than duplicated: it now walks `dist/`
for every `index.html` and asserts each has its own canonical, exactly one `h1`, a
`sitemap.xml` entry, and the shared header. A page added to `vite.config.js` is covered
the moment it builds, instead of needing someone to remember to write a check.

Verified: three pages all serve 200, six outbound links resolve, html-validate clean on
all four built pages, no console errors, and every `target="_blank"` carries
`rel="noopener noreferrer"`.

The keyboard suite went to 18/19 on the nav gaining a sixth item, which was a hardcoded
count in the check rather than a defect. Both that count and the nav link list are now
read from the page, so the next nav item cannot silently stop being checked.

Merge commit: pending

## Batch 8: #18, the parts that were left

#18 was filed as seven findings. Five of them have since been answered by other work,
and re-reading it against `main` at `8fd9228` was most of the job:

| Finding | State before this pass |
| --- | --- |
| 1 Cloudflare blocks AI crawlers | Dashboard setting. The repo `robots.txt` disallows nothing |
| 2 FAQ on Notion | Done by #20. `/faq/` is on-site with `FAQPage` markup |
| 3 One indexable URL | 1 to 3: `/`, `/faq/`, `/subs/`, all in `sitemap.xml` |
| 4 Headings in brand voice | Half done by #37. Title and About `h2` still carried no keyword |
| 5 Local SEO signals | Open. No address, phone, or `sameAs`, and two Locations disagreed |
| 6 Zero images | `og:image` is a real 1200x630 card now. Still no `<img>` anywhere |
| 7 Under 500 words | 483 to 1,744 rendered across three pages |

That left two things doable without inventing a fact, and both are done.

**The title said "STL".** Every other tag said "St. Louis", and searchers type the full
name, so the highest-value field on the page was competing for the wrong string while
nothing looked broken. It is now "Gateway Smash | Indoor Pickleball Leagues in St.
Louis", 54 characters, inside the roughly 60 that render before truncation.

**No `h2` carried a keyword.** The About heading was "Built by players, for players",
which tells a search engine nothing. It is now "Indoor pickleball leagues in St. Louis",
which is #18's own suggestion. The voice line was not cut: it opens the lead paragraph
underneath, where it reads as a sentence instead of as a wasted heading slot. The `h1`
was not touched, because it is a wordmark and the copy style guide says so.

Measured rather than eyeballed, since the new heading is longer. Headless Chrome at
1440, 768, 390, and 320 CSS pixels: no horizontal overflow at any width, and
`document.scrollWidth` equals the viewport in every case. At 320 the heading wraps to
three lines where the old one took two, 34px taller with nothing clipped. An alternate
break, "Indoor pickleball / leagues in St. Louis", holds two lines everywhere but splits
the compound noun, so the current break was kept deliberately.

**The two Locations disagreed.** Contact said "St. Louis, Missouri" and League Info said
"Arch Pickleball, Bridgeton", which are different municipalities. Contact now reads
"Arch Pickleball, Bridgeton, MO".

Three checks, each negative-tested by breaking the thing it guards:

- *the homepage names its city in the title and in a heading.* Both halves were proven
  to fail on their own: reverting the title alone reports the title, and reverting the
  `h2` alone reports the headings it did find. Without that second test the heading
  assertion would have been carried by the title and never observed failing.
- *every Location on the homepage names the same venue.* Fails from either side, tested
  by breaking Contact and then by breaking League Info separately. It anchors on the
  venue and locality in the JSON-LD rather than hardcoding them, so the three move
  together.
- *the structured data parses and matches the page*, strengthened. It already required
  the JSON-LD email and venue name on the visible page but not `addressLocality`, so
  Bridgeton could have been swapped for any suburb with every check still green.
  Negative-tested by swapping it for Chesterfield.

29 checks to 31. `npm test` exits 0 with 31 ok and 0 not ok.

**What is still open, and why none of it is a commit.** Photographs of actual play, a
street address, a phone number, and social profiles for `sameAs` all need facts or
assets that nobody has supplied yet. The address and social URLs were offered during
this pass but did not arrive, so nothing was invented: the JSON-LD rule in `CLAUDE.md`
means anything added there has to be visible on the page, and a made-up street number
would be visible and wrong. The Cloudflare AI-crawler block is a dashboard setting that
no commit in this repo can reach. Each is now its own issue.

**Splitting into `/leagues`, `/pricing`, and `/location` was declined.** #18 proposes it
under finding 3, but the substance of that finding, one indexable URL, was already
answered by going to three. Carving three more pages out of a 499-word homepage produces
thin pages competing with each other, which ranks worse than one page that covers the
topic. Worth revisiting if the content grows.

Merge commit: pending

## Batch 8 continued: #10 item 6, the hero CTA

The one part of #10 left open by #43. The button said "Join the League" while the
callout two sections below it said "Fall 2026 registration opens August 13, 2026",
so the page named a season everywhere except on the control a visitor was being
asked to click.

Decided before writing anything, because the issue left both questions open: the
`href` stays on the generic GPN page, which is the one URL correct in every season
and the same one the FAQ and subs pages use, and the label names the season in both
states rather than only once registration opens.

The button now reads "Join Fall 2026" with a line beneath it that says either
"Registration is open now." or "Registration opens August 13, 2026." Both strings
come from the same `nextRegistration` the callout already computed, so no season
name or date is written by hand. `aria-describedby` ties the note to the button, so
a screen reader reads the date with the control instead of only on the way past it.

Progressive enhancement, same as #43: the markup ships "Join the League" and an
empty `hidden` paragraph, so a no-JS visitor gets a correct season-neutral hero
rather than a gap. A season name in the markup would go stale the day that season
ends, which is the defect this issue is about.

**Three defects the review found, none of them in the new code, all of them made
worse by it.** The first two are in the status logic #43 added, which this change
promotes from a table two screens down to the primary control above the fold.

*The date was computed in the wrong timezone.* `today` read `getUTCFullYear`,
`getUTCMonth` and `getUTCDate` off a local `Date`, which yields the UTC calendar
day, not the visitor's. Every visitor west of UTC rolled over to the next day's
schedule during their evening. Reproduced against the built bundle at 19:30 Central
on August 12: the hero said "Registration is open now." for a registration that
opened the next morning. The same bug retired a season at 19:30 on its own closing
night, which for a Sunday-night league is during play. Now built from
`getFullYear/getMonth/getDate`, and pinned by a check that sets `process.env.TZ`,
which Node applies to `Date` immediately, so it needs no dependency.

*The next season was whichever row came first, not the soonest.* The `!nextRegistration`
latch took the first matching row in document order and nothing ordered the rows.
With the table listed newest-first, an ordinary edit to the most frequently edited
part of the site, the hero advertised Winter 2027 while the table beside it showed
Fall 2026 open. Now chosen by comparing start dates.

*`--amber-dark` failed WCAG AA.* It was 3.53:1 on cream and 3.77:1 on white against
the 4.5:1 that 14px text needs, so "Registration is open now.", the one sentence
telling a visitor they can act today, was the least readable text on the page.
Darkened to `#96550a`, 5.46:1 and 5.83:1. This also repairs the Registration open
row in the schedule, the colour's other use. A new check computes the ratios from
the built stylesheet, because nothing else in the build can see a contrast
regression: the markup stays valid and the text stays present.

Two smaller review fixes: the note is now inside `.hero-actions` next to the link it
describes, because when the group stacks on mobile it was rendering under the wrong
button, and the rename is gated on the note existing, since naming a season while
staying silent about whether it can be joined is worse than the label it replaced.

31 checks to 39, each negative-tested by breaking the thing it guards:

- The CTA names the season, the note gives the date, and `aria-describedby` links
  them. Proven to fail from each of the three assertions separately.
- The note switches to "open now" on the day registration opens and not the day
  before, and carries the modifier class that colours it. The class had no check at
  all until the review pointed out that renaming it ships the wrong colour silently.
- An evening visitor west of UTC is not told registration opened early, and a season
  is not retired on its closing night. Both fail if the `getUTC*` accessors return.
- The next season is the soonest one, tested with the rows listed newest first.
- `--amber-dark` clears 4.5:1 on cream and on white.
- With no season left to join, and separately with only a running season left, the
  shipped markup stands and no `aria-describedby` points at a hidden note.
- With the note absent, the button is not renamed.
- `dist/index.html` ships both ids, the `hidden` attribute, and the season-neutral
  label. The four stub-based checks above all pass without them, which is why this
  one reads the real built markup. Matched in two steps so attribute order does not
  matter, since a check that reddens on correct markup teaches people to edit it.

Verified in a real browser as well as in the vm: headless Chrome against
`vite preview` renders "Join Fall 2026" with the note and `aria-describedby` in the
post-JS DOM, switches to "Registration is open now." with the modifier class when the
registration date is pulled into the past, and reports no console errors. Desktop is
pixel-identical to before; mobile now binds the note to the Join button.

`npm test` exits 0 with 39 ok and 0 not ok, on a clean `npm ci`.

**Not done, and deliberately.** When a season is running and the next one has not
opened, the hero names the next season and says when it opens rather than mentioning
the season in progress. That is what the approved design asks for, but computing it
from the dates already in the table puts it at 310 of the 342 days on which one of
the six listed seasons is played, or 91%, and for Fall 2026, Winter 2027 and Spring
2027 it is the entire season, because the next registration opens after the current
season ends. So the CTA reads as a dead end for most of every season while "Subs play
free" sits in the paragraph above it. Filed as #51. Also unchanged:
14 `target="_blank"` links across the site carry no new-tab warning, which is
pre-existing and site-wide. Whoever fixes that should know the hero link sets its
label with `textContent`, which would silently wipe a visually-hidden span inside it;
append a second id to `aria-describedby` instead.

Merge commit: pending

## Batch 8 continued: #46 code of conduct

`/code-of-conduct/` is the fourth content page, following the shape `/faq/` and
`/subs/` set: a directory rather than a `.html`, both partials, and the existing
`page-section` / `container--prose` / `prose-list` classes with no new components.

The issue listed five open questions as the organizers' calls rather than copy
decisions, and all five were settled before drafting:

| Question | Settled as |
| --- | --- |
| On-court standards | All four candidates: line calls, sideline coaching, noise, playing to the level of the court |
| Harassment and discrimination | Plain prohibition, no catalogue of example behaviours |
| Reporting channel | `info@gatewaysmash.com`, handled discreetly, confidentiality explicitly not promised |
| Consequences | Removal on the table, organizers' discretion, no refund on removal |
| Venue rules | Arch Pickleball's own rules apply on top of the league's |

The confidentiality wording is the one worth remembering. More than one organizer
reads that inbox, so the page says "treat it as discreet rather than private" and a
smoke check fails if the word "confidential" ever appears on it. A code of conduct
that promises a confidentiality nobody can deliver is worse than one that does not
mention it.

No JSON-LD. No schema.org type fits a conduct policy, and the `FAQPage` check would
not cover it, so markup here would be dead weight that reads as coverage. Same
reasoning that kept `HowTo` off the substitute page in #19.

Linked from the footer rather than the nav, which was already six items and is the
path to joining. `partials/footer.html` had no links at all before this, so the
footer's first link needed a colour: `--cream` at 15.95:1 on `--ink`, checked at
4.5:1 because footer text is 0.85rem.

**A gap the issue did not mention, found in review.** `npm run smoke` named its four
pages to html-validate one by one. The new page was not in that list, so it built and
would have shipped without ever being structurally validated, and nothing would have
gone red. Confirmed by putting an `<img>` with no `alt` on the page and watching
`npm run smoke` report all checks passed. The command now takes `"dist/**/*.html"`,
quoted so the shell leaves the glob to html-validate, which puts it in the same class
as the per-page smoke checks: the next page is covered without anyone remembering.

Four checks added, each negative-tested by breaking what it guards: every content
page links to the page; the FAQ and subs link to it from their prose, with `<footer>`
stripped first so the shared link cannot satisfy it; the reporting address matches
the homepage and the page never claims confidentiality; and the footer link clears
4.5:1. The page floor moved from 3 to 4. Removing the footer link reports two pages
rather than four, because the FAQ and subs still hold their prose links, which is the
check working rather than a gap.

Verified: `npm ci` then `npm test` exits 0 with 43 ok and 0 not ok. All five pages
build, all four routes serve 200 under `vite preview`, the footer link and both prose
links navigate, no console messages on any page, and `npm run check-links` resolves
all 6 outbound links. Rendered at 1280 and at 390 wide.

Merge commit: pending
