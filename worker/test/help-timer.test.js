// Frozen. A defect from issue 87: the 4-second timer keyed on window.turnstile,
// so a cached api.js left a blocked visitor with no help for 43 seconds. Runs the
// page's real inline script with a fake timer, and asserts the hidden state only.
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

  const timers = [];
  const help = { hidden: true };
  const form = { submit() {} };
  const page = {
    turnstile: {},
    setTimeout(run) {
      timers.push(run);
    },
    addEventListener() {},
    location: { reload() {} },
    document: { getElementById: (id) => (id === 'help' ? help : form) },
  };
  page.window = page;
  runInNewContext(script[1], page);

  assert.ok(timers.length > 0, 'page starts a timer');
  return {
    help,
    solve: () => page[callback[1]]('sentinel-token'),
    fireTimers: () => timers.forEach((run) => run()),
  };
}

test('the timer reveals help when the script loaded but no token arrived', async () => {
  const { help, fireTimers } = await loadPage();
  fireTimers();
  assert.equal(help.hidden, false);
});

test('the timer leaves help hidden once a token has arrived', async () => {
  const { help, solve, fireTimers } = await loadPage();
  solve();
  fireTimers();
  assert.equal(help.hidden, true);
});
