// Checks that every outbound link in the site still resolves.
//
// Deliberately not part of `npm test`. Every link here is to a third party
// that can rate-limit, block a datacentre IP, or simply be down for a minute,
// and a build that fails for those reasons trains people to ignore it. This
// runs on a schedule instead, where a failure is a notification rather than a
// blocked merge.
//
// The links that matter most are the ones a prospective player uses: the
// Global Pickleball Network registration and the WhatsApp group invite.
// WhatsApp invites in particular can be revoked or regenerated at any time.

import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const PAGES = ['index.html', '404.html'];
const TIMEOUT_MS = 20000;

// Some hosts serve a bot wall to anything that does not look like a browser.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const links = new Map();
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(rootDir, page), 'utf8');
  for (const match of html.matchAll(/\bhref=["'](https?:\/\/[^"']+)["']/g)) {
    if (!links.has(match[1])) {
      links.set(match[1], page);
    }
  }
}

if (links.size === 0) {
  console.log('No outbound links found.');
  process.exit(0);
}

async function attempt(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers: HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const failures = [];

for (const [url, page] of links) {
  let status = null;
  let note = '';
  try {
    // HEAD first because it is cheap; plenty of hosts answer it with 405.
    let res = await attempt(url, 'HEAD');
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await attempt(url, 'GET');
      note = ' (via GET)';
    }
    status = res.status;
    if (!res.ok) {
      failures.push(url + ' -> HTTP ' + res.status + ' (in ' + page + ')');
    }
  } catch (error) {
    failures.push(url + ' -> ' + error.message + ' (in ' + page + ')');
  }
  console.log(
    (status && status < 400 ? 'ok  ' : 'FAIL') + ' ' + (status || 'ERR') + '  ' + url + note
  );
}

if (failures.length > 0) {
  console.error('\n' + failures.length + ' link(s) need attention:');
  failures.forEach((failure) => console.error('  ' + failure));
  process.exit(1);
}

console.log('\nAll ' + links.size + ' outbound links resolve.');
