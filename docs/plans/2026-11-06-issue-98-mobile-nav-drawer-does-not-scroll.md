# Plan: Mobile nav drawer does not scroll (issue #98)

Risk tier: Medium. A one-line CSS change, but it alters existing behaviour of a stateful
drawer that no unit test can exercise, so it needs a live drive.

Domain skills: chrome-devtools-mcp: invoke for the live drive. All others not applicable
because this is a static site with no framework, API, data or email change.

## Acceptance criteria

From the issue, verbatim:

- At 568x320 and 320x568, with JavaScript on, every nav link can be reached by touch
  scrolling and by keyboard, on all four content pages.
- Tabbing through the focus trap brings each focused link into view.
- The drawer, focus trap, Escape handling and `inert` sync otherwise behave as they do
  today, and the no-script panel still scrolls.
- A smoke check covers it and has been negative-tested.

From the orchestrator:

- The slide animation and focus trap are unchanged, and the JS drawer at 375x812 matches
  origin/main.

## Files that change

- `css/style.css`: add `overflow-y: auto` to `.nav-links` inside `@media (max-width: 768px)`
  and remove the copy from `.nav-links:popover-open`, with the comment that explains it.
- `scripts/smoke-build.js`: rewrite the check `an open popover scrolls on a short viewport`
  and rename it `the mobile nav scrolls on a short viewport`. It requires `overflow-y: auto`
  on the shared mobile `.nav-links` rule, and fails if that rule, `.nav-links:popover-open`
  or `.nav-links.open` sets `overflow` or `overflow-y` to anything else, so both states stay
  scrollable. The shared rule is in that loop too, since a second `.nav-links` rule in the
  block could otherwise undo the first. Correct its comment.
- `CLAUDE.md`, the "That rule alone sets `overflow-y: auto`" bullet: correct it, since the
  declaration now sits on the shared rule.

## Decision

The issue's clean version, approved by the orchestrator. The check being changed came from
review of #89, not from its ten frozen checks. Its old second half guarded a #89 scope limit
that this issue deliberately ends. Audit: in a scratch build, adding the shared declaration
and removing the `:popover-open` copy each turned exactly this one check red, so no other
check asserts the old state.

## Order of work

1. Red: rewrite the check and run `node scripts/smoke-build.js` after a build. It fails on
   the unfixed stylesheet, naming the shared rule. Commit that alone.
2. Green: move the declaration, correct the CSS comments, run the full gate.
3. Negative-test, restoring after each: delete the declaration from the shared rule; add
   `overflow: hidden` to `.nav-links.open`; add `overflow-y: visible` to
   `.nav-links:popover-open`. Each goes red naming the rule.
4. Live drive, below.
5. Correct `CLAUDE.md`.

## Risks

- `overflow-y: auto` makes `overflow-x` compute to `auto`, so a wide element could add a
  sideways scrollbar. Measure `scrollWidth` against `clientWidth`.
- The panel is transformed and fixed. Confirm the slide and the closed state are unchanged.
- At 320px tall the 100px top padding leaves little room. The issue asks whether it needs
  reducing. Measure first and change it only if a link cannot be reached.
- The drawer sits at z-index 105 and the toggle at 110, so scrolled links pass under the
  toggle. Confirm a focused link is not covered by it.
- `body.menu-open` has no scroll lock in `css/style.css`, although the issue calls the page
  locked. Scrolling past the end of the drawer may chain to the page. Drive it and report
  what happens. Do not add `overscroll-behavior`: if the page moving is a real problem,
  return it as a finding.

## Proof

- Smoke: the rewritten check is red before the fix and red under all three negative tests.
  Only that check is frozen, by name.
- Chrome at 568x320, 320x568 and 375x812 on `/`, `/faq/`, `/subs/` and `/code-of-conduct/`,
  with touch emulation if available: every link reachable by scrolling, Tab and Shift+Tab
  cycle through toggle and links with each focused link in view, Escape closes and returns
  focus to the toggle, `inert` syncs.
- The JS drawer at 375x812 compared with an origin/main build.
- The no-script panel still scrolls at 568x320.

## Review decision

Both finders reported that the check misreads the shorthand the minifier emits, so
`overflow-x: hidden` or `overflow: auto` on the shared rule goes red with a misleading
message. It fails safe. The orchestrator declined a rewrite of the frozen check, so the
gap is documented in `CLAUDE.md` and the PR instead.
