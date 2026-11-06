// The response headers on /join: which ones every path carries, what the policy
// allows, and what an odd INVITE_URL is allowed to do to it. Not frozen: the policy
// text is expected to move. The invite and the secret are sentinels.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import worker from '../src/index.js';

const JOIN_URL = 'https://www.gatewaysmash.com/join';
const INVITE_ORIGIN = 'https://invite.example.invalid';
const INVITE = `${INVITE_ORIGIN}/sentinel`;
const TURNSTILE = 'https://challenges.cloudflare.com';
const ENV = {
  TURNSTILE_SECRET: 'sentinel-secret',
  TURNSTILE_SITEKEY: 'sentinel-sitekey',
  INVITE_URL: INVITE,
};

const CSP = 'Content-Security-Policy';
const NONCE = /'nonce-([^']+)'/;
const realFetch = globalThis.fetch;
const realError = console.error;

beforeEach(() => {
  console.error = () => {};
  globalThis.fetch = async () => {
    throw new TypeError('siteverify was not stubbed for this test');
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

function stubSiteverify(result) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
}

function post(contentType = 'application/x-www-form-urlencoded', body = 'cf-turnstile-response=t') {
  return new Request(JOIN_URL, { method: 'POST', headers: { 'Content-Type': contentType }, body });
}

const get = (env = ENV) => worker.fetch(new Request(JOIN_URL), env);
const head = (env = ENV) => worker.fetch(new Request(JOIN_URL, { method: 'HEAD' }), env);

// Every way out of the Worker that renders a page, with the status it must have.
const PAGES = {
  'GET, 200': [200, () => get()],
  'HEAD, 200': [200, () => head()],
  'unparseable form, 400': [
    400,
    () => worker.fetch(post('multipart/form-data; boundary=sentinel', 'nope'), ENV),
  ],
  'rejected token, 403': [
    403,
    () => {
      stubSiteverify({ success: false });
      return worker.fetch(post(), ENV);
    },
  ],
  'bad method, 405': [405, () => worker.fetch(new Request(JOIN_URL, { method: 'PUT' }), ENV)],
  'siteverify down, 502': [502, () => worker.fetch(post(), ENV)],
};

const FAILURES = Object.entries(PAGES).filter(([, [status]]) => status >= 400);

const redirect = () => {
  stubSiteverify({ success: true, hostname: 'www.gatewaysmash.com' });
  return worker.fetch(post(), ENV);
};

function directives(response) {
  const policy = response.headers.get(CSP);
  assert.ok(policy, 'response has a CSP');
  return new Map(
    policy.split(';').map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    })
  );
}

// The nonce differs per response by design, so compare everything else.
function normalised(response) {
  return response.headers.get(CSP).replace(NONCE, "'nonce-N'");
}

function sha256(text) {
  return `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
}

function inlineBlock(body, tag) {
  const block = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  assert.ok(block, `page has an inline ${tag}`);
  return block[1];
}

for (const [name, [status, respond]] of Object.entries(PAGES)) {
  test(`${name}: carries nosniff, no-referrer and a locked-down CSP`, async () => {
    const response = await respond();
    assert.equal(response.status, status);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');

    const policy = directives(response);
    assert.deepEqual(policy.get('default-src'), ["'none'"]);
    assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(policy.get('base-uri'), ["'none'"]);
  });

  test(`${name}: nothing in the policy reopens what it closes`, async () => {
    const policy = (await respond()).headers.get(CSP);
    assert.doesNotMatch(policy, /'unsafe-inline'|'unsafe-eval'|\s\*(\s|;|$)/);
  });

  test(`${name}: sends no HSTS`, async () => {
    assert.equal((await respond()).headers.get('Strict-Transport-Security'), null);
  });
}

test('the 302 carries no-referrer and nosniff, and no policy or HSTS', async () => {
  const response = await redirect();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get(CSP), null);
  assert.equal(response.headers.get('Strict-Transport-Security'), null);
});

test('HEAD gets the same headers as GET, invite origin included', async () => {
  const fromGet = await get();
  const fromHead = await head();

  assert.deepEqual(directives(fromHead).get('form-action'), ["'self'", INVITE_ORIGIN]);
  assert.equal(normalised(fromHead), normalised(fromGet));

  const others = (response) =>
    [...response.headers].filter(([name]) => name.toLowerCase() !== CSP.toLowerCase());
  assert.deepEqual(others(fromHead), others(fromGet));
});

test("the challenge policy's hashes match the page's own inline blocks", async () => {
  const response = await get();
  const policy = directives(response);
  const body = await response.text();

  assert.ok(
    policy.get('script-src').includes(sha256(inlineBlock(body, 'script'))),
    `script-src needs ${sha256(inlineBlock(body, 'script'))}`
  );
  assert.deepEqual(policy.get('style-src'), [sha256(inlineBlock(body, 'style'))]);
});

test('the challenge policy allows Turnstile to load and to frame', async () => {
  const policy = directives(await get());
  assert.ok(policy.get('script-src').includes(TURNSTILE));
  assert.deepEqual(policy.get('frame-src'), [TURNSTILE]);
});

test('the challenge policy allows the same-origin path Cloudflare injects', async () => {
  const policy = directives(await get());
  assert.ok(policy.get('script-src').includes("'self'"));
  assert.deepEqual(policy.get('connect-src'), ["'self'"]);
});

for (const [name, [, respond]] of FAILURES) {
  test(`${name}: the policy grants a failure page nothing the page does not need`, async () => {
    const response = await respond();
    const policy = directives(response);
    const body = await response.text();

    assert.deepEqual(policy.get('form-action'), ["'none'"]);
    assert.deepEqual(policy.get('style-src'), [sha256(inlineBlock(body, 'style'))]);
    assert.deepEqual(policy.get('connect-src'), ["'self'"]);
    assert.equal(policy.get('frame-src'), undefined);

    const script = policy.get('script-src');
    assert.equal(script.length, 2);
    assert.match(script[0], NONCE);
    assert.equal(script[1], "'self'");
    assert.ok(!response.headers.get(CSP).includes(TURNSTILE));
    assert.ok(!response.headers.get(CSP).includes(INVITE_ORIGIN));
  });
}

test('form-action is self plus the invite origin, and no header carries its path', async () => {
  for (const response of [await get(), await head()]) {
    assert.deepEqual(directives(response).get('form-action'), ["'self'", INVITE_ORIGIN]);
    for (const [name, value] of response.headers) {
      assert.ok(!value.includes('sentinel-secret'), `${name} carries the secret`);
      assert.ok(!value.includes('/sentinel'), `${name} carries the invite path`);
    }
  }
});

for (const [name, url, origin] of [
  ['a port', 'https://invite.example.invalid:8443/a', 'https://invite.example.invalid:8443'],
  ['upper case', 'https://INVITE.example.invalid/a', INVITE_ORIGIN],
  ['plain http, as a local echo server has', 'http://127.0.0.1:8942/a', 'http://127.0.0.1:8942'],
  ['credentials', 'https://user:pw@invite.example.invalid/a', INVITE_ORIGIN],
  ['an xn-- host', 'https://xn--bcher-kva.example/a', 'https://xn--bcher-kva.example'],
  ['a hyphenated host', 'https://in-vite.example.invalid/a', 'https://in-vite.example.invalid'],
  ['a trailing space, the likeliest paste error', `${INVITE} `, INVITE_ORIGIN],
  ['a trailing newline', `${INVITE}\n`, INVITE_ORIGIN],
]) {
  test(`form-action reads the origin out of an invite with ${name}`, async () => {
    const response = await get({ ...ENV, INVITE_URL: url });
    assert.deepEqual(directives(response).get('form-action'), ["'self'", origin]);
  });
}

// Each of these is what new URL() really does, measured in Node. The ones with a
// punctuation mark in the host parse and hand it straight back in .origin, so
// `new URL(x).origin` alone would write a semicolon or a quote into the header.
const NOT_AN_ORIGIN = {
  unset: undefined,
  empty: '',
  'not a URL': 'not a url',
  'a semicolon in the host': 'https://x;script-src-elem.example/',
  'a percent-encoded semicolon': 'https://x%3Bscript-src.example/',
  'a single quote in the host': "https://x'y.example/",
  'a percent-encoded quote': 'https://x%27y.example/',
  'a double quote in the host': 'https://x"y.example/',
  'a comma in the host': 'https://x,y.example/',
  'a star for a host': 'https://*/',
  'a star in the host': 'https://x*.example/',
  'a host with no label': 'https://.../',
  'a host that opens on a hyphen': 'https://-.example/',
  'an empty label in the host': 'https://a..b.example/',
  'a dot beside a hyphen': 'https://a.-b.example/',
  'an underscore in the host': 'https://my_host.example/x',
  'an IPv6 host': 'https://[::1]:8000/',
  'the whatsapp: scheme': 'whatsapp://send?text=x',
  'a data: URL': 'data:text/html,hi',
  'a javascript: URL': 'javascript:alert(1)',
  'an ftp: URL': 'ftp://invite.example.invalid/',
  'a blob: URL, whose origin is a clean https one': 'blob:https://invite.example.invalid/x',
};

for (const [name, url] of Object.entries(NOT_AN_ORIGIN)) {
  for (const [method, respond] of [
    ['GET', get],
    ['HEAD', head],
  ]) {
    test(`${method} with INVITE_URL as ${name} renders 200 on the fallback policy`, async () => {
      const response = await respond({ ...ENV, INVITE_URL: url });
      assert.equal(response.status, 200);
      assert.deepEqual(directives(response).get('form-action'), ["'self'"]);

      const noInvite = { ...ENV };
      delete noInvite.INVITE_URL;
      assert.equal(normalised(response), normalised(await respond(noInvite)));
    });
  }
}

test('with no INVITE_URL the page still renders the challenge', async () => {
  const env = { ...ENV };
  delete env.INVITE_URL;
  const body = await (await get(env)).text();
  assert.ok(body.includes('class="cf-turnstile"'));
});

test('POST with INVITE_URL unset still fails closed, on the failure policy', async () => {
  stubSiteverify({ success: true, hostname: 'www.gatewaysmash.com' });
  const env = { ...ENV };
  delete env.INVITE_URL;

  const response = await worker.fetch(post(), env);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Location'), null);
  assert.deepEqual(directives(response).get('form-action'), ["'none'"]);
});

test('POST with INVITE_URL malformed still refuses a bad token', async () => {
  stubSiteverify({ success: false });
  const response = await worker.fetch(post(), { ...ENV, INVITE_URL: 'not a url' });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Location'), null);
  assert.deepEqual(directives(response).get('form-action'), ["'none'"]);
});

test('POST with INVITE_URL malformed and a good token answers as it always has', async () => {
  stubSiteverify({ success: true, hostname: 'www.gatewaysmash.com' });
  const response = await worker.fetch(post(), { ...ENV, INVITE_URL: 'not a url' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'not a url');
});

test('every response gets its own nonce, and the page carries neither', async () => {
  const first = await get();
  const second = await get();
  const [firstNonce, secondNonce] = [first, second].map(
    (response) => response.headers.get(CSP).match(NONCE)[1]
  );

  assert.notEqual(firstNonce, secondNonce);
  for (const body of [await first.text(), await second.text()]) {
    assert.ok(!body.includes(firstNonce));
    assert.ok(!body.includes(secondNonce));
  }
});

test('a failure page has a nonce of its own too', async () => {
  const [, respond] = PAGES['bad method, 405'];
  const first = (await respond()).headers.get(CSP).match(NONCE)[1];
  const second = (await respond()).headers.get(CSP).match(NONCE)[1];
  assert.notEqual(first, second);
});
