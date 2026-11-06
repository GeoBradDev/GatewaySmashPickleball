// The hostnames a Turnstile token may have been solved on. A constant on purpose:
// nothing in env can widen it, so no variable, secret or dashboard value can make
// production accept a token from somewhere else. src/dev.js passes its own list
// for local development, and nothing deployed reaches that file.
const SITE_HOSTNAMES = ['gatewaysmash.com', 'www.gatewaysmash.com'];

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 10000;
const FORM_CONTENT_TYPE = /^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i;
const ALLOW = { Allow: 'GET, HEAD, POST' };

const EMAIL = 'info@gatewaysmash.com';
const CONTACT = `Still stuck? Email <a href="mailto:${EMAIL}">${EMAIL}</a>.`;
const HOME_LINK = '<a href="/">Back to Gateway Smash</a>';

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
// Constants rather than a digest at request time: crypto.subtle is async, and html()
// is a synchronous exit that the catch in fetch() depends on. headers.test.js
// recomputes both from the rendered page and prints the right value when one goes
// stale, which is what stops a page shipping with its own script blocked.
const SCRIPT_HASH = "'sha256-6gCum6/Q//jm9vxUVm4H1V0CzCAG5WVdVmMhT+VXVRQ='";
const STYLE_HASH = "'sha256-Mk3op4wsHDDHexktnPWzL3a7ZSEYE0HJhaurhWZPQJ4='";
// A strict shape for the parsed origin, because parsing is not validation: new URL()
// accepts ; ' " and , in a host and hands them back in .origin, and any of them
// would write a new directive or a broken token into the header.
const SAFE_ORIGIN = /^https?:\/\/[a-z0-9]+(?:(?:\.|-+)[a-z0-9]+)*(?::\d+)?$/;
const SAFE_PROTOCOL = /^https?:$/;
const COMMON_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

export default {
  async fetch(request, env, ctx, allowedHostnames = SITE_HOSTNAMES) {
    try {
      if (request.method === 'GET' || request.method === 'HEAD') {
        return html(challengePage(env.TURNSTILE_SITEKEY), 200, {}, challengePolicy(env));
      }
      if (request.method === 'POST') {
        return await verify(request, env, allowedHostnames);
      }
      return badRequest(405, ALLOW);
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
    return badRequest(405, ALLOW);
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
      headers: { Location: env.INVITE_URL, 'Cache-Control': 'no-store', ...COMMON_HEADERS },
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

// The single exit for every HTML response. The policy defaults to the narrow one,
// so a caller that forgets the argument fails closed.
function html(body, status = 200, headers = {}, policy = failurePolicy()) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': policy,
      ...COMMON_HEADERS,
      ...headers,
    },
  });
}

// The nonce is for Cloudflare, not for us. It reads the nonce from this header and
// applies it to the script it injects into every HTML response, which differs per
// response and so can never be hashed. No element of ours carries it.
function nonceSource() {
  return `'nonce-${crypto.randomUUID()}'`;
}

function challengePolicy(env) {
  return [
    "default-src 'none'",
    `script-src ${nonceSource()} ${SCRIPT_HASH} 'self' ${TURNSTILE_ORIGIN}`,
    `style-src ${STYLE_HASH}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "connect-src 'self'",
    // Browsers apply form-action to the redirect after the POST, so the 302 to the
    // invite is blocked unless its origin is here. Only the origin, or the invite
    // code would be in a public header. With no usable origin this stays at 'self'
    // so the page still renders. The POST's 302 to a cross-origin one is then blocked
    // in the browser, and the page's form-action listener shows the help text. The
    // same goes for a redirect from the invite to an origin not listed here.
    `form-action ${["'self'", inviteOrigin(env)].filter(Boolean).join(' ')}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// A failure page has no script of ours. It still needs a script-src, or Cloudflare's
// injected script logs a violation on every 403 and 502.
function failurePolicy() {
  return [
    "default-src 'none'",
    `script-src ${nonceSource()} 'self'`,
    `style-src ${STYLE_HASH}`,
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Must never throw: GET /join is served from inside the outer try, so a throw here
// would turn a bad secret into a 502 on the challenge page itself. blob: is why the
// scheme is checked too, since it reports its inner https origin.
function inviteOrigin(env) {
  try {
    const { protocol, origin } = new URL(env.INVITE_URL);
    return SAFE_PROTOCOL.test(protocol) && SAFE_ORIGIN.test(origin) ? origin : '';
  } catch {
    return '';
  }
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
    <p id="help" role="status" hidden>Still waiting? A content blocker or a school or work network can stop this check. Turn the blocker off or try another network. ${CONTACT}</p>
    <noscript><p>This check needs JavaScript. Turn it on and reload this page. ${CONTACT}</p></noscript>
    <p>${HOME_LINK}</p>
    <script>
      var solved = false;
      function done() { solved = true; document.getElementById('f').submit(); }
      function showHelp() { document.getElementById('help').hidden = false; }
      window.addEventListener('securitypolicyviolation', function (event) { if (event.effectiveDirective === 'form-action') showHelp(); });
      setTimeout(function () { if (!solved) showHelp(); }, 4000);
      window.addEventListener('pageshow', function (event) { if (event.persisted) location.reload(); });
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
