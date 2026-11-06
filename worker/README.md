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

   This registers both routes in the `gatewaysmash.com` zone. The routes only
   apply while the DNS records are proxied (orange cloud).

## Rotating the invite

If the invite is revoked or regenerated in WhatsApp, run
`npm run secret:put -- INVITE_URL` again with the new link. The new value
takes effect right away. No site change or deploy is needed.

## Local development

`npm run dev` reads secrets from a `.dev.vars` file in this directory:

```
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
INVITE_URL=https://example.com/
```

Those are Cloudflare's always-pass test secret and a placeholder URL. For the
site key, use the matching test key `1x00000000000000000000AA`. `.dev.vars`
and `.wrangler/` are gitignored.
