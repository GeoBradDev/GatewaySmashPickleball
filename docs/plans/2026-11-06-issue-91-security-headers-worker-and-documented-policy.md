# Plan: security headers on /join, and a documented policy for the static site (issue #91)

Risk tier: High. Forced by security, and by touching the only path to the group: a
wrong CSP on the challenge page leaves every visitor unable to reach it, in a way no
check on the Worker's own side can see.

Domain skills: none of the framework, API, data, payments or email skills apply.
chrome-devtools-mcp is used for the live drive. Current Cloudflare docs were read for
this plan (cited under "Findings").

Companion controls: no `.claude/work-issue.md`, `REVIEW.md`, finder or verifier agent,
or edit-guard hook. Fallbacks apply. Gate is `npm test`, derived from CLAUDE.md.

## Approver conditions (these override the rest of this plan)

Added by the approver before implementation. Where they differ from anything below, they win.

1. `INVITE_URL` unset or malformed must not turn GET or HEAD `/join` into a 502 or an
   exception from building the header. The page still renders 200 with `form-action
   'self'`. POST fails closed exactly as it does now. Both cases are tested.
2. `new URL(...).origin` alone is **not** safe. The WHATWG parser permits `;`, `'`, `"`
   and `,` in a host, measured in Node: `https://x;script-src-elem.example/` has the
   origin `https://x;script-src-elem.example`, and `%3B` decodes to the same thing.
   `inviteOrigin` validates the parsed origin against a strict allowlist and returns
   the fallback `''` otherwise. Hostile values are tested, asserting the header equals
   the fallback policy. A secret with something odd produces the fallback, never a
   broken policy.
3. HEAD gets the same headers as GET, invite origin in `form-action` included, and a
   test proves it.
4. No `wrangler deploy`, `wrangler secret`, `wrangler versions` or `wrangler rollback`,
   no real invite, nothing touched on Cloudflare or Render.

Docs (`CLAUDE.md`, `worker/README.md`) are done later by the coordinator, per order of
work step 6.

## Scope

This PR covers the code half only, and the PR body says `Refs #91`, not `Closes #91`.

- In: `worker/src/index.js`, its tests, `worker/README.md`, CLAUDE.md under Deployment.
- Out, needs the user: every Cloudflare or Render dashboard or API change, HSTS
  included. The Worker must not send `Strict-Transport-Security`: that would set HSTS
  on production at the next deploy, which is not approved. A test pins its absence.
- No `render.yaml`. The repo has none, and adding one is not this PR.
- No throwaway server, hostname mapping or other test harness lands in the repo.

## Acceptance criteria

From the issue, verbatim, with what this PR can reach:

1. `curl -sSI https://www.gatewaysmash.com/` shows `strict-transport-security` with a
   max-age of at least 6 months. **Not reachable here: dashboard.**
2. The site and `/join` both send a CSP, a `Referrer-Policy` and `nosniff`, with no
   console CSP violations on any page or during a Turnstile pass. **/join half here,
   proven locally. Production needs the deploy. Site half needs the dashboard.**
3. CLAUDE.md records where each header is configured. **Here.**

Concrete criteria for this PR:

- A. Every HTML response (200, 400, 403, 405, 502) carries `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer` and a CSP, all set in `html()`.
- B. The 302 carries `Referrer-Policy: no-referrer` and `X-Content-Type-Options:
  nosniff`. It sends no CSP: nothing renders from it, and `Location` is the only part
  a browser acts on.
- C. No response carries `Strict-Transport-Security`.
- D. No policy contains `'unsafe-inline'`, `'unsafe-eval'` or a bare `*`.
- E. A full Turnstile pass in real Chrome against `npm run dev` lands on a cross-origin
  `INVITE_URL` with no CSP violation.
- F. CLAUDE.md gives the exact static-site values, marked not yet applied, each
  directive justified, verified on every page of a locally served `dist/`.

## Findings that shape the design

All measured on 2026-11-06 in Chrome 157 unless a doc is cited.

**1. `form-action 'self'` alone locks everyone out.** Chrome applies `form-action` to
redirects after the POST. A spike page with `form-action 'self'`, POSTing to itself
and answered with a 302 to another origin, logged a `form-action` violation, the POST
ended `net::ERR_ABORTED`, the target was never requested, and the visitor stayed on the
page. Adding the target's origin to the list let the same flow land with no console
message. Public reports say Safari enforces the same way and Firefox does not, which
was not measured here. This has to be the invite's origin, and only the origin: a
source with a path is compared on the initial URL only, and the invite code must not
reach a public header.

**2. Hardcoding `chat.whatsapp.com` is not available, and is not needed.** CLAUDE.md
bans the host from `dist/`, which `worker/` is not part of, but
`no invite-shaped URL sits in the Worker source or its tests` in `gate.test.js` bans it
from `worker/src` and `worker/test`. So the origin is **derived from `env.INVITE_URL`
at request time** with `new URL(...).origin`. The repo names no WhatsApp host, a rotated
invite on another origin needs no code change, and the header exposes only an origin
that the page's own copy already names as WhatsApp. A bare `https://chat.whatsapp.com/`
and a fake invite code both answer 200 with no further redirect, on desktop and mobile
user agents, so one origin is enough today. If WhatsApp ever redirects an invite to
another origin, Chrome would block that hop, so this goes in the docs as the first
thing to check if the Join flow silently stalls.

**3. Cloudflare injects an inline script into every HTML response, including /join.**
`curl` of production shows an inline `<script>` before `</body>` on `/`, `/faq/`,
`/subs/`, `/code-of-conduct/`, a 404 and `/join`. That is JavaScript Detections. It
differs per response (it carries the ray ID), so **no hash can allow it**. It builds a
hidden `about:blank` iframe, loads `/cdn-cgi/challenge-platform/scripts/jsd/main.js` and
talks back to the same path. Cloudflare's docs say to allow that path, say Cloudflare
reads the nonce from the CSP **response header** and applies it to the scripts it
injects, and say that with no nonce the browser blocks the injected script and logs a
console error. `wrangler dev` has no such injection, so **a local pass cannot see this**.
The docs also say that under Bot Fight Mode, JavaScript Detections cannot be turned off
and cannot be scoped by path. Which product this zone uses is a dashboard fact not
visible from here.

Also injected: `/`, and `/code-of-conduct/` get
`/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js` from Email Address
Obfuscation. It is same-origin, so `script-src 'self'` covers it, and without it those
two addresses read `[email protected]`.

**4. The frozen tests rule out a nonce on the inline script.** `help-timer.test.js` is
frozen and matches `/<script>([\s\S]*?)<\/script>/`, so `<script nonce="...">` fails it.
Rewriting it needs the user's approval. Happily the two needs separate cleanly:

- **Our own inline script and style are constant, so they are allowed by hash.** The
  markup does not change and no frozen test is touched.
- **A per-response nonce still goes in `script-src`, and only in the header.** It is
  there for Cloudflare to find (finding 3). No element of ours carries it.

The hashes are constants in `index.js`, not computed: `crypto.subtle.digest` is async
and `html()` is a synchronous exit used by every path including the catch. A test
recomputes both from the rendered page with `node:crypto`, so editing either block
without its hash goes red and prints the right value.

**5. `Referrer-Policy: no-referrer` is safe for Turnstile.** Test keys skip hostname
checks, so a green local pass would prove nothing, and no doc covers it. Measured with
the real public site key in a separate throwaway Chrome profile, with
`www.gatewaysmash.com` mapped to a local HTTPS server:

| Host | Policy | Referer sent | Widget |
| --- | --- | --- | --- |
| allowed | default | yes | `before-interactive` |
| allowed | `no-referrer` | no | `before-interactive` |
| allowed | `no-referrer` plus candidate CSP | no | `before-interactive` |
| unlisted | default | yes | `error:110200` |
| unlisted | `no-referrer` | no | `error:110200` |

The widget accepts the host and rejects an unlisted one with or without a Referer, so
the hostname check does not lean on it. Limit: headless Chrome stops at the interactive
step, so a real-key **solve** is unproven and is the production check in the user's list.

**6. Turnstile's documented requirement** is `https://challenges.cloudflare.com` in both
`script-src` and `frame-src` when not using a nonce on `api.js`
(<https://developers.cloudflare.com/turnstile/reference/content-security-policy/>). Its
pre-clearance mode needs `connect-src 'self'`, which finding 3 needs anyway. Docs read
for finding 3:
<https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/>
and <https://developers.cloudflare.com/bots/get-started/bot-fight-mode/>.

## Files that change

- `worker/src/index.js`
- `worker/test/headers.test.js` (new, not frozen)
- `worker/test/form-action-help.test.js` (new, frozen)
- `worker/README.md`
- `CLAUDE.md` (Deployment, plus one line under Integrations)
- this plan
- `eslint.config.js`: `URL` and `crypto` join the Worker's globals, which the lint half
  of the gate requires now that `src/index.js` uses them. Not foreseen by this plan.

Not changed: `worker/test/defects.test.js`, `worker/test/help-timer.test.js` (frozen),
`worker/test/gate.test.js`, `scripts/smoke-build.js`, anything under `dist/`'s sources.

## Design: the Worker

Policies, built per response. `N` is `crypto.randomUUID()`, `H` the script hash, `S` the
style hash, `I` the invite origin when there is one:

Challenge page:

```
default-src 'none'; script-src 'nonce-N' 'H' 'self' https://challenges.cloudflare.com;
style-src 'S'; frame-src https://challenges.cloudflare.com; connect-src 'self';
form-action 'self' I; base-uri 'none'; frame-ancestors 'none'
```

Failure pages:

```
default-src 'none'; script-src 'nonce-N' 'self'; style-src 'S'; connect-src 'self';
form-action 'none'; base-uri 'none'; frame-ancestors 'none'
```

Why a failure page has a `script-src` at all, given it has no script: finding 3. Without
it, production logs a violation on every 403 and 502. It stays stricter than the
challenge page: no Turnstile host, no script hash, no form target.

Shape of the change:

- `html(body, status, headers)` gains the three headers. Its policy comes through a
  parameter, defaulting to the failure policy, so a forgotten argument fails closed:
  the challenge page is the only caller that passes the wider one.
- `inviteOrigin(env)` returns the origin, or `''` when `INVITE_URL` is unset, does not
  parse, is not `http:` or `https:`, or has an origin that fails the allowlist (approver
  condition 2). The scheme is checked as well as the origin because a `blob:` URL
  reports its inner `https` origin, which is clean and would pass the pattern alone. The
  pattern also requires each label to open and close on a letter or digit, which is
  tighter than the example the approver gave, so `https://...` and `https://-.example`
  fall back. It must never throw: `GET /join` is served
  from inside the outer `try`, so a throw would turn a bad secret into a 502 on the
  challenge page itself. Today that page renders regardless of the secret.
- The 302 gains `Referrer-Policy` and `X-Content-Type-Options` from one shared
  constant object that `html()` also spreads.
- No `Strict-Transport-Security`, and no `Permissions-Policy`: the issue asks the Worker
  for neither, and Turnstile's feature needs are not documented.

## Design: the static-site recommendation

Recorded in CLAUDE.md, marked **not yet applied**, to be set in Render.

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'
  'sha256-Ywg8xuaNd9SFC2I2/x418J72cFuVagQA4V5p/sX2U6w='; img-src 'self'; font-src 'self';
  manifest-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none';
  frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

Implementer: recompute the hash from the final `dist/404.html`, and confirm it.

- **Why Render and not a Cloudflare Transform Rule.** Render's headers apply to what
  Render serves, so `/join` keeps the Worker's own policy. Cloudflare's docs do not
  settle whether a response Transform Rule would overwrite a Worker's header, and they
  warn that sitewide CSP rules can break its challenge pages. HSTS is the exception: it is
  the zone setting under SSL/TLS, and covering `/join` there is wanted.
- **The one directive that cannot be finished from here: JavaScript Detections.** A
  fixed header has no per-response nonce, and finding 3 rules out a hash. So the
  recommended policy logs one violation per page while the zone injects that script,
  and criterion 2 cannot pass until the user picks one. CLAUDE.md lists them and
  recommends the first:
  1. Turn off what injects it (for Bot Fight Mode, the whole feature). Clean console,
     strictest policy, and a lower signal on a site with no login or payment form.
  2. Keep it and accept the console error. The script is blocked, so the detection
     loses its signal while the feature stays on.
  3. Add `'unsafe-inline'` to `script-src`. Clean console, and it gives up most of what
     the CSP is for. Cloudflare discourages it.
  A constant nonce in a fixed header is not offered: a nonce that never changes is a
  password in the page source.
- **The 404 style hash is a value that can go stale.** `404.html` carries its own
  `<style>` so it renders when the stylesheet is what failed, and Render serves that one
  file for any missing path, so a per-path header cannot give it a looser policy. Editing
  that `<style>` changes the hash and nothing in the repo can see the dashboard. The
  failure is a console violation on an unstyled 404, not an outage. CLAUDE.md gives the
  one-line command to recompute it. `'unsafe-inline'` in `style-src` is the alternative,
  named there as lower-maintenance and weaker. A smoke check comparing the hash to
  CLAUDE.md is deliberately not added: it asserts prose, and it is out of this PR's scope.
- `'self'` for `connect-src` rather than `'none'`: the Vite module-preload polyfill in
  the bundle calls `fetch`, and the Cloudflare path needs it.
- JSON-LD blocks are data blocks, not scripts, so `script-src` does not apply. The
  live pass confirms it. They are exercised on `/` and `/faq/`.

## Order of work

1. Tests first, in `worker/test/headers.test.js`, red against `main`. Freeze only a test
   proving a defect, and scope it narrowly: this is a feature, so expect at most the
   `form-action` test, if any. Do not freeze the policy's exact text.
2. Worker change. Green.
3. `npm test`, from the repo root, verbatim.
4. Live drive (below). Delete `worker/.dev.vars` afterwards and confirm it is gone.
5. Local `dist/` drive (below), with the throwaway server in the scratchpad.
6. Docs, in Phase 8 by the coordinator: `CLAUDE.md`, `worker/README.md`.

## Tests

`headers.test.js`, direct assertions, using the same sentinels as the other suites:

- Every status (200, 400, 403, 405, 502) has `nosniff`, `no-referrer`, and a CSP with
  `default-src 'none'`, `frame-ancestors 'none'` and `base-uri 'none'`.
- The 302 has `no-referrer` and `nosniff`.
- No response has `Strict-Transport-Security`.
- No policy has `'unsafe-inline'`, `'unsafe-eval'` or a bare `*`.
- The challenge policy's hashes equal `node:crypto` SHA-256 of the rendered page's own
  inline `<script>` and `<style>`. Failure pages' style hash likewise. These fail if
  either block is edited alone, and that failure is what stops a page shipping with its
  own script blocked.
- The challenge policy names `https://challenges.cloudflare.com` in `script-src` and
  `frame-src`. A failure policy names it nowhere and has `form-action 'none'`.
- `form-action` on the challenge page is `'self'` plus the invite's origin, and no header
  on the GET contains the invite's path. With `INVITE_URL` unset or malformed, the GET
  is still 200 with `form-action 'self'`.
- Two GETs carry different nonces, and the page body contains neither.

Negative-test by hand and record it: remove the invite origin from `form-action`, change
one character of the inline script, and remove `nosniff`. Each must go red.

## Proof

| Criterion | Proof |
| --- | --- |
| A, B, C, D | `headers.test.js` |
| E | Live drive |
| F, and the static half of 2 | Local `dist/` drive |
| 3 | CLAUDE.md, doc finder |

**Live drive**, `npm run dev` in `worker/`, `.dev.vars` from the README's test keys, in
real Chrome, recording console and network each time:

1. `INVITE_URL=https://example.com/`: Turnstile passes, POST, lands on example.com, no
   CSP violation, the widget rendered and the page is styled.
2. `INVITE_URL` at a local echo server on another origin: lands, and the echo shows no
   `Referer`. Confirms the 302's header on a target whose request can be seen.
3. Negative control: a run forced to `form-action 'self'` only must stall with the
   violation, proving the drive can detect the failure. Throwaway edit, reverted.
4. Failure pages (403 by a bad token, and 405): styled, no violation.
5. Help text path: `challenges.cloudflare.com` blocked still shows the help text.
6. `curl -sI` on GET and on the 302 shows the header set.
7. Simulated injection: a scratchpad proxy adds Cloudflare's captured snippet with
   `nonce` set from the response header, to confirm the policy allows `main.js` and the
   iframe. **This is a simulation of a documented behaviour, not proof of it**, and the
   PR says so.

**Local `dist/` drive**: a scratchpad server serving `dist/` with the recommended headers,
missing paths answered with `404.html` and a 404 status. Load `/`, `/faq/`, `/subs/`,
`/code-of-conduct/` and a missing path. No CSP violation, fonts and icons load, the mobile
nav and the schedule status work (both need the bundle running), the 404 is styled, and
the manifest loads. Negative control: remove `font-src` and confirm the drive reports it.

## Implementation notes, from the live drive

- **Tooling.** The devtools MCP has no request blocking, so step 5 used a throwaway
  headless Chrome started with `--host-resolver-rules=MAP challenges.cloudflare.com
  ~NOTFOUND`, cold and with `api.js` cached. Steps 5 and 7 and the `dist/` drive read
  console output over CDP from that same kind of browser. Steps 1 to 4 used the MCP.
- **The 404 style hash is unchanged**: `sha256-Ywg8xuaNd9SFC2I2/x418J72cFuVagQA4V5p/sX2U6w=`,
  recomputed from `dist/404.html`.
- **`nosniff` is not in the static recommendation because Render already sends it**, per
  the captured production headers. It stays out of the list the user has to apply.
- **Step 7 depends on what Cloudflare stamps.** The snippet is two scripts: the outer
  inline tag, and an inline script it creates inside an `about:blank` iframe, which
  inherits the policy. With a nonce on both, `main.js` runs and its beacon is allowed
  with no violation. With a nonce on the outer tag only, the inner script is blocked and
  logs one violation. With no nonce, the outer tag is blocked. Joining works in all
  three. Only production can show which one Cloudflare does, so it goes on the user's
  post-deploy check.
- **A malformed `INVITE_URL` is unchanged on POST**, per approver condition 1: only an
  unset one gives the 502. With a valid token, a set but malformed value still answers
  302 with that value in `Location`, and the fallback `form-action 'self'` then stops a
  cross-origin one in the browser. The visitor stays on the page and the listener
  below shows the help text. A test pins the 302.
- **Departure: the inline script gains a `securitypolicyviolation` listener.** Finding 4
  said the markup would not change. Review found a defect this change introduced: an
  invite whose target redirects to an unlisted origin, or a valid URL that fails the
  allowlist such as `https://my_host.example/x`, is blocked after `done()` has set
  `solved`, so the 4-second timer never fires, the Worker has answered a good 302 and
  logged nothing, and the visitor sees nothing. `main` works in those cases. The listener
  is on `window` because frozen `help-timer.test.js` has a fake document with only
  `getElementById`, and it filters on `form-action` so that a blocked Cloudflare script
  does not reveal help on a healthy page. The timer is not re-armed in `done()`, which
  frozen `help-timer.test.js` forbids. Frozen: `worker/test/form-action-help.test.js`.
- **Live drive step 8, added: a blocked second hop.** `INVITE_URL` at
  `http://127.0.0.1:8942/hop`, which 302s to `http://localhost:8943/`, an origin not
  listed. Measured before relying on it: the event reaches `window` with
  `effectiveDirective` `form-action`, the first hop is requested, the second is not, and
  the visitor stays on `/join`.
- **Hand negative tests, the three this plan asks for.** Each ran against `npm run
  test:worker`, was reverted, and went red: invite origin removed from `form-action`
  (the HEAD test and every `form-action reads the origin` row), one character of the
  inline script changed (the hash test, 1 failure), `nosniff` removed (7 failures).

## Risks

- **The riskiest step is `form-action`** (finding 1), now designed around and pinned by a
  test and a live negative control.
- **A hash mismatch blocks `done()` and nobody can join.** Test recomputes it. Anything
  that rewrites inline script bytes between the Worker and the browser would break it
  in production only. Production `/join` shows Cloudflare leaving inline scripts
  intact today, and the user's post-deploy check covers it.
- **What a local run cannot show:** Cloudflare's nonce propagation on `/join`, a real-key
  solve, and Safari. All three go on the user's list. A failure of the first is a
  console error with Turnstile unaffected.
- **Rollback:** `./node_modules/.bin/wrangler rollback` in `worker/` (the README warns off `npx`), in the PR body, because the first
  deploy is the first time this meets production.
- **The README's "Rotating the invite" stays true:** the origin is read per request.

## What I chose not to do

- Nonce on the inline script: needs a frozen test rewritten (finding 4).
- Omit `form-action`: valid, and it would remove the risk in finding 1, but it gives up
  a directive the task asks for when a safe form of it exists.
- A Worker in front of the whole site to give static pages per-response nonces: large,
  a new production path, and not what the issue asks.
- `Permissions-Policy` from the Worker, HSTS from the Worker, `render.yaml`.
