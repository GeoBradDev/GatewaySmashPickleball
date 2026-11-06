# Plan: GPN link in "Off the court" is distinguished by color only (issue #90)

Risk tier: Medium. Starts Low; raised one for altering existing behavior (the base `a`
rule every page inherits). Not raised for testability: the cascade is readable statically,
and the rendered result is confirmed by the live drive.

Domain skills:
- chrome-devtools-mcp:a11y-debugging: invoke (axe run, computed styles, vision emulation).
- frontend-design: not applicable, the existing underline treatment is reused, no new design.
- Everything else (django, expo, react, claude-api, ...): not applicable, static Vite site.

## Acceptance criteria

1. The link in "Off the court" is underlined, or otherwise distinguished by something other
   than color.
2. axe-core reports no `link-in-text-block` violation on any page, at 375px and 1440px.
   axe-core is NOT added to the repo; it runs ad hoc against a local build, output in the PR.
3. A smoke check stops a future in-prose link from shipping as color-only. It stays
   dependency-free, asserts its own floor, and is negative-tested by removing the rule and
   by adding a new in-prose link in an uncovered context. Revised at plan approval: the
   check holds the underline default and an allowlist of opt-outs, rather than modelling
   the cascade.
4. No link gains an underline it should not have: nav, buttons, logo, skip link. Proved by
   diffing computed `text-decoration-line` for every `<a>` on every page before and after.

## Decision: both fixes, base rule first

Make the underline the default on the base `a` rule, AND add `.feature p a` for the house
treatment. Reasons:

- `.feature p a` alone fixes this link and leaves the defect's cause: the base rule strips
  the cue and each prose context has to remember to restore it. Every other context did and this one
  did not. The next context would repeat that, and the smoke check would be the only thing
  in the way. With the default flipped, a new prose context is correct with no CSS at all.
- Opting out costs nothing: `.btn`, `.logo`, `.nav-links a` and `.skip-link` each already
  declare `text-decoration: none` at higher specificity than `a`. Those four are every
  non-prose link on the site. `.page-actions a` stays as it is, because it has to beat
  `.page-section a`.
- The base rule carries no `text-decoration-color`, deliberately. Moving the house
  `rgba(26, 122, 92, 0.3)` there leaks a green tint onto `.footer-links a` (cream on ink),
  which sets no decoration colour of its own, and leaves that link's underline close to
  invisible. Nothing checks that. `currentColor` is correct on any background, so the
  default stays safe in a context that does not exist yet. The tint belongs to the
  contexts, which is why `.feature p a` is still needed: it is the same declarations as
  `.league-sub-cta a` the issue names, and matches the links around it.

Not doing: deleting `.page-section a` or the other context underlines now that they
restate the default. They still set colour and weight, and the cleanup is out of scope.

## Files that change

- `css/style.css`: base `a`, new `.feature p a` and `.feature p a:hover`.
- `404.html`: a one-rule base `a` in its inline `<style>`. It has none today, and the
  smoke check treats a missing base rule as a failure. Its only links are `.logo` and
  `.btn`, which both opt out, so nothing on that page renders differently.
- `scripts/smoke-build.js`: one small helper set and one check.
- `CLAUDE.md`: Phase 8 only, a short section in Colour contrast or Checks.
- This plan.

## Order of work

1. Record the BEFORE state against the unchanged build: serve with `npm run build &&
   npm run preview`, run axe (below) on all five pages at 375px and 1440px, and dump for
   every `document.querySelectorAll('a')` on every page: page, href, classes,
   computed `text-decoration-line`, and whether it is visible. Keep the JSON in the scratch
   directory. Expect the single axe violation the issue reports.

2. TDD: write the smoke check first (spec below). Run `npm run smoke` against the unchanged
   CSS. It must go red on the base rule of both stylesheets (the hashed one sets `none`,
   `404.html` has none at all). Commit the red test on its own and freeze it
   (`.claude/fix-lock`).

3. CSS, `css/style.css`:
   ```css
   a {
     color: var(--court-green);
     text-decoration: underline;
     text-underline-offset: 3px;
     transition: color 0.2s ease;
   }
   ```
   plus a comment saying why the colour is absent (see Decision), and, beside the other
   `.feature` rules:
   ```css
   .feature p a {
     font-weight: 600;
     text-decoration-color: rgba(26, 122, 92, 0.3);
   }

   .feature p a:hover {
     text-decoration-color: var(--court-green);
   }
   ```

   And in the inline `<style>` of `404.html`, beside the other base rules:
   ```css
   a {
     text-decoration: underline;
     text-underline-offset: 3px;
   }
   ```

4. Gate: `npm test`. Then the AFTER dump and diff, axe, vision emulation, and the negative
   tests below, restoring the tree after each.

## Smoke check spec

The orchestrator replaced the cascade model first proposed here. Underline is the default
once the base rule is flipped, so the check only has to hold that default and make every
exception a named decision. A selector parser with specificity and source order is a lot
of code to keep in a dependency-free script, and it could fail on an unrelated CSS edit.

Name: `links keep their underline unless a named rule opts out`. Add it at the end of the
file, above the failure report. Keep helper consts above their first use; `check()` runs
its callback immediately (see the TDZ note at the top of `scripts/smoke-build.js`). No
dependencies. A comment on it gives #90 and WCAG 1.4.1.

**Sources.** Every `*.css` under `dist/` from `walk(distDir)`, plus the inline `<style>` of
every built `*.html`. Comments stripped. Print-only `@media` blocks removed by brace
counting (a query list with a comma in it is kept, since F3),
because the print block is `a,a:visited{text-decoration:underline}`: read as-is, a print
rule satisfies a screen check. Width queries stay in, so a mobile-only removal is seen.

**Rules** are read with `/([^{}]+)\{([^{}]*)\}/g`, which gives the innermost selector inside
a kept `@media` too. For a rule, the line it sets is the LAST declaration matching
`(?:-webkit-)?text-decoration` or `text-decoration-line` at a declaration boundary, never
`text-decoration-color`. The minifier merges colour into the shorthand and adds the prefix
(`-webkit-text-decoration:underline #1a7a5c4d`), so a value underlines when it contains
the word `underline` once any `var(...)` is stripped from it. Any other value, `none` or a bare colour or `line-through`, removes it.

**1. Base rule.** Each `*.css` and `404.html`'s inline block must contain a rule with the
exact selector `a` that sets an underline. Missing is a failure naming the source, not a pass.

**2. Allowlist.** Every rule that removes the underline must have all its comma-separated
selectors in a named `UNDERLINE_OPT_OUTS` const in the script, each with a one-line reason.
Today that is `.btn`, `.logo`, `.nav-links a`, `.skip-link` and `.page-actions a`, the five
actually in the built output. Anything else goes red naming the source and selector, and
the message says a new opt-out has to be added to the list by hand, and why. Same reasoning
as `MINIMUM_EXPECTED`: having to edit that line puts the decision in front of a reviewer.

**3. Floor.** The removal rules found must be non-empty, and each allowlist entry must
still match a rule found, so a stale entry goes red. The union across sources counts: `.btn`
in either stylesheet keeps the entry alive. The source list must also be non-empty, and
must include `404.html`.

**4. Prose.** Stays because it is small: no tag walker. For every built page, with comments
removed, for each `<p>` or `<li>` block read by a non-greedy regex, no `<a>` inside may carry
a class that a single-class allowlist entry names (`btn`, `logo`, `skip-link`). The class is
read by capturing the opening delimiter and matching to its next occurrence, per the
`metaContent()` rule in CLAUDE.md, never a `[^"']*` class. That stops a `.btn`-style opt-out
being used on an in-prose link. It needs floors of its own: the single-class entries must not be
empty, and at least one `<a>` in a `<p>`
or `<li>` on every content page, or an emptied regex passes.

**Failure message** names the source and selector or the page and href.

## What this check does not see

The cascade model would have caught these and this check does not. Each goes in the
CLAUDE.md "still unchecked" note rather than back into the script:

- A prose link inside an allowlisted **context** rather than carrying an allowlisted class:
  a sentence with a link added to `.page-actions` or to a `.nav-links` item stays plain and
  stays green, because the prose half reads classes and those two opt out by ancestor.
- A context rule that is allowlisted but wider than it looks. `.page-actions a` covers any
  link in that container, not only the buttons it was written for.
- A rule that wins for a different reason: nothing here reads specificity, so a broad
  allowlisted selector beating a narrower underline is not modelled.
- Non-`text-decoration` removals: `text-decoration-color: transparent`, a zero
  `text-decoration-thickness`, or an inline `style=` on the anchor. The cascade model missed
  these too; listed so the note is complete.
- Links written by JavaScript. `js/app.js` creates only `th` and `td` today.

The first of these is the only realistic one, and neither container holds prose today.

## Negative tests

Each is run, shown red or green as stated, restored, and the output kept for the PR. Edit
source and run `npm run smoke`.

| # | Mutation | Expected |
| --- | --- | --- |
| N1 | Remove the underline from the base `a` in `css/style.css` (back to `none`) | Red: base rule, and `a` not on the allowlist |
| N2 | Delete the `text-decoration` declaration from the base `a` entirely | Red: no underline on the base rule |
| N3 | Delete the `a` rule from `404.html` | Red, names `404.html` |
| N4 | New prose context: `.feature p a { text-decoration: none; }` | Red, names `.feature p a` |
| N5 | Same in a width query: `@media (max-width: 768px) { .feature p a { text-decoration: none; } }` | Red, mobile-only removal seen |
| N6 | `text-decoration: line-through` on a new prose context | Red |
| N7 | In the script, remove the print exclusion, with N2 applied | Green, while N2 alone is red. Proves the exclusion is load-bearing: the print rule then satisfies the base check |
| N8 | Empty the allowlist | Red on all five selectors |
| N9 | Delete `.logo`'s `text-decoration: none` from both stylesheets, leaving a stale entry | Red, names the stale entry |
| N10 | Delete every removal rule, or make the rule regex match nothing | Red, floor |
| N11 | `class="btn"` on a link inside a `<p>`, and separately inside an `<li>` | Red, names page and href |
| N12 | Delete `.feature p a` and `.feature p a:hover` | Green, and that is correct: the base rule is what distinguishes the link and `.feature p a` only tints it. Confirm by computed style |
| N13 | New in-prose link in an uncovered context: a sentence with a link in a `<td>` or `<div>` | Green and correct: the base rule underlines it. Confirm by computed style, and record this as the design working |
| N14 | Prose link with `.btn` wrapped in an HTML comment | Green, comments are not links |
| N15 | F1. In the script, narrow the prose regex `(p\|li)` to `(li)` | Red: the floor counts `<main>` only, so it names `index.html` and `code-of-conduct/index.html`, the two pages with no `<li>` link in `<main>`. FAQ and subs have some, so the mutant does not trip them |
| N16 | F2. Respell `.btn` as `a.btn` in both stylesheets and in `UNDERLINE_OPT_OUTS`, and put `class="btn"` on the GPN link in its `<p>` | Red, names `index.html` and the href |
| N17 | F3. `@media print, (max-width: 768px) { .feature p a { text-decoration: none; } }` | Red, names `.feature p a`: only a print-only query is dropped |
| N18 | F4. `.x a { text-decoration: var(--no-underline); }` | Red, names `.x a`: a `var()` name is not the word underline |
| N19 | F5. `<a aria-label="Fall > Spring" class="btn" href="/x">` in the GPN link's `<p>` | Red, names `index.html` and `/x`. Also fails the sameAs check, because the href moved |

## Live drive (Medium: drive the changed path)

Serve `dist/` with `npm run preview`. Install axe-core in the scratch directory only, inject
its source with chrome-devtools-mcp `evaluate_script`, and run `axe.run()` on `/`, `/faq/`,
`/subs/`, `/code-of-conduct/` and `/404.html` at 375px and 1440px. Quote results: the rule's
pass or violation and the total violation count per page. Also view "Off the court" under
grayscale or protanopia emulation with a screenshot at both widths, and confirm the link
reads as a link. Open the mobile drawer once and confirm nav links stay plain. Hover the
link and the footer link once.

The computed-style diff of step 1 must show exactly one change: the GPN link at both
widths, on `index.html`. Any other change is a defect in this plan.

## Risks

- Riskiest step: flipping the base rule, since it reaches anchors no prose rule mentions.
  Covered by the before/after computed diff on every link.
- The footer tint leak. Avoided by leaving colour off the base; the diff should also compare
  `text-decoration-color` for the footer link.
- A future CSS edit tripping the allowlist. That is the design, and the message has to make
  the repair obvious.
- The check's blind spots, listed under "What this check does not see".

## Unfreeze record

The check `links keep their underline unless a named rule opts out` in
`scripts/smoke-build.js` was frozen when it went in red. Review found five defects in the
check itself (F1 to F5, negative tests N15 to N19), so fixing them meant editing it.

- Approval: given by the user and relayed by the orchestrator through the issue
  coordinator. The implementer did not see the user's message itself. Quoted as relayed:
  "yes, rewrite the frozen checks for #89 and #90".
- Scope: this one check and the five fixes F1 to F5, nothing wider.
- Reason: each defect let a colour-only link or a removed underline pass, shown green on
  the old check and red on the new one. No assertion was removed, and the red the check
  was frozen on is unchanged, as the proof below shows. F3 is not purely tightening: see
  gap 2 under "Accepted gaps after the rewrite".
- The rewritten check is frozen again from this commit.

## Accepted gaps after the rewrite

The delta review of the rewrite found three more holes in the check. The user decided to
document them and ship, with no second rewrite. Quoted as relayed by the orchestrator: "yes
to both, document the gaps and ship". `scripts/smoke-build.js` stays as it is at `1ea5994`.
Each was confirmed by a run with smoke at exit 0. None affects the shipped site.

1. `anchorAttribute` reads the first ` class=` after whitespace, even inside another
   attribute's value. `<a title='the class="x" page' class="btn" href="...">` in a `<p>`
   reads as class `x`, so `btn` is never compared and a colour-only link passes. This is F5
   one function further on.
2. F3 was not purely tightening. The comma exclusion keeps every query list, including a
   print-only one, so `@media print and (orientation: landscape), print and (orientation:
   portrait) { a { text-decoration: underline; } }` is now read as a screen rule and
   satisfies the base rule check when the base declaration has been deleted. By reading,
   the pre-F3 regex dropped that block and went red; that was not run. No link ends up
   colour-only: with no declaration the browser default underlines, and writing `none` on
   the base goes red through the allowlist. What is lost is the check's requirement that
   the base rule state the underline.
3. The single-class floor fires only when no such entry remains, not when `btn` alone drops
   out. Respelling `.btn` as `:where(.btn)` in both stylesheets and in `UNDERLINE_OPT_OUTS`
   stays live and unread, so `class="btn"` on a prose link passes. It needs a hand edit to
   the list, which is where a reviewer sees it.

## Proof

| Criterion | Evidence |
| --- | --- |
| 1 | Computed style on the GPN link, screenshot under vision emulation, smoke check |
| 2 | axe output for five pages at two widths |
| 3 | The check, red on the unchanged CSS, plus N1 to N19 |
| 4 | Before/after computed-style diff, one change only |

Rewritten check at the merge base `5f6095b505193c47f3d408cb121366c2b13dab08` (`git merge-base origin/main HEAD`), in a
scratch worktree with `npm ci`, with only the check applied: `npm run smoke` exits 1, 76
checks ok and this one not ok. It still fails on the base rule of both stylesheets:

```
not ok - links keep their underline unless a named rule opts out

1 smoke check(s) failed:
  links keep their underline unless a named rule opts out: assets/app-CtMUz08-.css: the base a rule does not set an underline; 404.html: the base a rule does not set an underline; assets/app-CtMUz08-.css: "a" removes the underline and is not in UNDERLINE_OPT_OUTS in scripts/smoke-build.js. A link whose only cue is colour fails WCAG 1.4.1, so keep the underline, or add the selector there by hand with its reason if it really is not a link in text
```

The scratch worktree was removed afterwards.
