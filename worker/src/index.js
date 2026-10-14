export default {
  async fetch(request, env) {
    if (request.method === 'POST') {
      const form = await request.formData();
      const token = form.get('cf-turnstile-response') || '';
      const ip = request.headers.get('CF-Connecting-IP') || '';

      const verify = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          body: new URLSearchParams({
            secret: env.TURNSTILE_SECRET,
            response: token,
            remoteip: ip,
          }),
        }
      );
      const result = await verify.json();

      if (result.success) {
        return new Response(null, {
          status: 302,
          headers: { Location: env.INVITE_URL, 'Cache-Control': 'no-store' },
        });
      }
      return new Response('Verification failed. Please go back and try again.', {
        status: 403,
      });
    }

    return new Response(page(env.TURNSTILE_SITEKEY), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  },
};

function page(siteKey) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Join the community</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center;
           min-height: 100vh; margin: 0; padding: 16px; text-align: center; }
  </style>
</head>
<body>
  <form id="f" method="POST" action="/join">
    <p>Quick check, then you'll be sent to WhatsApp.</p>
    <div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="done"></div>
  </form>
  <script>function done() { document.getElementById('f').submit(); }</script>
</body>
</html>`;
}
