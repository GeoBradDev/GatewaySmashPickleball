# Plan: Registration opening time is never stated (issue #92)

Risk tier: Medium. Copy plus one bundle sentence, all coverable by smoke checks, but it alters shipped behavior (hero and callout strings, the registration-day wording) across several files, and hero wrapping at 375px is not something a smoke check can see.

Domain skills: frontend-design: not applicable because no new UI, only copy in existing elements. No payments, API, data or email skill applies. Worker: untouched.

## Decisions from the maintainer

- Registration opens at 8 am St. Louis time, written `8:00 AM Central`, using the site's time format with a zone label that holds on both sides of daylight saving. Never CST or CDT.
- The time is fixed for every season: one stated value, no per-row `data-registration-time`. The PR must say this is an assumption.
- The optional `.ics` link is out of scope.

## Acceptance criteria

1. The homepage hero, the schedule callout, League Info and the FAQ (visible text and its JSON-LD) all state the registration opening time with a time zone.
2. A smoke check requires the stated time to agree across those places, reading the time from bundle output rather than from a third hardcoded copy.
3. No wording shown on registration day or afterwards claims something that may be false at that hour: nothing says registration is open before 8:00 AM Central, and nothing implies a window that has passed.
4. The page without JavaScript stays season-neutral: `#hero-note` and `#season-callout` still ship empty and hidden, and the static copy added names no season.
5. The hero note reads well and does not wrap badly at 375px, in the longest realistic state.

## The trap: "is open now" becomes a contradiction

`statusOf` works in calendar days, so `next.isOpen` is true from local midnight on the registration date. Today that renders "Registration is open now." With the time published, a visitor at 7:00 AM would read "is open now" on the page that says it opens at 8:00 AM. That is a false statement made visible by this change, so it is in scope.

Chosen fix: a sentence true at every hour of that day, with no clock logic.

    Fall 2026 registration is today, from 8:00 AM Central.
    Registration is today, from 8:00 AM Central.

It stays correct at 7:00 AM and 3:00 PM, carries the time, and keeps `isOpen`, the `hero-note--open` styling, the CTA rename and the subs logic exactly as they are.

Rejected: reading the current time in `America/Chicago`. It needs `Intl` in the bundle, reopens the "compare local calendar days" rule, would also have to model the morning of the following day, and is well past the size of this issue.

Left alone, and to be stated in the PR: the row's Status cell still reads "Registration open" all of that day, including before 8:00 AM (a day-level label beside a dated column, pinned widely), and the row flips to Full at midnight after registration day although a window that did not fill runs until 8:00 AM. Both are the existing day-granularity behavior.

## Approval

Approved by the orchestrator: the all-day sentence with no clock logic; both day-level limits kept, stated in the PR and in CLAUDE.md under the 24-hour window rule (a row can read Full for up to 8 hours while an unfilled window is still open); the FAQ heading renamed in the `h2` and the JSON-LD.

## Files that change

- `js/app.js`: add `var REGISTRATION_TIME = '8:00 AM Central';` beside `registrationSentence`, the single source for the sentence. Comment why it is one value and why it names no CST or CDT. `registrationSentence` becomes:
  - open: `subject + ' is today, from ' + REGISTRATION_TIME + '.'`
  - pending: `subject + ' opens ' + longDate(next.opens) + ' at ' + REGISTRATION_TIME + '.'`
- `index.html`, League Info: `<strong>Registration:</strong> Opens at 8:00 AM Central on the date in the schedule, for 24 hours or until the roster fills`.
- `faq/index.html`: rename the question to "When does registration open and close?" in the `h2` and the JSON-LD `name`. Answer, visible and JSON-LD: "It opens at 8:00 AM Central on the date in the league schedule and closes 24 hours later, or as soon as 56 players have signed up, whichever comes first. A season can fill well inside that day, so the opening time is the one to put in your calendar, not the season's first night." Keep the `/#leagues` link on "league schedule". The FAQ's opening-clause check needs the first sentence to match with tags stripped, so keep the two copies identical.
- `scripts/smoke-build.js`: update the existing pinned sentences (ordinary fixture pins, none frozen by any earlier run) and add the check below.
- `css/style.css`: the comment on `.hero-note--open` quotes "open now"; reword it. The 375px drive demanded one rule: `text-wrap: balance` on `.hero-note` and `.season-callout`. See the wrap decision under Proof.
- `CLAUDE.md`: update the sentence quoted at "The hero names the next season" and record the opening time rule under the schedule section: one value in `js/app.js`, what the check compares, and the day-granularity limits above. Phase 8.

## Order of work

1. Add the new smoke check and update the pins; confirm red against the current bundle and pages.
2. Change `js/app.js`.
3. Change League Info and the FAQ.
4. Run the gate, negative-test each location, drive the page at 375px.

## The new check: `the registration opening time agrees everywhere it is stated`

Beside the court-time check, dependency-free, against `dist/`.

- Derive the time from bundle output: run `statusesOn` for a pending and a registration-day clock, with and without a running season (2026-07-31, 2026-08-13, 2026-11-15, 2026-12-11). From each note and callout extract `/\b\d{1,2}:\d{2} [AP]M [A-Z][a-z]+/`. Each must carry exactly one match and all must be equal. No hardcoded value in the script. An abbreviation such as `CST` does not match the pattern, so it fails by name.
- Require that exact string in: `leagueInfo('Registration')`, the visible FAQ answer between that question's `h2` and the next `h2` (from `visiblePage()` output, or the JSON-LD would satisfy it), and that question's JSON-LD `acceptedAnswer.text`.
- In each of those three, also collect any looser clock time (`\d{1,2}(:\d{2})?\s*[ap]\.?m` case-insensitive) and fail if one differs, so a stray `8 AM` or `7:00 pm` beside the right string goes red. Failure messages name the location.
- Find the FAQ entry by a `registration` question containing `open`, not by the full heading, and fail if there is not exactly one, so renaming it cannot empty the check.

A second assertion, in the same check or beside it: on a registration-day clock, the note and callout do not say "open now", backed by the equality pins.

## Risks

- A pin is missed. `grep -n "open now\|registration opens\|Registration opens" scripts/smoke-build.js` before finishing, comments included.
- The pattern `[A-Z][a-z]+` accepts any capitalised word as the zone. Accepted: the pages are held to the bundle's string, and the bundle's string is pinned by equality.
- The hero grows from two lines to about three at 375px and pushes the CTA or the subs line. See Proof.
- `#70` bundle price scan: the constant carries no `$`. Confirm it stays green.
- The minifier may inline `REGISTRATION_TIME`. Irrelevant, because the check reads rendered output.

## Proof

- Criteria 1 and 2: the new check, plus a negative test for each location, one at a time on a scratch edit, reverted after: the bundle constant, League Info, the FAQ visible answer, the FAQ JSON-LD, the hero alone and the callout alone (for example, a suffix change in one call site), and the FAQ question renamed so the lookup finds nothing.
- Criterion 3: equality pins for pending and registration-day sentences, with and without a running season. Negative test: restore "is open now", expect red. Status on the day after registration still reads Full, and the hero moves to the next season with its own date and time.
- Criterion 4: the existing `the built hero ships the ids the bundle enhances` check, plus a build with JS disabled.
- Criterion 5: live drive at 375px wide on the built site for the real clock (hero reads "Fall 2026 is in progress. Winter 2027 registration opens December 10, 2026 at 8:00 AM Central."), the registration day, and the widest season name, with a screenshot or measured line count. Report where the line breaks fall. Check `8:00 AM Central` is not split badly. If it is, the fix is a non-breaking approach that keeps the string the check compares identical to the page copy, or leave it and say why.

Wrap decision, from the drive: with no season running the pending hero wrapped to "Registration opens December 10, 2026 at 8:00 AM / Central.", and the callout split "from 8:00 / AM Central." on a registration day with a season running. The first state is reached from November 9, 2026. Fixed with `text-wrap: balance` on `.hero-note` and `.season-callout`, not with non-breaking spaces: the string the check compares stays byte-identical to the page copy, and no pin changes. It is a CSS-only hint, so a browser without support falls back to the wrap above, which is untidy and still true. No smoke check covers it, because wrapping is not visible in built markup.
