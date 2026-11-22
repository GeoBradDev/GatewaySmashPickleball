# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary visitor is a recreational pickleball player in the St. Louis area, rated
somewhere between 2.0 and 4.0+, who has found the league and is deciding whether to
sign up for a season or play as a sub. They are comparing it, explicitly or not,
against the corporate leagues in the city.

Returning players use the site too, for the schedule, the registration date, the FAQ
and the WhatsApp link, but they come second to the newcomer when the two conflict.

## Product Purpose

Gateway Smash is a volunteer-run indoor pickleball ladder league that plays Sunday
nights at Arch Pickleball in Bridgeton. The site explains the league, publishes the
season schedule and registration dates, and sends players to register (Global
Pickleball Network), to the sub page, and to the WhatsApp group (through `/join`).

Success means two things:

- **Fewer organizer questions.** The schedule, the League Info list and the FAQ answer
  what people would otherwise ask the volunteers in WhatsApp or by email.
- **Credibility against corporate leagues.** A grassroots league looks organized,
  current and trustworthy to someone who has never met the organizers.

Filling the roster is not something the site has to drive. Registration opens for 24
hours or until 56 players sign up, and it usually fills on its own.

## Positioning

"People over profits." The league is built by players, for players, as an answer to
the high fees, inconsistent play and disorganized management of the city's corporate
leagues. It is volunteer-run, every dollar goes to court rental, and running on free
tools keeps the fee at $70 for an eight-week season. Play is indoors, so the weather
never cancels a night, and the Elo-rated ladder keeps pods close in level.

## Operating Context

- League night: Sunday, 6:00 to 8:00 PM, at Arch Pickleball (11333 Blake Drive,
  Bridgeton, MO 63044). Three doubles matches in a pod of four, then an hour on two
  social courts.
- Registration opens at 8:00 AM Central on each season's date, on Global Pickleball
  Network, for 24 hours or until 56 players sign up.
- Scores and ratings go to the Gateway Smash club page on Global Pickleball Network.
- Announcements and conversation happen in a WhatsApp group, reached through the
  Turnstile-gated `/join` Worker. The invite URL is never published.
- Organizers are volunteers, and several of them read `info@gatewaysmash.com`.

## Capabilities and Constraints

- Static site built with Vite: homepage, FAQ, subs page, code of conduct, a 404 and
  unlisted season reports. There are no accounts, forms or payments on the site.
- The status of each season (in progress, registration open, full, completed) is
  derived from the schedule dates in `js/app.js` and never written by hand.
- A strict Content-Security-Policy applies: no inline scripts or styles, and no
  third-party subresources. Fonts are self-hosted.
- The site has to work without JavaScript (progressive enhancement), including the
  mobile nav.
- `scripts/smoke-build.js` enforces factual agreement across the site (price, venue,
  court time, registration time, the pitch line). See CLAUDE.md before changing copy.
- Terminology: season, pod, ladder, sub, bye, league night, social courts.

## Brand Commitments

- Name: Gateway Smash (Gateway Smash Pickleball).
- The mark in `public/icon.svg`, and the matching inline header logo, is fixed.
- The pitch line is the league's own and stays verbatim: "One of St. Louis' largest
  and most affordable indoor pickleball ladder leagues."
- Voice: plain, direct and human, never corporate. The blunt voice of the substitute
  rules is deliberate. The copy style rules in CLAUDE.md are binding (sentence-case
  headings, no em dashes, numbers over adjectives, descriptive link text).
- The code of conduct inbox is read by more than one organizer, so the site never
  promises confidentiality.

## Evidence on Hand

- The written copy across the site, the schedule, and the League Info facts.
- Roster size: 56 players per season.
- Unlisted, first-name-only season reports at `/summer2026/` and `/fall2026/`. They
  are shared by URL and must not be linked or indexed.

There are no player photos, testimonials, quotes, press or partner logos. Future work
must not invent any or depend on imagery the league does not have.

## Product Principles

1. Answer the question before it is asked. Every fact a new player needs to decide is
   on the page, stated once, and agrees everywhere it appears.
2. Show organization, don't claim it. A current, correct schedule and precise details
   are the credibility, not adjectives.
3. Players over polish. The site should read like the people running the league, not
   like the corporate leagues it is an alternative to.
4. Never go stale. Anything time-bound is derived from data, never hand-written.
5. Work for everyone: no JavaScript required, no third parties, readable at every
   size.

## Accessibility & Inclusion

Open to all skill levels, and the site is held to WCAG AA in practice: 4.5:1 text
contrast is checked in the build, links are underlined by default, and the mobile nav
works without JavaScript.
