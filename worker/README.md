# join-gate

A Cloudflare Worker on `gatewaysmash.com/join*` and `www.gatewaysmash.com/join*`.
It shows a Turnstile challenge and, when the challenge passes, 302-redirects to
the WhatsApp community invite. Every WhatsApp link on the site points at
`/join`, so the invite URL never appears in the site's HTML or JavaScript.

The invite URL lives only in the Worker secret `INVITE_URL`. Do not commit it
anywhere in this repo. `npm run smoke` fails if an invite URL turns up in
`dist/`.

This directory is not part of the site build. Vite only builds the pages listed
in `vite.config.js`, and Render publishes `dist/`, so nothing here ships with
the site. Deploying the site does not deploy the Worker, and the reverse is
also true.

## Setup

Run these from this `worker/` directory.

1. **Install wrangler.**

   ```sh
   npm ci
   ```

   wrangler is pinned to an exact version in this directory's `package.json`
   and `package-lock.json`, and it is not a dependency of the site, so the
   repo root's `npm ci` does not install it. Call it through the npm scripts
   below rather than through `npx`: when `node_modules` is missing, `npx`
   falls back to fetching the latest version, while a script stops with "not
   found", unless a global wrangler is on your `PATH`, which would run instead.
   Node 22 or later is required.

2. **Create the Turnstile widget.** In the Cloudflare dashboard, go to
   Turnstile, add a widget, and add `gatewaysmash.com` and
   `www.gatewaysmash.com` as hostnames. Managed mode is fine. Copy the
   **site key** into `TURNSTILE_SITEKEY` under `[vars]` in `wrangler.toml`.
   The site key is public. Keep the **secret key** for the next step.

3. **Set the secrets.** Each command prompts for the value, so nothing lands
   in your shell history:

   ```sh
   npm run secret:put -- TURNSTILE_SECRET
   npm run secret:put -- INVITE_URL
   ```

   `TURNSTILE_SECRET` is the widget's secret key. `INVITE_URL` is the full
   WhatsApp invite link.

4. **Deploy.**

   ```sh
   npm audit
   npm run deploy
   ```

   `npm audit` is here because the one at the repo root cannot see this
   directory's tree, and CI never installs it.

   Merging a change to this directory does not deploy it. The Worker in
   production stays as it was until someone runs `npm run deploy` here.

   This registers both routes in the `gatewaysmash.com` zone. The routes only
   apply while the DNS records are proxied (orange cloud).

## Rotating the invite

If the invite is revoked or regenerated in WhatsApp, run
`npm run secret:put -- INVITE_URL` again with the new link. The new value
takes effect right away. No site change or deploy is needed, as long as the link
is a plain `https` URL that lands on its own origin. The challenge page's
`form-action` is built from that origin on each request, and Chrome applies it to
the redirect, so a link that redirects again to another origin, such as a `wa.me`
link or a shortener, is blocked and the visitor sees the help text instead of the
group. Use the final `chat.whatsapp.com` link, then do one real pass through
`/join` on production to the group, since no local run can prove a real target.

## Local development

`npm run dev` reads a `.dev.vars` file in this directory, which also overrides
the site key in `wrangler.toml`:

```
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
TURNSTILE_SITEKEY=1x00000000000000000000AA
INVITE_URL=https://example.com/
```

Those are Cloudflare's always-pass test keys and a placeholder URL. `.dev.vars`
and `.wrangler/` are gitignored. Never put a real invite in `.dev.vars`.

`npm run dev` runs `src/dev.js`, not `src/index.js`. The test secret reports its
hostname as `example.com`, and the Worker only accepts tokens from
`gatewaysmash.com` and `www.gatewaysmash.com`, so `dev.js` adds that one host.
The production list is a constant in `src/index.js`, and no variable, secret or
dashboard value can widen it. `npm run deploy` always ships `src/index.js`,
because `main` in `wrangler.toml` names it and it imports nothing. Do not add a
hostname setting, and do not deploy `src/dev.js`.

To see the production check reject a test token, run the real entry point:

```sh
./node_modules/.bin/wrangler dev src/index.js
```

A plain `wrangler dev` does the same, so if every local check ends on "That check
didn't pass", check which entry point is running.

## Tests

From the repo root, with no install in this directory:

```sh
npm run test:worker
```

`npm test` runs them too, so CI does. They run in Node with `fetch` stubbed. They
do not run the page's Turnstile widget, so a change to the challenge page also
needs a look in a real browser, with `challenges.cloudflare.com` blocked, both
cold and with `api.js` already cached, and with JavaScript off.

Any change to the Content-Security-Policy, to `inviteOrigin`, or to the page's
script also needs a full pass in Chrome through to a cross-origin `INVITE_URL`.
That is the only way to see `form-action` block the redirect. The tests catch a
script or style edited without its hash and print the value to use. CLAUDE.md
explains why, under "Security headers".

## When something fails

No failure inside the Worker reaches a visitor as a Cloudflare error page. Each
one is an HTML page with a link back to `/join`, a link home and
`info@gatewaysmash.com`:

| Status | When |
| --- | --- |
| 403 | The token is missing, rejected, or was minted on another hostname |
| 502 | siteverify is unreachable, hangs for 10 seconds or returns something that is not JSON, or `TURNSTILE_SECRET` or `INVITE_URL` is unset |
| 405 | The method is not GET, HEAD or POST, or the POST is not a form |
| 400 | The form body cannot be parsed |

If `/join` gets no token within 4 seconds, or Turnstile reports an error, the
page shows why that can happen and the same address. If the browser blocks the
redirect to the invite, the page shows that same help text, which does not name
this cause, so check `INVITE_URL` first. With JavaScript off it shows its own message and the same address at once.

Logs carry the thrown error's name and nothing else. A wrong `TURNSTILE_SECRET`
logs nothing at all, and neither does an unset one: every visitor gets the 403 or
502 page. If everyone is suddenly
being rejected after a rotation, check that secret first.
