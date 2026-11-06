# Plan: Mobile nav is unusable without JavaScript (issue #89)

Risk tier: Medium. Stateful UI a unit test cannot fully exercise, and it alters existing
behaviour in the header shared by all four content pages. Small file count, no auth, money
or data.

Domain skills: chrome-devtools-mcp:chrome-devtools and a11y-debugging: invoke (real browser
drive of four states). superpowers:test-driven-development: invoke. frontend-design: not
applicable, no new visual design. All others: not applicable, static site with no framework.

## Decision: native popover, not either fix the issue offers

The issue offers two fixes and says "pick one". Its acceptance criteria are outcomes, and
neither offered fix meets the run's constraints. This plan uses a third, and that is the
decision to approve.

| Option | JS users pay nothing | No inline script | Module fails | Stale HTML (CSS and JS 404) | Verdict |
| --- | --- | --- | --- | --- | --- |
| `no-js` class removed by the module | No. Expanded nav until the deferred module runs, a flash and layout shift on every mobile load | Only with an inline script, which the static CSP documented in CLAUDE.md (not yet applied) forbids | Yes | Yes | Rejected |
| `<noscript>` only | Yes | Yes | No | No | Rejected, misses the case the issue calls most common |
| `<details>`/`<summary>` | Partly | Yes | Yes | Yes | Rejected. A closed `<details>` hides its contents on desktop too. Showing them needs `::details-content`, a recent feature, so an older browser loses the desktop nav. Also replaces the real button |
| CSS timed reveal, cancelled by a class from the module | No on slow links | Yes | Yes, after a delay | Yes | Rejected, a guessed timeout |
| **`popover` + `popovertarget`** | **Yes, measured** | **Yes, no script at all** | **Yes** | **Yes, with button text** | **Chosen** |

`<button popovertarget="nav-links">` toggling `<ul id="nav-links" popover>` is browser
behaviour with no script: it opens and closes, Escape closes and returns focus, and the
toggle exposes expanded state natively. Outside tap light-dismisses in Chrome but is not
relied on, see "Changes after approval". With JavaScript, the
module's first act strips both attributes, so the DOM the existing drawer code runs against
is the one it runs against today, and none of that code changes. It is the same path for
JS off and module failed, because neither involves any script.

Prototyped in a scratch copy and driven in Chrome before writing this, at 375px unless noted:

- Module blocked: 6 of 6 links hit-testable, toggle reads `expandable expanded`, Tab reaches
  Home, Escape closes and returns focus to the toggle.
- Tap before a module delayed 3s: the open popover hands off to the JS drawer (`.open`,
  `aria-expanded="true"`, focus on Home).
- Module delayed 3s, 1280px: nav rect and first link position identical before and after the
  module, and identical to an unpatched origin/main build. Layout-shift entries identical on
  both builds and none has a nav source (they are the pre-existing hero reveal).
- CSS and JS both 404: see Risk 1. `html-validate` accepts both attributes.

## Acceptance criteria

From the issue:

1. With JS disabled at 375px, all six nav links are reachable and operable by touch and
   keyboard on every content page.
2. With JS enabled, the drawer, focus trap, Escape handling and `inert` sync behave as they
   do today.
3. A smoke check covers the no-JS state and has been negative-tested.

From the orchestrator:

4. Criterion 1 also holds when the module fails to load, with JavaScript on.
5. JS users pay nothing: no flash and no layout shift from this change at any width.
6. No inline `<script>` and no inline style is added to any page.
7. CLAUDE.md is updated where the header, nav or progressive-enhancement text changes.

## Approval conditions

Approved by the orchestrator with these conditions, which are binding on the work below:

- Limits 1, 2 and 4 under Risks are accepted, and CLAUDE.md must record them as deliberately
  accepted. Limit 3 was accepted here at first and has since been removed, with the
  orchestrator's approval, see "Changes after approval".
- Every prototype result is repeated on the real build across all four content pages, plus
  the two not yet run: a real JS-disabled context, and the mobile layout-shift comparison
  against origin/main.
- The smoke check must fail if the popover wiring is removed from the built header, including
  when only one half goes (`popover` without `popovertarget`, the reverse, or a mismatched id).
- The JS-side stripping must be proved through `runBundle()`, because a popover left in place
  alongside the JS drawer is the regression to guard.
- A mid-implementation change that alters limits 1, 2 or 4 or criteria 1 to 7 returns BLOCKED.

## Files that change

- `partials/header.html`
- `css/style.css`
- `js/app.js`
- `scripts/smoke-build.js`
- `CLAUDE.md`

`404.html` is out of scope, it does not use the partials. `vite.config.js`, `check-links.js`
and the sitemap do not change, no page or outbound link is added.

## Order of work

1. **Smoke checks first, red.** Add these to `scripts/smoke-build.js`, all reading built
   output. Page-markup checks loop `CONTENT_PAGES`, strip HTML comments first (#69), are
   attribute-order independent, and name the failing page.
   - `every content page opens the mobile nav without JavaScript`: `#menu-toggle` has
     `popovertarget` equal to the id of `#nav-links`; `#nav-links` has `popover` empty or
     `auto` (not `manual`, which loses Escape and light dismiss) and no `hidden`; it contains
     a link to `/faq/`, the page the issue says goes unreachable.
   - `the menu toggle is usable before any script runs`: the built `#menu-toggle` has
     non-empty text content after tags are stripped, has no `aria-expanded` attribute (a
     static value overrides the native state and lies to a screen reader), and has no
     `aria-label` (the visible-without-CSS text is its name until JS writes one).
   - `the stylesheet opens the drawer for a popover`: in the `max-width:768px` block of the
     built stylesheet, `.nav-links:popover-open` sets `visibility:visible` and a transform
     that is not off-canvas; a `.nav-links::backdrop` rule exists.
   - `:popover-open never shares a selector list with .nav-links.open`: an unknown
     pseudo-class invalidates its whole rule, so a minifier or editor merging the two would
     silently kill the JS drawer in any browser without popover support.
   - `the desktop nav overrides the popover user-agent styles`: the base `.nav-links` rule
     outside any media query declares `display:flex`, `position:static`, and resets for
     `inset`, `width`, `height`, `margin`, `padding`, `border`, `overflow`, `color` and
     `background`. Without it the desktop nav vanishes until the module runs.
   - `the bundle removes the popover attributes before the drawer takes over` and
     `the bundle sets the toggle's label and expanded state`: via `mountHeader`, with
     `popover`/`popovertarget`/no aria attributes set on the stubs first. Extend the stub only
     as far as needed. Note `mountHeader` builds its stubs with no attributes, so assert
     against stubs seeded with the shipped attributes, or the removal check cannot fail.
   - `an open popover hands off to the drawer`: stub nav reports `popover` in it and
     `matches(':popover-open')` true; after the bundle runs, `.open` is set.
   - Two added beyond this list, both green guards in the red commit:
     `the hamburger X still lands on the bars` (see step 2) and
     `a browser without popover still gets the drawer`, which proves the `in` guard in step 4
     by making `matches()` throw.
   Commit red.
2. **`partials/header.html`.** On the button: remove `aria-label` and `aria-expanded`, add
   `popovertarget="nav-links"`, add `<span class="visually-hidden">Navigation menu</span>`
   as the **last** child, not the first as this plan originally said: the X animation counts
   the bars with `:nth-child`, so a span ahead of them breaks it. On the `ul`: add `popover`.
   Rewrite the comment to say what JS writes and why the markup omits it.
3. **`css/style.css`.** Base `.nav-links`: add the resets listed above, with a comment that
   these override the UA `[popover]` rules for the page before the module runs. In the 768px
   block: add `.nav-links:popover-open` as a **separate** rule starting from the same three
   declarations as `.nav-links.open`, plus `overflow-y: auto` (see "Changes after approval"),
   with a comment that it must stay separate, and
   `.nav-links::backdrop { background: rgba(28, 28, 28, 0.3); }` matching the JS overlay. Do
   not add a popover version of the hamburger X: the toggle is visible while open, dimmed by
   the backdrop, and staying a hamburger with no script is a known, accepted detail.
4. **`js/app.js`.** Immediately after the null guard:
   ```js
   var wasOpen = 'popover' in nav && nav.matches(':popover-open');
   nav.removeAttribute('popover');
   toggle.removeAttribute('popovertarget');
   toggle.setAttribute('aria-label', 'Open navigation menu');
   toggle.setAttribute('aria-expanded', 'false');
   ```
   and after the existing final `syncInert()`: `if (wasOpen && mobile.matches) { openMenu(); }`
   (`mobile.matches` added after review, see "Changes after approval"). The `in` guard
   is required: `matches(':popover-open')` throws a SyntaxError where the selector is unknown,
   which would stop this IIFE. Comment why. No other drawer code changes.
5. Gate, negative tests, live drive, CLAUDE.md.

## Risks

1. **Stale HTML, both hashed assets 404. Riskiest case, and the design has to survive it.**
   Without the stylesheet the UA hides `[popover]` and the toggle's three spans are empty, so
   a popover-only version would be strictly worse than today. The `visually-hidden` text is
   what fixes it: the button renders as a plain "Navigation menu" button that opens a UA-styled
   popover. Driven in the prototype: button visible, 6 of 6 links hit-testable. **Accepted
   regression, named:** in this state the list was on the page and is now one tap away. The
   only way back is an inline style, which constraint 2's reasoning rules out.
2. **Same-page links with no JS.** `/#about` on the homepage scrolls behind an open drawer,
   because nothing closes a popover on an in-page link. The toggle or Escape closes it.
   Accepted: the link works, `popovertargetaction` does not exist on anchors, and CSS cannot
   close it. Links to other pages are unaffected. Documented in CLAUDE.md.
3. Removed. This limit accepted the panel covering the toggle, with outside tap as the close.
   See "Changes after approval". The number stays so limit 4 keeps its name.
4. **Browsers without popover** (before Chrome 114, Safari 17, Firefox 125) with no working
   module keep today's dead button. Not a regression: `'popover' in nav` keeps the JS path
   intact for them. Stated in CLAUDE.md as a floor.
5. **Crossing the breakpoint with the no-JS popover open.** The JS path has a handler for
   this and the popover path cannot. Drive it and record what happens, Escape must still close.
6. **Interaction with #90 or #91.** This adds no `text-decoration: none`, inline script or
   inline style, so neither's new rule fires. Both landed first and this rebased cleanly. The
   nav links keep their underline opt-out through the existing `.nav-links a` entry.

## Changes after approval

None of these alters limits 1, 2 or 4 or criteria 1 to 7. Limit 3 was removed, as follows.

- **Two frozen checks rewritten, with approval.** The user's words, relayed by the
  orchestrator: "yes, rewrite the frozen checks for #89 and #90". It covers exactly
  `the whole page behind an open popover is out of reach and the header is not` and
  `the no-script panel leaves the toggle uncovered`, once. Reason: review drove inputs
  that passed both. The tap check matched names by substring, so `.section-header a`, a real
  class inside `main`, read as the header, and it compared `none!important` as a different
  value, so `.menu-toggle{pointer-events:none!important}` left the nav unopenable. The toggle
  check read `nav`'s height and not the header's, so `header{padding-top:24px}` put 16px of
  the toggle under the panel, and it went red falsely on `.nav-links.open`, which never applies
  alongside `:popover-open`. Both are frozen again.

- **Known false reds, the user's decision.** The user's words, relayed by the orchestrator:
  "yes to both, document the gaps and ship". `the no-script panel leaves the toggle uncovered`
  goes red on `header.scrolled` rules setting height or padding, though `.scrolled` only arrives
  after the module strips the popover, and on header height or padding rules that apply only
  above 768px, where no toggle shows. Both fail safe and are recorded in CLAUDE.md. They are the
  two the owner accepted, not a full list of what the check can over-refuse. No follow-up issue
  is being filed.
- **Comment reworded beside the rewrite.** The comment above
  `the page behind an open popover does not take the tap` was reworded with the rewrite, to give
  the toggle as the reason the header stays live. No logic changed.
- **Limit 3 removed, approved by the orchestrator.** iOS and iPadOS shipped popover without light
  dismiss (WebKit bug 267688, https://bugs.webkit.org/show_bug.cgi?id=267688, reported fixed in
  Safari 18.3 beta and reproduced before that from iOS 17), so with the toggle covered there was
  no working close on those devices with no script. The orchestrator approved removing the limit
  under its condition that a change altering the limits comes back for a decision, and chose to
  move the panel below the header. `.nav-links:popover-open` now sets `top` and `height`
  from a new `--header-height` token, which the `nav` rule also reads and the 480px `:root`
  override changes, plus a smaller `padding-top`. The toggle is the close control and outside
  tap is not relied on. iOS Safari is not available here and stays undriven. New checks:
  `the no-script panel leaves the toggle uncovered` and
  `the whole page behind an open popover is out of reach and the header is not`.

- **`tagAttributes` refactor.** `linkAttributes` now calls a shared `tagAttributes`, used by
  the header checks too. One parser rather than two, and its value pattern follows the
  opening delimiter, because the old one was the `[^"']*` class CLAUDE.md rules out for new
  reads.
- **Checks added in the first pass:** `the hamburger X still lands on the bars` and
  `a browser without popover still gets the drawer`.
- **Checks added from review**, beside the ten frozen ones, none of which changed:
  `the page behind an open popover does not take the tap`,
  `an open popover is not handed to the drawer at desktop width`,
  `an open popover scrolls on a short viewport`,
  `the bars sit where the X counts them among all the toggle children` and
  `the toggle both opens and closes its popover`.
- **`:has()` rules.** `body:has(.nav-links:popover-open) main` and `... footer`, one rule each,
  set `pointer-events: none` in the 768px block. The UA forces `pointer-events: none` on a
  popover's `::backdrop`, so a tap on the strip closed the drawer and activated the page.
- **`overflow-y: auto` on `.nav-links:popover-open` only.** The base reset removed the UA's
  overflow, so a short viewport could not reach the lower links. That rule is therefore no
  longer the same three declarations as `.nav-links.open`. The JS drawer has the same clip,
  which predates this and stays as it is.
- **`wasOpen` handoff requires `mobile.matches`.** A popover carried past the breakpoint
  before the module landed became drawer state on the desktop nav.

## What this deliberately does not do

- No hamburger X in the no-JS state, a known and accepted detail, see step 3. No scroll lock:
  the JS drawer has none either, and limit 2's same-page links need the page to scroll.
- No `@supports` fallback for old browsers. It cannot tell whether JS ran, so it would show
  the expanded list to JS users, which is the flash this plan exists to avoid.
- No change to the drawer's open, close, trap, Escape or outside-click code.

## Proof

| Criterion | Proof |
| --- | --- |
| 1 | Live drive, JS off via a real JS-disabled context at 375x812 on `/`, `/faq/`, `/subs/`, `/code-of-conduct/`: touch open, 6 of 6 links hit-tested, one followed; keyboard Enter, Tab through all six, Escape. Smoke check 1 for all four pages |
| 2 | Live drive, JS on at 375px, plus the JS drawer's geometry and computed `top`, `height` and `padding-top` equal to origin/main: open, focus on Home, Tab and Shift+Tab cycle includes toggle, Escape closes and refocuses, outside tap, link tap, `inert` present when closed, absent when open and at desktop width, breakpoint crossing while open. Existing `runBundle` checks stay green |
| 3 | Each new check broken in turn, see below |
| 4 | Live drive with module 404 and JS on, same script as criterion 1. Also CSS and JS both 404 |
| 5 | Live drive with module delayed 3s at 375px and 1280px: `PerformanceObserver` layout-shift sources contain no nav node, with one qualification: one 0.0012 entry on `/code-of-conduct/` at 1280 has `nav-links` among its sources, identical on origin/main. Geometry before and after module equal, and equal to origin/main |
| 6 | Existing no-inline-script checks plus `grep` of `dist/` |
| 7 | CLAUDE.md diff: js/app.js bullet in Project Structure, partials note under Pages, and a section under Pages recording this table, the stale HTML case and the accepted limits |

Negative tests, each run alone against `dist/` or source, and each must go red naming the
page or rule: delete `popovertarget`; mistype its value; delete `popover`; set
`popover="manual"`; wrap the `ul` tag's popover copy in a comment; add `aria-expanded="false"`
back; remove the `visually-hidden` span; delete `.nav-links:popover-open`; delete the
`display:flex` reset; merge `.nav-links.open,.nav-links:popover-open`; delete the bundle's
`removeAttribute` lines; delete `if (wasOpen)`; break one page only by editing its built HTML,
to prove the loop reads every page rather than the homepage.

Added in review:

- `the page behind an open popover does not take the tap`: delete the main rule; delete the
  footer rule; extend it to the header.
- `an open popover is not handed to the drawer at desktop width`: drop `mobile.matches`.
- `an open popover scrolls on a short viewport`: drop `overflow-y`; move it to the shared rule;
  add it to `.nav-links.open`.
- `the bars sit where the X counts them among all the toggle children`: first child `<svg>`,
  `<b>`, void `<img>`, and an svg with a nested path.
- `the toggle both opens and closes its popover`: `popovertargetaction` of `hide` and `show`,
  with `toggle` as a green control.
- `the no-script panel leaves the toggle uncovered`: delete `top`; `top:0`; literal height on
  `nav`; delete the 480px override, with and without `nav{height:60px}`; height not subtracting;
  height deleted; override on `nav`; `#nav-links{top:0}`; `.nav-links{top:0!important}`; `top` on
  the shared rule; `padding`, `padding-top`, `padding-block`, `height` and `min-height` on
  `header`, `header nav` and `#site-header`, including inside a media query; `min-height` on
  `nav`; `#nav-links`, `ul.nav-links`, `.nav-links.active` and `.nav-links[popover]` setting
  `top` or `height`. Green controls: `.nav-links.open{height:100svh}`, `nav{padding:0 30px}`.
- `the whole page behind an open popover is out of reach and the header is not`: main rule
  narrowed to `main .hero-bg`; `main h1` plus `footer p`; `:not(main)`; `main a` or
  `.hero-actions a` set to `auto`; `.section-header a` and `.footer-logo` set to `auto`; `none`
  on `#site-header`, `.menu-toggle` and `[id=site-header]`; `none!important` on `.menu-toggle` and
  `header`; `none` on `body`, `html`, `body>*` and `body:has(...)`; rule moved out of the mobile
  block. Green controls: `#site-header{pointer-events:auto}`, `.menu-toggle{pointer-events:auto}`,
  `.section-header a{pointer-events:none}`, `.footer-logo{pointer-events:none}`.

Both rewritten checks fail at the merge base, with only them and their CSS helpers applied to
a scratch copy of it:

```
merge base 5f6095b505193c47f3d408cb121366c2b13dab08
exit 1
not ok - the no-script panel leaves the toggle uncovered
not ok - the whole page behind an open popover is out of reach and the header is not
2 smoke check(s) failed:
  the no-script panel leaves the toggle uncovered: a nav rule sets height to 72px rather than var(--header-height), so the header and the panel can disagree
  the whole page behind an open popover is out of reach and the header is not: the rules behind an open popover select [], not exactly ["body footer","body main"]
ok lines 76
```

`ok lines` counts the other checks at that commit, which pass. On HEAD every listed input goes
red on the check named above, and every control stays green. One earlier negative test moved:
`.nav-links.open{top:40px}` is now green by design, because that selector left the loop.

Server for the module states, not committed: a small static server in the session scratch
directory that 404s or delays `*.js`, and 404s `*.css`. Use `vite preview` for the plain JS-on
drive.
