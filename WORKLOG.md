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

Merge commit: pending
