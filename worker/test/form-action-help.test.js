// Frozen. A defect from issue 91: a redirect blocked by form-action left the visitor
// on the challenge page with no help, because the solve had already stopped the
// timer. Runs the page's real inline script in a fake window, and asserts the hidden
// state only.
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import worker from '../src/index.js';

const ENV = { TURNSTILE_SITEKEY: 'sentinel-sitekey' };

async function loadPage() {
  const response = await worker.fetch(new Request('https://www.gatewaysmash.com/join'), ENV);
  const body = await response.text();

  const script = body.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'page has an inline script');
  const callback = body.match(/data-callback="([^"]+)"/);
  assert.ok(callback, 'widget names a success callback');

  const listeners = [];
  const help = { hidden: true };
  const form = { submit() {} };
  const page = {
    setTimeout() {},
    addEventListener(type, listener) {
      if (type === 'securitypolicyviolation') listeners.push(listener);
    },
    location: { reload() {} },
    document: { getElementById: (id) => (id === 'help' ? help : form) },
  };
  page.window = page;
  runInNewContext(script[1], page);

  assert.ok(listeners.length > 0, 'page listens for securitypolicyviolation');
  return {
    help,
    solve: () => page[callback[1]]('sentinel-token'),
    fire: (effectiveDirective) => listeners.forEach((run) => run({ effectiveDirective })),
  };
}

test('a blocked form-action reveals help after the solve', async () => {
  const { help, solve, fire } = await loadPage();
  solve();
  fire('form-action');
  assert.equal(help.hidden, false);
});

test('a blocked script leaves help hidden', async () => {
  const { help, solve, fire } = await loadPage();
  solve();
  fire('script-src-elem');
  assert.equal(help.hidden, true);
});
