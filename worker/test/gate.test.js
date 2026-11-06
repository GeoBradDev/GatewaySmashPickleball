// Everything beyond the frozen defects: the success path, what must never leak,
// method handling, and the wiring that keeps src/dev.js out of production.
// The invite and the secret are sentinels and must stay sentinels.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, test } from 'node:test';
import worker from '../src/index.js';
import dev from '../src/dev.js';

const JOIN_URL = 'https://www.gatewaysmash.com/join';
const INVITE = 'https://invite.example.invalid/sentinel';
const SECRET = 'sentinel-secret';
const ENV = { TURNSTILE_SECRET: SECRET, TURNSTILE_SITEKEY: 'sentinel-sitekey', INVITE_URL: INVITE };
const FORM_TYPE = 'application/x-www-form-urlencoded';
const TOKEN_FIELD = 'cf-turnstile-response';

const real = {
  fetch: globalThis.fetch,
  error: console.error,
  warn: console.warn,
  log: console.log,
};

let logged;
let siteverifyCalls;

beforeEach(() => {
  logged = [];
  siteverifyCalls = [];
  for (const level of ['error', 'warn', 'log']) {
    console[level] = (...args) => logged.push(args.map(String).join(' '));
  }
  globalThis.fetch = async () => {
    throw new Error('siteverify was not stubbed for this test');
  };
});

afterEach(() => {
  globalThis.fetch = real.fetch;
  console.error = real.error;
  console.warn = real.warn;
  console.log = real.log;
});

function stubSiteverify(respond) {
  globalThis.fetch = async (url, init) => {
    siteverifyCalls.push({ url, init });
    return respond();
  };
}

function siteverifyJson(result, status = 200) {
  return new Response(JSON.stringify(result), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function passingToken(hostname = 'www.gatewaysmash.com') {
  stubSiteverify(() => siteverifyJson({ success: true, hostname }));
}

function tokenPost(contentType = FORM_TYPE) {
  return new Request(JOIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: `${TOKEN_FIELD}=sentinel-token`,
  });
}

function multipartPost(value) {
  const form = new FormData();
  form.set(TOKEN_FIELD, value);
  return new Request(JOIN_URL, { method: 'POST', body: form });
}

function assertRedirect(response) {
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), INVITE);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
}

async function assertRefused(response) {
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Location'), null);
  assert.ok(!(await response.text()).includes(INVITE));
}

for (const hostname of ['gatewaysmash.com', 'www.gatewaysmash.com']) {
  test(`a token from ${hostname} redirects, urlencoded`, async () => {
    passingToken(hostname);
    assertRedirect(await worker.fetch(tokenPost(), ENV));
  });

  test(`a token from ${hostname} redirects, multipart`, async () => {
    passingToken(hostname);
    assertRedirect(await worker.fetch(multipartPost('sentinel-token'), ENV));
  });
}

test('siteverify gets the secret and the token', async () => {
  passingToken();
  await worker.fetch(tokenPost(), ENV);

  assert.equal(siteverifyCalls.length, 1);
  const { url, init } = siteverifyCalls[0];
  assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(init.method, 'POST');
  assert.equal(init.body.get('secret'), SECRET);
  assert.equal(init.body.get('response'), 'sentinel-token');
});

test('a mixed-case content type is accepted', async () => {
  passingToken();
  assertRedirect(await worker.fetch(tokenPost('Application/X-WWW-Form-URLEncoded'), ENV));
});

test('success as the string "true" is rejected', async () => {
  stubSiteverify(() => siteverifyJson({ success: 'true', hostname: 'www.gatewaysmash.com' }));
  await assertRefused(await worker.fetch(tokenPost(), ENV));
});

test('a non-200 reply with a JSON body is a rejection, not an outage', async () => {
  stubSiteverify(() => siteverifyJson({ success: false }, 400));
  await assertRefused(await worker.fetch(tokenPost(), ENV));
});

test('Cloudflare error codes do not reach the page', async () => {
  stubSiteverify(() => siteverifyJson({ success: false, 'error-codes': ['sentinel-error-code'] }));
  const response = await worker.fetch(tokenPost(), ENV);
  assert.ok(!(await response.text()).includes('sentinel-error-code'));
});

test('an empty token is refused without calling siteverify', async () => {
  passingToken();
  const request = new Request(JOIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': FORM_TYPE },
    body: `${TOKEN_FIELD}=`,
  });
  await assertRefused(await worker.fetch(request, ENV));
  assert.equal(siteverifyCalls.length, 0);
});

test('a File in the token field is refused without calling siteverify', async () => {
  passingToken();
  const request = multipartPost(new File(['sentinel-token'], 'token.txt'));
  await assertRefused(await worker.fetch(request, ENV));
  assert.equal(siteverifyCalls.length, 0);
});

for (const missing of ['INVITE_URL', 'TURNSTILE_SECRET']) {
  test(`missing ${missing} gives the 502 page without calling siteverify`, async () => {
    passingToken();
    const env = { ...ENV };
    delete env[missing];

    const response = await worker.fetch(tokenPost(), env);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Location'), null);
    assert.equal(siteverifyCalls.length, 0);
  });
}

for (const [name, contentType] of [
  ['with a boundary that is absent from the body', 'multipart/form-data; boundary=sentinel'],
  ['with no boundary at all', 'multipart/form-data'],
]) {
  test(`malformed multipart ${name} gives the 400 page`, async () => {
    const request = new Request(JOIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: 'this is not multipart',
    });
    const response = await worker.fetch(request, ENV);
    assert.equal(response.status, 400);
    assert.ok((await response.text()).includes('href="/join"'));
  });
}

for (const method of ['PUT', 'DELETE', 'OPTIONS']) {
  test(`${method} gives the 405 page with Allow`, async () => {
    const response = await worker.fetch(new Request(JOIN_URL, { method }), ENV);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD, POST');
    assert.ok((await response.text()).includes('href="/join"'));
  });
}

for (const [name, init] of [
  ['application/json', { headers: { 'Content-Type': 'application/json' }, body: '{}' }],
  ['no content type', {}],
]) {
  test(`POST with ${name} gives the 405 page with Allow`, async () => {
    const response = await worker.fetch(new Request(JOIN_URL, { method: 'POST', ...init }), ENV);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD, POST');
  });
}

test('HEAD gives 200', async () => {
  const response = await worker.fetch(new Request(JOIN_URL, { method: 'HEAD' }), ENV);
  assert.equal(response.status, 200);
});

test('siteverify gets a timeout signal', async () => {
  passingToken();
  await worker.fetch(tokenPost(), ENV);
  assert.ok(siteverifyCalls[0].init.signal instanceof AbortSignal);
});

test('a siteverify timeout gives the 502 page', async () => {
  stubSiteverify(() => {
    throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  });
  const response = await worker.fetch(tokenPost(), ENV);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Location'), null);
});

test('siteverify answering the JSON value null gives the 502 page', async () => {
  stubSiteverify(() => new Response('null'));
  const response = await worker.fetch(tokenPost(), ENV);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Location'), null);
});

// Runs the page's own inline script, then fires pageshow at whatever it registered.
async function reloadsOnPageshow(event) {
  const body = await (await worker.fetch(new Request(JOIN_URL), ENV)).text();
  const script = body.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'page has an inline script');

  let reloads = 0;
  const listeners = [];
  const page = {
    setTimeout() {},
    location: {
      reload() {
        reloads += 1;
      },
    },
    addEventListener(type, listener) {
      if (type === 'pageshow') listeners.push(listener);
    },
  };
  page.window = page;
  runInNewContext(script[1], page);

  assert.equal(listeners.length, 1, 'script listens for pageshow once');
  listeners[0](event);
  return reloads;
}

test('a page restored from the back/forward cache reloads', async () => {
  assert.equal(await reloadsOnPageshow({ persisted: true }), 1);
});

test('a normal page load does not reload', async () => {
  assert.equal(await reloadsOnPageshow({ persisted: false }), 0);
});

test('the challenge page uses no inline event-handler attributes', async () => {
  const body = await (await worker.fetch(new Request(JOIN_URL), ENV)).text();
  assert.doesNotMatch(body, /<[^>]*\son[a-z]+=/i);
});

const LEAKY = `${SECRET} ${INVITE}`;
const HTML_PATHS = {
  'siteverify echoing the secret in a non-JSON body': () => {
    stubSiteverify(() => new Response(`<html>${LEAKY}</html>`, { status: 503 }));
    return tokenPost();
  },
  'siteverify rejecting with the secret in its message': () => {
    stubSiteverify(() => {
      throw new TypeError(`fetch failed: ${LEAKY}`);
    });
    return tokenPost();
  },
  'siteverify echoing the secret in its error codes': () => {
    stubSiteverify(() => siteverifyJson({ success: false, 'error-codes': [LEAKY] }));
    return tokenPost();
  },
  'a passing token from another hostname': () => {
    stubSiteverify(() => siteverifyJson({ success: true, hostname: LEAKY }));
    return tokenPost();
  },
  'a non-form content type': () => tokenPost('application/json'),
  'no body': () => new Request(JOIN_URL, { method: 'POST' }),
  'an empty token': () =>
    new Request(JOIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': FORM_TYPE },
      body: '',
    }),
  'malformed multipart': () => tokenPost('multipart/form-data; boundary=sentinel'),
  'an unexpected method': () => new Request(JOIN_URL, { method: 'PUT' }),
  'the challenge page': () => new Request(JOIN_URL),
};

for (const [name, setUp] of Object.entries(HTML_PATHS)) {
  test(`${name}: nothing secret in the page or the logs`, async () => {
    const response = await worker.fetch(setUp(), ENV);
    const body = await response.text();
    const logs = logged.join('\n');

    assert.equal(response.headers.get('Location'), null);
    for (const value of [INVITE, SECRET]) {
      assert.ok(!body.includes(value), 'page must not carry it');
      assert.ok(!logs.includes(value), 'log must not carry it');
    }
  });

  test(`${name}: an HTML, no-store, noindex response`, async () => {
    const response = await worker.fetch(setUp(), ENV);
    assert.match(response.headers.get('Content-Type'), /^text\/html/i);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok((await response.text()).includes('<meta name="robots" content="noindex">'));
  });
}

test('dev.js accepts example.com, which Cloudflare test keys report', async () => {
  passingToken('example.com');
  assertRedirect(await dev.fetch(tokenPost(), ENV, {}));
});

test('dev.js still rejects any other hostname', async () => {
  passingToken('evil.example');
  await assertRefused(await dev.fetch(tokenPost(), ENV, {}));
});

test('index.js rejects example.com', async () => {
  passingToken('example.com');
  await assertRefused(await worker.fetch(tokenPost(), ENV));
});

const workerDir = fileURLToPath(new URL('..', import.meta.url));

function read(...path) {
  return readFileSync(join(workerDir, ...path), 'utf8');
}

test('wrangler.toml deploys src/index.js, not the dev entry', () => {
  assert.match(read('wrangler.toml'), /^main = "src\/index\.js"$/m);
});

test('the deploy script names no entry point of its own', () => {
  assert.equal(JSON.parse(read('package.json')).scripts.deploy, 'wrangler deploy');
});

test('the pages publish the same address as the homepage', async () => {
  const homepage = read('..', 'index.html').match(/mailto:([^"]+)"/);
  assert.ok(homepage, 'homepage has a mailto');

  for (const request of [new Request(JOIN_URL), new Request(JOIN_URL, { method: 'PUT' })]) {
    const body = await (await worker.fetch(request, ENV)).text();
    const addresses = [...body.matchAll(/mailto:([^"]+)"/g)].map((match) => match[1]);
    assert.ok(addresses.length > 0, 'page has a mailto');
    assert.deepEqual([...new Set(addresses)], [homepage[1]]);
  }
});

test('no invite-shaped URL sits in the Worker source or its tests', () => {
  const inviteShaped = /chat\.whatsapp\.com|wa\.me\//i;
  const files = ['src', 'test'].flatMap((dir) =>
    readdirSync(join(workerDir, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
  );

  // A scan over an empty list passes, so name what it has to have read.
  for (const expected of ['index.js', 'dev.js', 'gate.test.js', 'defects.test.js']) {
    assert.ok(
      files.some((file) => file.endsWith(expected)),
      `scan did not reach ${expected}`
    );
  }

  const offenders = files.filter((file) => inviteShaped.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});
