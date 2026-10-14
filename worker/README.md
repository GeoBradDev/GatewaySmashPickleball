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

1. **Create the Turnstile widget.** In the Cloudflare dashboard, go to
   Turnstile, add a widget, and add `gatewaysmash.com` and
   `www.gatewaysmash.com` as hostnames. Managed mode is fine. Copy the
   **site key** into `TURNSTILE_SITEKEY` under `[vars]` in `wrangler.toml`.
   The site key is public. Keep the **secret key** for the next step.

2. **Set the secrets.** Each command prompts for the value, so nothing lands
   in your shell history:

   ```sh
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put INVITE_URL
   ```

   `TURNSTILE_SECRET` is the widget's secret key. `INVITE_URL` is the full
   WhatsApp invite link.

3. **Deploy.**

   ```sh
   npx wrangler deploy
   ```

   This registers both routes in the `gatewaysmash.com` zone. The routes only
   apply while the DNS records are proxied (orange cloud).

## Rotating the invite

If the invite is revoked or regenerated in WhatsApp, run
`npx wrangler secret put INVITE_URL` again with the new link. The new value
takes effect right away. No site change or deploy is needed.

## Local development

`npx wrangler dev` reads secrets from a `.dev.vars` file in this directory:

```
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
INVITE_URL=https://example.com/
```

Those are Cloudflare's always-pass test secret and a placeholder URL. For the
site key, use the matching test key `1x00000000000000000000AA`. `.dev.vars`
and `.wrangler/` are gitignored.
