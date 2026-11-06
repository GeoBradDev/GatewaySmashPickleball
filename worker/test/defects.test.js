// Frozen. Each test is a defect issue #87 reported against the join-gate Worker.
// These assert structure only, never copy, so the wording can change freely.
// The invite and the secret below are sentinels and must stay sentinels.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import worker from '../src/index.js';

const JOIN_URL = 'https://www.gatewaysmash.com/join';
const ENV = {
  TURNSTILE_SECRET: 'sentinel-secret',
  TURNSTILE_SITEKEY: 'sentinel-sitekey',
  INVITE_URL: 'https://invite.example.invalid/sentinel',
};
const FORM = {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'cf-turnstile-response=sentinel-token',
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubSiteverify(respond) {
  globalThis.fetch = async () => respond();
}

function siteverifyJson(result) {
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function assertFailurePage(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('Content-Type') ?? '', /^text\/html/i);
  assert.equal(response.headers.get('Location'), null);

  const body = await response.text();
  assert.ok(body.includes('href="/join"'), 'page links back to /join');
  assert.ok(body.includes('href="/"'), 'page links home');
  assert.ok(body.includes('mailto:info@gatewaysmash.com'), 'page carries the contact email');
}

test('siteverify answering 503 with an HTML body gives the 502 page', async () => {
  stubSiteverify(
    () =>
      new Response('<html><body>Service Unavailable</body></html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      })
  );
  await assertFailurePage(await worker.fetch(new Request(JOIN_URL, FORM), ENV), 502);
});

test('siteverify network failure gives the 502 page', async () => {
  stubSiteverify(() => {
    throw new TypeError('fetch failed');
  });
  await assertFailurePage(await worker.fetch(new Request(JOIN_URL, FORM), ENV), 502);
});

test('POST with no body and no content type gives the 405 page', async () => {
  const request = new Request(JOIN_URL, { method: 'POST' });
  await assertFailurePage(await worker.fetch(request, ENV), 405);
});

test('POST with application/json gives the 405 page', async () => {
  const request = new Request(JOIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"cf-turnstile-response":"sentinel-token"}',
  });
  await assertFailurePage(await worker.fetch(request, ENV), 405);
});

test('a rejected token gives the 403 HTML page', async () => {
  stubSiteverify(() => siteverifyJson({ success: false }));
  await assertFailurePage(await worker.fetch(new Request(JOIN_URL, FORM), ENV), 403);
});

test('a passing token from another hostname gives the 403 page', async () => {
  stubSiteverify(() => siteverifyJson({ success: true, hostname: 'evil.example' }));
  await assertFailurePage(await worker.fetch(new Request(JOIN_URL, FORM), ENV), 403);
});

test('a passing token with no hostname gives the 403 page', async () => {
  stubSiteverify(() => siteverifyJson({ success: true }));
  await assertFailurePage(await worker.fetch(new Request(JOIN_URL, FORM), ENV), 403);
});

test('the challenge page explains itself when the widget cannot run', async () => {
  const response = await worker.fetch(new Request(JOIN_URL), ENV);
  const body = await response.text();
  const email = 'mailto:info@gatewaysmash.com';

  assert.match(body, /<h1[\s>]/);
  assert.ok(body.includes('href="/"'), 'page links home');

  const noscript = body.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(noscript, 'page has a noscript block');
  assert.ok(noscript[1].includes(email), 'noscript block carries the contact email');

  const hidden = body.match(/<(\w+)\b[^>]*\shidden[\s>][\s\S]*?<\/\1>/);
  assert.ok(hidden, 'page has a hidden block');
  assert.ok(hidden[0].includes(email), 'hidden block carries the contact email');

  const callback = body.match(/data-error-callback="([^"]+)"/);
  assert.ok(callback, 'widget names an error callback');
  assert.ok(
    body.includes(`function ${callback[1]}(`),
    'inline script defines the error callback'
  );
});
