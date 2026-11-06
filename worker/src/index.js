// The hostnames a Turnstile token may have been solved on. A constant on purpose:
// nothing in env can widen it, so no variable, secret or dashboard value can make
// production accept a token from somewhere else. src/dev.js passes its own list
// for local development, and nothing deployed reaches that file.
const SITE_HOSTNAMES = ['gatewaysmash.com', 'www.gatewaysmash.com'];

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 10000;
const FORM_CONTENT_TYPE = /^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i;

const EMAIL = 'info@gatewaysmash.com';
const CONTACT = `Still stuck? Email <a href="mailto:${EMAIL}">${EMAIL}</a>.`;
const HOME_LINK = '<a href="/">Back to Gateway Smash</a>';

export default {
  async fetch(request, env, ctx, allowedHostnames = SITE_HOSTNAMES) {
    try {
      if (request.method === 'GET' || request.method === 'HEAD') {
        return html(challengePage(env.TURNSTILE_SITEKEY));
      }
      if (request.method === 'POST') {
        return await verify(request, env, allowedHostnames);
      }
      return badRequest(405, { Allow: 'GET, HEAD, POST' });
    } catch (error) {
      // The name only. A message can quote the response body it failed to parse,
      // and that body is not ours to log.
      console.error('join-gate: request failed', error?.name);
      return unavailable();
    }
  },
};

async function verify(request, env, allowedHostnames) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!FORM_CONTENT_TYPE.test(contentType)) {
    return badRequest(405);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest(400);
  }

  // A multipart field can be a File, which is not a token.
  const token = form.get('cf-turnstile-response');
  if (typeof token !== 'string' || token === '') {
    return rejected();
  }

  if (!env.TURNSTILE_SECRET || !env.INVITE_URL) {
    return unavailable();
  }

  const response = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: request.headers.get('CF-Connecting-IP') || '',
    }),
    signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
  });

  // response.ok is deliberately not consulted: a rejected token can be a non-200
  // with a JSON body, so only the parsed result decides. Anything that is not JSON
  // throws, and the outer catch turns that into the 502 page.
  const result = await response.json();

  if (result.success === true && allowedHostnames.includes(result.hostname)) {
    return new Response(null, {
      status: 302,
      headers: { Location: env.INVITE_URL, 'Cache-Control': 'no-store' },
    });
  }
  return rejected();
}

function rejected() {
  return failure(403, "That check didn't pass", 'It may have timed out. Try it again.');
}

function unavailable() {
  return failure(
    502,
    "We couldn't run the check",
    "The check service didn't answer, so nothing went wrong on your side. Try again in a minute."
  );
}

function badRequest(status, headers) {
  return failure(status, "That request didn't work", 'Start again from the join page.', headers);
}

// The single exit for every HTML response.
function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function failure(status, heading, message, headers) {
  return html(
    shell(
      heading,
      `<h1>${heading}</h1>
    <p>${message}</p>
    <p><a href="/join">Try again</a></p>
    <p>${HOME_LINK}</p>
    <p>${CONTACT}</p>`
    ),
    status,
    headers
  );
}

function challengePage(siteKey) {
  return shell(
    'Join the community',
    `<h1>Join the WhatsApp group</h1>
    <form id="f" method="POST" action="/join">
      <p>Quick check, then you'll be sent to WhatsApp.</p>
      <div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="done"
           data-error-callback="showHelp" data-expired-callback="showHelp" data-timeout-callback="showHelp"></div>
    </form>
    <p id="help" role="status" hidden>The check didn't load. A content blocker or a school or work network can stop it. Turn the blocker off or try another network. ${CONTACT}</p>
    <noscript><p>This check needs JavaScript. Turn it on and reload this page. ${CONTACT}</p></noscript>
    <p>${HOME_LINK}</p>
    <script>
      function done() { document.getElementById('f').submit(); }
      function showHelp() { document.getElementById('help').hidden = false; }
      setTimeout(function () { if (!window.turnstile) showHelp(); }, 4000);
    </script>`,
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
  );
}

function shell(title, body, head = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  ${head}
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center;
           min-height: 100vh; margin: 0; padding: 16px; text-align: center;
           box-sizing: border-box; }
    main { max-width: 32rem; }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`;
}
