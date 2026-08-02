// Build-output smoke checks. Runs against dist/ after `npm run build`.
// Deliberately dependency-free; wiring up a real test runner is issue #13.
//
// Asset filenames are content-hashed, so nothing here may hardcode them.
// Every check resolves the real name out of dist/index.html first. A check
// that assumed `js/app.js` would pass against a build that had silently
// stopped hashing, which is the exact regression #5 was about.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (error) {
    failures.push(name + ': ' + error.message);
    console.log('not ok - ' + name);
  }
}

function noop() {}

const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');

// A content hash, as Vite emits it: name-HASH.ext with a base64url-ish hash.
const HASHED = /-[A-Za-z0-9_-]{8,}\.(js|css)$/;

// One origin, declared in several places that all have to agree. og:url was
// shipped empty, which is the failure mode: nothing breaks, link previews just
// quietly have no canonical target.
const CANONICAL = 'https://www.gatewaysmash.com/';
const ORIGIN = CANONICAL.replace(/\/$/, '');

// Every built page a visitor navigates to. Derived from the built output rather
// than hardcoded, so a page added to vite.config.js is covered the moment it
// builds and cannot quietly ship without a canonical, a sitemap entry, or a
// hashed bundle. Any list of pages kept in step by hand is the trap that let #46
// ship a fifth page html-validate never saw.
//
// Declared up here, above the first check that reads it, because check() runs
// its callback immediately: a const declared further down is in the temporal
// dead zone for every check above it, and the ReferenceError that causes is
// caught by check() and reported as an ordinary content failure, so a wiring
// mistake would read as a copy bug. Same reason NUMBER_WORDS is hoisted.
//
// 404.html is deliberately absent: it is not an index.html, it is standalone by
// design, and the check that it stays standalone is its own.
const CONTENT_PAGES = walk(distDir)
  .filter((rel) => rel.endsWith('index.html'))
  .map((rel) => ({
    file: rel,
    url: CANONICAL + rel.replace(/index\.html$/, ''),
  }));

function pageHtml(page) {
  return fs.readFileSync(path.join(distDir, page.file), 'utf8');
}

// Every check that loops CONTENT_PAGES passes vacuously on an empty list: a
// forEach over nothing pushes no problems, so "no page loads a third-party
// script" and "every page names one hashed bundle" both report ok against zero
// pages. Deriving the list from dist/ is what makes it maintenance-free and is
// also what makes it silently emptiable, by a build that stops emitting a page.
// So the floor is asserted once, here, ahead of the first check that loops it.
//
// The floor is the sitemap's own entry count rather than a number written here,
// because the sitemap already has to name every page: the canonical check lower
// down requires each built page to appear in it, and this is that same
// requirement pointing the other way. A page that stops building fails here
// instead of quietly shrinking the set every loop below runs over.
check('every page the sitemap lists was actually built', function () {
  const sitemap = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8');
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (listed.length === 0) {
    throw new Error('sitemap.xml lists no pages at all, so it can vouch for nothing');
  }
  const built = new Set(CONTENT_PAGES.map((page) => page.url));
  const missing = listed.filter((url) => !built.has(url));
  if (missing.length > 0) {
    throw new Error(
      'listed in sitemap.xml but not built: ' + missing.join(', ') +
        '; dist/ has ' + JSON.stringify(CONTENT_PAGES.map((page) => page.file))
    );
  }
});

// The JSON-LD <script> and its contents. Four checks need this, against two
// different pages, and each wants to report its own failure in its own words,
// so the pattern is shared while the error messages stay local. It had been
// copied out once per check, which is the same trap as any other list kept in
// step by hand: widen one copy and the others silently keep matching less.
// Deliberately not /g. String.match with a global regex returns every match and
// no capture groups at all, so block[1] would be undefined and JSON.parse would
// throw on it.
const JSON_LD_BLOCK =
  /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/;

// The page as a reader and a crawler actually receive it. Every "the page must
// say this too" assertion has to search *this*, never the raw file, because
// three parts of the file carry text nobody reads: the JSON-LD block would
// satisfy itself, <head> holds meta content, and HTML comments are stripped by
// no build step here and survive into dist/ intact.
//
// The comment case is not hypothetical. #48 added an address to the page and a
// comment above the block explaining that the address comes from the Contact
// section. Deleting the address from the Contact card then left the check
// green, because it found the sentence describing the rule instead of the page
// obeying it. An assertion that a comment can satisfy is worse than no
// assertion: it reads as coverage.
function visiblePage(html, block) {
  return html
    .slice(html.indexOf('<body'))
    .replace(block, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

// Collects the one asset URL each content page names, and reports every page
// that has none or several rather than stopping at the first. Returns the
// dist-relative refs keyed by page file.
//
// Every content page is its own Vite entry point with its own <head>, so each
// one can regress on its own. #1 shipped a page that loaded app.js twice; a
// version of this that read index.html alone would let that land on /faq/ today
// with npm test green, and pushing to main is the deploy.
function assetRefs(label, pattern, problems) {
  const refs = new Map();
  CONTENT_PAGES.forEach(function (page) {
    const matches = [...pageHtml(page).matchAll(pattern)].map((m) =>
      m[1].replace(/^\//, '')
    );
    if (matches.length !== 1) {
      problems.push(
        'expected exactly 1 ' + label + ' in dist/' + page.file + ', found ' +
          matches.length + ': ' + JSON.stringify(matches)
      );
      return;
    }
    if (!HASHED.test(matches[0])) {
      problems.push(
        'dist/' + page.file + ': ' + label + ' is not content-hashed: ' + matches[0]
      );
      return;
    }
    refs.set(page.file, matches[0]);
  });

  // One emitted bundle and one emitted stylesheet serve every page, and the
  // checks below that read the bundle or the stylesheet resolve the name once,
  // from the homepage. Requiring every page to name the same file is what keeps
  // those honest: give one page its own chunk and they would silently cover the
  // homepage's copy only, so this goes red rather than quietly narrowing. Vite
  // does exactly that the moment a page's script list stops matching the others.
  if (new Set(refs.values()).size > 1) {
    problems.push(
      'content pages disagree on which ' + label + ' to load: ' +
        [...refs].map(([file, ref]) => file + ' -> ' + ref).join(', ')
    );
  }
  return refs;
}

let scriptRef = null;
let styleRef = null;

check('every content page references exactly one hashed module script', function () {
  const problems = [];
  const refs = assetRefs(
    'module script',
    /<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/g,
    problems
  );
  // Assigned before the problems are thrown, so a broken subpage reports itself
  // rather than cascading into every downstream check as a null path.
  scriptRef = refs.get('index.html') ?? null;
  new Set(refs.values()).forEach(function (ref) {
    if (!fs.existsSync(path.join(distDir, ref))) {
      problems.push('referenced script is missing from dist/: ' + ref);
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

check('every content page references exactly one hashed stylesheet', function () {
  const problems = [];
  const refs = assetRefs(
    'stylesheet link',
    /<link[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/g,
    problems
  );
  styleRef = refs.get('index.html') ?? null;
  new Set(refs.values()).forEach(function (ref) {
    const target = path.join(distDir, ref);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      problems.push('referenced stylesheet is missing or empty: ' + ref);
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// The stylesheet bypassed the build entirely under webpack, shipping at full
// source size. Minification is the observable proof it is in the pipeline now.
check('the emitted stylesheet is minified', function () {
  const source = fs.readFileSync(path.join(rootDir, 'css', 'style.css'), 'utf8');
  const emitted = fs.readFileSync(path.join(distDir, styleRef), 'utf8');
  if (emitted.length >= source.length) {
    throw new Error(
      'emitted css is not smaller than source: ' + emitted.length +
        ' vs ' + source.length + ' bytes'
    );
  }
  const sourceLines = source.split('\n').length;
  if (emitted.split('\n').length > sourceLines / 2) {
    throw new Error('emitted css still carries source formatting');
  }
});

// The 404 page carries its own styles so it still renders when the hashed
// stylesheet is the thing that failed. That only holds if it stays standalone.
check('dist/404.html is branded, self-contained, and links home', function () {
  const target = path.join(distDir, '404.html');
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    throw new Error('dist/404.html is missing or empty');
  }
  const html = fs.readFileSync(target, 'utf8');

  if (!/<a[^>]*\bhref=["']\/["']/.test(html)) {
    throw new Error('no link back to the site, which is the whole point of the page');
  }
  if (!/<style/.test(html)) {
    throw new Error('no inline styles, so a failed stylesheet leaves it unstyled');
  }
  if (/<link[^>]*\brel=["']stylesheet["']/.test(html)) {
    throw new Error('depends on an external stylesheet, so it is no longer self-contained');
  }
  const external = [...html.matchAll(/<(?:link|script)[^>]*\b(?:href|src)=["'](https?:\/\/[^"']+)["']/g)];
  if (external.length > 0) {
    throw new Error('third-party subresources: ' + external.map((m) => m[1]).join(', '));
  }
  if (!/Gateway Smash/.test(html)) {
    throw new Error('does not mention Gateway Smash, so it reads as a stranger\'s error page');
  }
});

// Walks a directory to a flat list of paths relative to it.
function walk(dir, prefix = '') {
  return fs.readdirSync(dir).flatMap(function (entry) {
    const full = path.join(dir, entry);
    const rel = prefix ? prefix + '/' + entry : entry;
    return fs.statSync(full).isDirectory() ? walk(full, rel) : [rel];
  });
}

// public/ is Vite's verbatim passthrough. Deriving the expectation from the
// directory rather than a hardcoded list means adding a file to public/ cannot
// silently stop shipping, which is how the old nine-entry list could drift.
check('every file in public/ reaches dist/ at the same path and size', function () {
  const problems = walk(publicDir).filter(function (rel) {
    const target = path.join(distDir, rel);
    if (!fs.existsSync(target)) {
      return true;
    }
    return fs.statSync(target).size !== fs.statSync(path.join(publicDir, rel)).size;
  });
  if (problems.length > 0) {
    throw new Error('missing or altered in dist/: ' + problems.join(', '));
  }
});

// Resolves a URL as written in the HTML against dist/, and reports the ones
// that do not exist. Root-relative and relative both land in the same place,
// since dist/ is the document root. Absolute URLs on our own origin are
// resolved to their path; absolute URLs anywhere else cannot be checked
// against dist/ at all and are reported as such.
function missingFromDist(urls) {
  return urls.filter(function (url) {
    let rel = url;
    if (/^https?:\/\//.test(url)) {
      if (!url.startsWith(ORIGIN + '/')) {
        return true;
      }
      rel = url.slice(ORIGIN.length);
    }
    return !fs.existsSync(path.join(distDir, rel.split('?')[0].replace(/^\//, '')));
  });
}

// The orphaned manifest carried icon paths that were root-relative to files
// that lived one directory down, so every one of them would have 404'd. That
// is silent: nothing fails a build, the install prompt just shows no icon.
check('every icon and manifest URL in dist/index.html resolves', function () {
  const urls = [
    ...[...indexHtml.matchAll(/<link[^>]*\brel=["'](?:icon|apple-touch-icon|manifest)["'][^>]*\bhref=["']([^"']+)["']/g)],
    ...[...indexHtml.matchAll(/<meta[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["']([^"']+)["']/g)],
  ].map((m) => m[1]);

  if (urls.length < 5) {
    throw new Error('expected at least 5 icon/manifest URLs, found ' + urls.length);
  }
  const missing = missingFromDist(urls);
  if (missing.length > 0) {
    throw new Error('referenced but not in dist/: ' + missing.join(', '));
  }
});

// index.html once declared a PNG as type="image/svg+xml". html-validate does
// not catch that, because the markup is structurally valid; only the claim
// about the file is wrong. So it is checked here.
check('every declared link type matches the file it points at', function () {
  const EXTENSION_TYPES = {
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': ['image/x-icon', 'image/vnd.microsoft.icon'],
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
  };

  const wrong = [];
  for (const match of indexHtml.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0];
    const href = tag.match(/\bhref=["']([^"']+)["']/);
    const type = tag.match(/\btype=["']([^"']+)["']/);
    if (!href || !type) {
      continue;
    }
    const ext = path.extname(href[1].split('?')[0]).toLowerCase();
    const expected = EXTENSION_TYPES[ext];
    if (!expected) {
      continue;
    }
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(type[1])) {
      wrong.push(href[1] + ' declared as ' + type[1] + ', expected ' + allowed.join(' or '));
    }
  }
  if (wrong.length > 0) {
    throw new Error(wrong.join('; '));
  }
});

check('the web manifest is installable and its icons exist', function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'site.webmanifest'), 'utf8'));

  ['name', 'short_name'].forEach(function (field) {
    if (!manifest[field]) {
      throw new Error(field + ' is empty, so the home screen label would be blank');
    }
  });
  if (manifest.display !== 'standalone') {
    throw new Error('display is ' + JSON.stringify(manifest.display) + ', so it installs as a shortcut');
  }

  const sizes = (manifest.icons || []).map((icon) => icon.sizes);
  ['192x192', '512x512'].forEach(function (size) {
    if (!sizes.includes(size)) {
      throw new Error('no ' + size + ' icon; installability wants both');
    }
  });
  if (!(manifest.icons || []).some((icon) => icon.purpose === 'maskable')) {
    throw new Error('no maskable icon, so Android letterboxes the icon in a white circle');
  }

  const missing = missingFromDist(manifest.icons.map((icon) => icon.src));
  if (missing.length > 0) {
    throw new Error('manifest icons missing from dist/: ' + missing.join(', '));
  }
});

// One theme colour, declared in two places that used to disagree.
check('manifest and meta theme colours agree', function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'site.webmanifest'), 'utf8'));
  const meta = indexHtml.match(/<meta[^>]*\bname=["']theme-color["'][^>]*\bcontent=["']([^"']+)["']/);
  if (!meta) {
    throw new Error('no theme-color meta tag in dist/index.html');
  }
  const values = new Set([meta[1], manifest.theme_color, manifest.background_color]);
  if (values.size !== 1) {
    throw new Error('theme colours disagree: ' + [...values].join(', '));
  }
});

// Fonts used to come from fonts.googleapis.com, which meant a render-blocking
// stylesheet on a third-party origin before the font URLs were even known.
// Only subresources are checked; outbound links in the copy are the point of
// the copy and are left alone.
check('no content page loads third-party subresources', function () {
  // Only rels that actually cause a fetch. canonical and alternate are
  // metadata: they name a URL, they do not load it, and canonical is
  // required to be absolute.
  const FETCHING_RELS = new Set([
    'stylesheet',
    'preconnect',
    'dns-prefetch',
    'preload',
    'prefetch',
    'modulepreload',
    'icon',
    'apple-touch-icon',
    'manifest',
  ]);

  const external = [];
  CONTENT_PAGES.forEach(function (page) {
    const html = pageHtml(page);
    for (const match of html.matchAll(/<link\b[^>]*>/g)) {
      const tag = match[0];
      const rel = tag.match(/\brel=["']([^"']+)["']/);
      const href = tag.match(/\bhref=["']([^"']+)["']/);
      if (!rel || !href || !FETCHING_RELS.has(rel[1].toLowerCase())) {
        continue;
      }
      if (/^https?:\/\//.test(href[1]) && !href[1].startsWith(ORIGIN + '/')) {
        external.push('dist/' + page.file + ': ' + href[1]);
      }
    }
    for (const match of html.matchAll(/<script[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/g)) {
      if (!match[1].startsWith(ORIGIN + '/')) {
        external.push('dist/' + page.file + ': ' + match[1]);
      }
    }
  });
  if (external.length > 0) {
    throw new Error('third-party subresources: ' + external.join(', '));
  }

  const css = fs.readFileSync(path.join(distDir, styleRef), 'utf8');
  const remote = [...css.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/g)].map((m) => m[1]);
  if (remote.length > 0) {
    throw new Error('third-party urls in the emitted css: ' + remote.join(', '));
  }
});

// The @font-face src values are relative, so Vite hashes the woff2 files and
// rewrites them. If that ever stops working the CSS still parses and the page
// silently falls back to Georgia and the system sans.
check('both font families are self-hosted, hashed, and present', function () {
  const css = fs.readFileSync(path.join(distDir, styleRef), 'utf8');
  const families = [...css.matchAll(/@font-face\{[^}]*font-family:\s*([^;]+);/g)].map((m) =>
    m[1].replace(/["']/g, '').trim()
  );
  ['DM Sans', 'DM Serif Display'].forEach(function (family) {
    if (!families.includes(family)) {
      throw new Error('no @font-face for ' + family + ', found: ' + families.join(', '));
    }
  });

  const refs = [...css.matchAll(/url\(\s*["']?([^)"']+\.woff2)["']?\s*\)/g)].map((m) => m[1]);
  if (refs.length !== 4) {
    throw new Error('expected 4 woff2 references, found ' + refs.length + ': ' + refs.join(', '));
  }
  refs.forEach(function (ref) {
    if (!/-[A-Za-z0-9_-]{8,}\.woff2$/.test(ref)) {
      throw new Error('font is not content-hashed: ' + ref);
    }
    const target = path.join(distDir, ref.replace(/^\//, ''));
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      throw new Error('font missing from dist/: ' + ref);
    }
    if (fs.readFileSync(target).subarray(0, 4).toString() !== 'wOF2') {
      throw new Error('not a woff2 file: ' + ref);
    }
  });
});

check('canonical, og:url and the sitemap all name the same origin', function () {
  function meta(pattern, label) {
    const match = indexHtml.match(pattern);
    if (!match || !match[1]) {
      throw new Error(label + ' is missing or empty');
    }
    return match[1];
  }

  const canonical = meta(
    /<link[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']*)["']/,
    'rel=canonical'
  );
  const ogUrl = meta(
    /<meta[^>]*\bproperty=["']og:url["'][^>]*\bcontent=["']([^"']*)["']/,
    'og:url'
  );
  if (canonical !== CANONICAL || ogUrl !== CANONICAL) {
    throw new Error(
      'expected ' + CANONICAL + ', got canonical ' + canonical + ' and og:url ' + ogUrl
    );
  }

  // Scrapers do not resolve relative URLs, so these must be absolute.
  for (const property of ['og:image', 'twitter:image']) {
    const pattern = new RegExp(
      '<meta[^>]*\\b(?:property|name)=["\']' + property + '["\'][^>]*\\bcontent=["\']([^"\']*)["\']'
    );
    const value = meta(pattern, property);
    if (!value.startsWith('https://')) {
      throw new Error(property + ' is not absolute: ' + value);
    }
  }

  const sitemap = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8');
  if (!sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9')) {
    throw new Error('sitemap.xml does not use the sitemaps.org namespace');
  }
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!locs.includes(CANONICAL)) {
    throw new Error('sitemap.xml does not list ' + CANONICAL + ', it lists ' + locs.join(', '));
  }

  const robots = fs.readFileSync(path.join(distDir, 'robots.txt'), 'utf8');
  if (!robots.includes('Sitemap: ' + CANONICAL + 'sitemap.xml')) {
    throw new Error('robots.txt does not point at the sitemap, which is how it gets discovered');
  }
});

// Reads a meta tag's content attribute out of one page. The delimiter is
// captured and matched against itself rather than excluded with [^"']*, because
// a content attribute can legitimately contain an apostrophe and since #54 these
// ones do: the pitch says "St. Louis'". The naive class stops dead at that
// apostrophe, which turned the check below into a comparison of the first 33
// characters of each tag; three tags saying three different things after that
// point would have passed. Nothing would have looked wrong, which is the failure
// mode this file exists to catch.
//
// The page is a parameter rather than a closure over indexHtml because every
// content page ships its own three description tags and every one of them can
// drift on its own.
function metaContent(html, attrPattern) {
  const match = html.match(
    new RegExp('<meta[^>]*\\b' + attrPattern + '[^>]*\\bcontent=(["\'])([\\s\\S]*?)\\1')
  );
  return match ? match[2] : null;
}

// Shared by the court-time check and the schedule week-count check, and
// declared up here rather than beside either one because check() runs its
// callback immediately. A const declared lower in the file is in the temporal
// dead zone for every check above it, and the ReferenceError that causes is
// caught by check() and reported as an ordinary content failure, so a wiring
// mistake would read as a copy bug.
const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const DESCRIPTION_TAGS = [
  'name=["\']description["\']',
  'property=["\']og:description["\']',
  'name=["\']twitter:description["\']',
];

// The same sentence is declared three times on every page. Search results, link
// previews and X cards each read a different one, so they drift apart silently,
// and each page carries its own set: /faq/ drifting says nothing about /subs/.
check('every content page states one description in all three of its tags', function () {
  const problems = [];
  CONTENT_PAGES.forEach(function (page) {
    const html = pageHtml(page);
    const found = DESCRIPTION_TAGS.map((attrPattern) => metaContent(html, attrPattern));
    if (found.some((value) => value === null)) {
      problems.push(
        'dist/' + page.file +
          ' is missing one of description, og:description or twitter:description'
      );
      return;
    }
    const values = new Set(found);
    if (values.size !== 1) {
      problems.push(
        'dist/' + page.file + ' descriptions disagree: ' +
          [...values].map((v) => JSON.stringify(v)).join(' vs ')
      );
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// #54. The league's pitch is stated in five places in three phrasings: the hero,
// the three description tags, and the JSON-LD. The check above only proves the
// three tags agree with each other, so the hero and the structured data could
// each drift off on their own, and the JSON-LD had in fact already done it.
//
// That half is the one that fails silently. CLAUDE.md's rule is that the block
// may only state what the visible page also states, and description was the one
// property in it taken from <head>, which no reader sees, so the rule was not
// checkable here at all. The hero carrying the line is what makes it checkable.
//
// Hardcoded rather than sliced out of data.description: the sentence contains
// "St. Louis'", so splitting on the first ". " yields "One of St". Stored lower
// case and without the closing full stop so the one constant matches both
// "One of ..." in the hero and the JSON-LD, and "... is one of ..." in the tags.
// Editing this line by hand when the league changes its pitch is the point, the
// same way MINIMUM_EXPECTED in check-links.js is.
const PITCH =
  "one of St. Louis' largest and most affordable indoor pickleball ladder leagues";

check('the pitch reaches the page, the description tags and the structured data', function () {
  const block = indexHtml.match(JSON_LD_BLOCK);
  if (!block) {
    throw new Error('no JSON-LD block in dist/index.html');
  }
  const data = JSON.parse(block[1]);
  const needle = PITCH.toLowerCase();

  // Tags stripped and whitespace collapsed: the sentence is long enough to wrap
  // across source lines, and it shares a <p> with the rest of the hero copy.
  // visiblePage, not the raw file, or the JSON-LD block and the comment above it
  // would both satisfy this and it could never fail. See #48.
  const visible = visiblePage(indexHtml, block[0])
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!visible.includes(needle)) {
    throw new Error('no visible text on the page states the pitch: ' + PITCH);
  }

  // The three tags are proven identical directly above, so reading one reads all
  // three.
  const description = metaContent(indexHtml, DESCRIPTION_TAGS[0]);
  if (description === null) {
    throw new Error('dist/index.html has no meta description');
  }
  if (!description.toLowerCase().includes(needle)) {
    throw new Error('the description tags do not state the pitch: ' + description);
  }

  if (!String(data.description).toLowerCase().includes(needle)) {
    throw new Error('the JSON-LD description does not state the pitch: ' + data.description);
  }
});

// The title once said "STL" while every other tag said "St. Louis". Searchers
// type the full name, so an abbreviation in the highest-value field on the page
// is a silent loss: nothing breaks, the page just competes for the wrong
// string. The heading half guards the other regression #18 named, headings
// written in brand voice carrying no topical signal at all.
//
// #54 added the format. "pickleball ladder league st louis" is the phrase people
// type, and "ladder" used to appear once on the entire site, in an h3, which is a
// slot neither half of this check can see.
//
// The city is matched case-sensitively and the format is not, and the difference
// is deliberate. "St. Louis" is a proper noun with exactly one correct spelling,
// so folding case there would quietly stop this check rejecting "st. louis",
// which is the sort of relaxation that reads as coverage. "ladder" is an
// ordinary word whose casing follows the slot it sits in: the title is title
// case, headings are sentence case, so one entry has to match both "Ladder
// League" and "ladder leagues".
const SEARCH_TERMS = [
  { term: 'St. Louis', matchCase: true },
  { term: 'ladder', matchCase: false },
];

check('the homepage names its city and its format in the title and in a heading', function () {
  const title = indexHtml.match(/<title>([\s\S]*?)<\/title>/);
  if (!title) {
    throw new Error('dist/index.html has no title');
  }

  // The h1 is a wordmark and is deliberately exempt. At least one h2 has to
  // carry each term, or the page has no keyword-bearing heading at all.
  const headings = [...indexHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());

  SEARCH_TERMS.forEach(function (entry) {
    const fold = (text) => (entry.matchCase ? text : text.toLowerCase());
    const needle = fold(entry.term);

    if (!fold(title[1]).includes(needle)) {
      throw new Error('the title does not name ' + entry.term + ': ' + title[1].trim());
    }
    if (!headings.some((text) => fold(text).includes(needle))) {
      throw new Error(
        'no h2 names ' + entry.term + '; the page headings are: ' + headings.join(' | ')
      );
    }
  });
});

// The page states a location twice: once in the League Info list and once in
// the Contact section. They used to name different municipalities, Bridgeton
// against St. Louis, which is the kind of disagreement no build step can see.
// Both are compared against the venue the JSON-LD claims, so all three move
// together or this fails.
check('every Location on the homepage names the same venue', function () {
  const body = indexHtml.slice(indexHtml.indexOf('<body'));

  // League Info renders as <li><strong>Location:</strong> value</li>.
  const listed = body.match(/<strong>Location:<\/strong>([\s\S]*?)<\/li>/);
  // Contact renders as <h3>Location</h3> followed by a <p>.
  const contact = body.match(/<h3>Location<\/h3>\s*<p>([\s\S]*?)<\/p>/);

  if (!listed || !contact) {
    throw new Error(
      'expected a Location in both the League Info list and the Contact section, found ' +
        (listed ? 'only the list' : contact ? 'only Contact' : 'neither')
    );
  }

  function text(match) {
    return match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // The venue name is the anchor, taken from the structured data rather than
  // hardcoded here, so a venue change has one place to edit and not three.
  // The block's own existence and syntax are the previous check's job; this
  // one only needs to not crash with a stack trace if it is ever missing.
  const ldBlock = indexHtml.match(JSON_LD_BLOCK);
  if (!ldBlock) {
    throw new Error('no JSON-LD block to check the Location values against');
  }
  const jsonLd = JSON.parse(ldBlock[1]);
  const venue = jsonLd.location.name;
  const locality = jsonLd.location.address.addressLocality;

  const problems = [];
  [
    { label: 'League Info', value: text(listed) },
    { label: 'Contact', value: text(contact) },
  ].forEach(function (entry) {
    if (!entry.value.includes(venue)) {
      problems.push(entry.label + ' does not name the venue ' + venue + ': ' + entry.value);
    }
    if (!entry.value.includes(locality)) {
      problems.push(entry.label + ' does not name ' + locality + ': ' + entry.value);
    }
  });

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// A wrong price is the worst bug this site can ship, and the fee is now stated
// in more than one place. If a second, genuinely different amount is ever
// added, this check is the thing that should be updated deliberately.
check('every price on the page states the same amount', function () {
  const body = indexHtml.slice(indexHtml.indexOf('<body'));
  const amounts = [...body.matchAll(/\$(\d+(?:\.\d\d)?)/g)].map((m) => m[1]);
  if (amounts.length === 0) {
    throw new Error('the page states no price at all, which is the first thing a player asks');
  }
  const distinct = new Set(amounts);
  if (distinct.size !== 1) {
    throw new Error('conflicting prices on one page: $' + [...distinct].join(', $'));
  }
});

// Reads width and height out of a PNG's IHDR chunk, which is always the first
// chunk and always at a fixed offset. Cheaper than a dependency.
function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(1, 4).toString() !== 'PNG') {
    throw new Error(file + ' is not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Declared dimensions that do not match the file are worse than none: they tell
// the platform to lay out a box the image does not fill.
check('og:image dimensions match the actual file', function () {
  const src = indexHtml.match(
    /<meta[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["']([^"']+)["']/
  )[1];
  const declared = {
    width: Number(indexHtml.match(/\bproperty=["']og:image:width["'][^>]*\bcontent=["'](\d+)["']/)[1]),
    height: Number(indexHtml.match(/\bproperty=["']og:image:height["'][^>]*\bcontent=["'](\d+)["']/)[1]),
  };
  const actual = pngSize(path.join(distDir, src.replace(ORIGIN, '').replace(/^\//, '')));

  if (actual.width !== declared.width || actual.height !== declared.height) {
    throw new Error(
      'declared ' + declared.width + 'x' + declared.height +
        ' but the file is ' + actual.width + 'x' + actual.height
    );
  }
  // Below roughly 1200x630 the major platforms fall back to a small square
  // card, which is what this image exists to avoid.
  if (actual.width < 1200 || actual.height < 600) {
    throw new Error(
      'share image is ' + actual.width + 'x' + actual.height + ', too small for a large card'
    );
  }
});

// Structured data that disagrees with the page is worse than none, and a JSON
// syntax error makes the whole block silently invisible to crawlers.
check('the structured data parses and matches the page', function () {
  const block = indexHtml.match(JSON_LD_BLOCK);
  if (!block) {
    throw new Error('no JSON-LD block in dist/index.html');
  }

  let data;
  try {
    data = JSON.parse(block[1]);
  } catch (error) {
    throw new Error('JSON-LD does not parse, so crawlers ignore it: ' + error.message, {
      cause: error,
    });
  }

  if (data['@type'] !== 'SportsClub') {
    throw new Error('unexpected @type: ' + data['@type']);
  }
  if (data.url !== CANONICAL) {
    throw new Error('JSON-LD url ' + data.url + ' disagrees with the canonical ' + CANONICAL);
  }
  // The email is the one claim here a visitor can check against the page, so
  // it has to appear in the visible markup. See visiblePage: searching the
  // whole document would find the block's own copy, or the comment above it,
  // and the check could never fail.
  const withoutJsonLd = visiblePage(indexHtml, block[0]);
  if (!withoutJsonLd.includes(data.email)) {
    throw new Error(
      'JSON-LD email ' + data.email + ' appears nowhere in the visible page'
    );
  }
  if (!withoutJsonLd.includes(data.location.name)) {
    throw new Error(
      'JSON-LD venue ' + data.location.name + ' appears nowhere in the visible page'
    );
  }
  // The municipality was checkable in neither direction until #18: the venue
  // name was required on the page but the locality was not, so Bridgeton could
  // have been swapped for any suburb and every check would still have passed.
  if (!withoutJsonLd.includes(data.location.address.addressLocality)) {
    throw new Error(
      'JSON-LD locality ' + data.location.address.addressLocality +
        ' appears nowhere in the visible page'
    );
  }
  // #48. The street address is the NAP signal local ranking leans on, and it is
  // also the only claim in this block a visitor could stand in front of and
  // check. Requiring it on the page is what stops a wrong one from being quietly
  // true in markup no reader ever sees.
  //
  // It is stated twice on purpose and both copies matter. SportsClub descends
  // from LocalBusiness, whose only required properties are name and address, and
  // the club's own address is the one a local search consumer reads; the venue
  // Place keeps its own so that node still describes a building on its own
  // terms. They are one address, so they have to agree field for field or the
  // block contradicts itself. #48 was first built with only the Place copy,
  // which passed every check here while leaving the club node with no address at
  // all, which is the whole thing the issue was filed to fix.
  if (!data.address) {
    throw new Error(
      'the SportsClub states no address of its own, only the venue Place, and the ' +
        'club address is the field local search reads'
    );
  }
  const ADDRESS_FIELDS = [
    'streetAddress',
    'addressLocality',
    'addressRegion',
    'postalCode',
    'addressCountry',
  ];
  ADDRESS_FIELDS.forEach(function (field) {
    if (!data.address[field]) {
      throw new Error('JSON-LD SportsClub address is missing ' + field);
    }
    if (data.address[field] !== data.location.address[field]) {
      throw new Error(
        'the club address and the venue address disagree on ' + field + ': ' +
          data.address[field] + ' against ' + data.location.address[field]
      );
    }
  });
  // Only the parts the Contact card spells out can be required on the page.
  // addressCountry is written nowhere a reader would see it.
  ['streetAddress', 'postalCode'].forEach(function (field) {
    if (!withoutJsonLd.includes(data.address[field])) {
      throw new Error(
        'JSON-LD ' + field + ' ' + data.address[field] +
          ' appears nowhere in the visible page'
      );
    }
  });
});

// #48. schema.org defines addressRegion and addressCountry on PostalAddress, not
// on Place or City, so setting them straight on the City meant every consumer
// dropped them and read a bare "St. Louis", which names a city in nine states.
// Nothing errored and nothing looked wrong; the qualification simply stopped
// existing. That is the failure mode of any property put on a type that does not
// define it, and the flat form is the one someone would naturally write again.
check('the city this league serves says which state it is in', function () {
  const block = indexHtml.match(JSON_LD_BLOCK);
  if (!block) {
    throw new Error('no JSON-LD block in dist/index.html');
  }
  const area = JSON.parse(block[1]).areaServed;

  if (area.addressRegion || area.addressCountry) {
    throw new Error(
      'areaServed states addressRegion or addressCountry directly on the City, ' +
        'where schema.org does not define them, so consumers drop them'
    );
  }
  if (!area.address || area.address['@type'] !== 'PostalAddress') {
    throw new Error('areaServed carries no PostalAddress to qualify it');
  }
  if (area.address.addressRegion !== 'MO' || area.address.addressCountry !== 'US') {
    throw new Error(
      'areaServed is not qualified as MO, US: ' + JSON.stringify(area.address)
    );
  }
});

// #48. sameAs is an identity claim: it tells a search engine that this site and
// that profile are the same real-world thing. The same rule the rest of the block
// follows applies to it, so each URL has to be one a visitor can follow from the
// page rather than a claim only a crawler sees. A profile worth claiming as your
// own is worth linking to, and one not worth linking is a weak signal anyway.
check('every sameAs profile is a link the page actually offers', function () {
  const block = indexHtml.match(JSON_LD_BLOCK);
  if (!block) {
    throw new Error('no JSON-LD block in dist/index.html');
  }
  let data;
  try {
    data = JSON.parse(block[1]);
  } catch (error) {
    throw new Error('JSON-LD does not parse, so crawlers ignore it: ' + error.message, {
      cause: error,
    });
  }

  // schema.org allows a bare string as well as an array, and a page with one
  // profile is the shape most likely to be written that way. Reporting "states
  // no sameAs profiles" for a page that states exactly one would send the next
  // maintainer looking for the wrong thing.
  const profiles = [].concat(data.sameAs ?? []);
  if (profiles.length === 0) {
    throw new Error('JSON-LD states no sameAs profiles');
  }

  // Compare parsed href values, not raw substrings. An href has to write & as
  // &amp;, so matching the JSON value against the markup byte for byte fails on
  // any URL carrying a query string, and the next sameAs candidate named in the
  // comment above the block is exactly that shape. Reading the attribute out
  // also makes the check indifferent to quote style.
  const linked = new Set(
    [...visiblePage(indexHtml, block[0]).matchAll(/\bhref=["']([^"']+)["']/g)].map(
      function (match) {
        return match[1].replace(/&amp;/g, '&');
      }
    )
  );

  profiles.forEach(function (url) {
    if (!linked.has(url)) {
      throw new Error('sameAs ' + url + ' is claimed but never linked from the page');
    }
  });
});

// Minimal stand-in for a DOM element, tracking only what js/app.js touches.
// children, when given, is what querySelectorAll returns.
function createElementStub(children) {
  const classes = new Set();
  const element = {
    attributes: {},
    listeners: {},
    appended: [],
    classes: classes,
    focused: 0,
    textContent: '',
    classList: {
      add: function (name) {
        classes.add(name);
      },
      remove: function (name) {
        classes.delete(name);
      },
      contains: function (name) {
        return classes.has(name);
      },
    },
    setAttribute: function (name, value) {
      element.attributes[name] = value;
    },
    removeAttribute: function (name) {
      delete element.attributes[name];
    },
    hasAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(element.attributes, name);
    },
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(element.attributes, name)
        ? element.attributes[name]
        : null;
    },
    querySelectorAll: function () {
      return children || [];
    },
    querySelector: function () {
      return (children && children[0]) || null;
    },
    appendChild: function (child) {
      element.appended.push(child);
      return child;
    },
    addEventListener: function (type, handler) {
      element.listeners[type] = handler;
    },
    contains: function () {
      return false;
    },
    focus: function () {
      element.focused += 1;
    },
  };
  return element;
}

// elementsById maps an id to a stub, or is null to model a page that has
// none of the header elements at all. isMobile drives matchMedia, which is
// how the bundle decides whether the nav is the off-canvas drawer.
function runBundle(elementsById, isMobile, options) {
  const opts = options || {};
  const bundle = fs.readFileSync(path.join(distDir, scriptRef), 'utf8');
  const sandbox = {
    document: {
      getElementById: function (id) {
        return elementsById ? elementsById[id] || null : null;
      },
      addEventListener: noop,
      querySelector: function (selector) {
        return selector === '.league-table' ? opts.table || null : null;
      },
      querySelectorAll: function () {
        return [];
      },
      // Vite prepends a modulepreload polyfill. Reporting support for it
      // makes that preamble return early instead of reaching MutationObserver.
      createElement: function (tag) {
        const el = createElementStub();
        el.tagName = String(tag).toUpperCase();
        // Vite prepends a modulepreload polyfill. Reporting support for it
        // makes that preamble return early instead of reaching MutationObserver.
        el.relList = { supports: function () { return true; } };
        return el;
      },
      body: createElementStub(),
      activeElement: null,
    },
    requestAnimationFrame: noop,
    console: console,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = noop;
  sandbox.window.scrollY = 0;
  sandbox.window.matchMedia = function () {
    return { matches: Boolean(isMobile), addEventListener: noop };
  };
  // Freezing "today" is the only way to assert what the schedule says. The
  // real Date is otherwise whatever day the build runs on.
  if (opts.today) {
    const frozen = opts.today;
    function FrozenDate() {
      return new Date(frozen);
    }
    FrozenDate.prototype = Date.prototype;
    FrozenDate.UTC = Date.UTC;
    FrozenDate.now = function () { return new Date(frozen).getTime(); };
    sandbox.Date = FrozenDate;
  } else {
    sandbox.Date = Date;
  }

  vm.runInNewContext(bundle, sandbox, { timeout: 5000 });
}

check('the bundle survives a page with no menu elements', function () {
  runBundle(null, true);
});

// Builds the header trio and runs the bundle against it.
function mountHeader(isMobile) {
  const links = [createElementStub(), createElementStub()];
  const toggle = createElementStub();
  const nav = createElementStub(links);

  runBundle(
    {
      'menu-toggle': toggle,
      'nav-links': nav,
      'site-header': createElementStub(),
    },
    isMobile
  );

  return { toggle: toggle, nav: nav, links: links };
}

check('the bundle opens the menu on the first toggle click', function () {
  const header = mountHeader(true);

  if (typeof header.toggle.listeners.click !== 'function') {
    throw new Error('no click handler was registered on #menu-toggle');
  }

  header.toggle.listeners.click();

  if (!header.nav.classList.contains('open')) {
    throw new Error('one click did not add the open class to #nav-links');
  }
  if (header.toggle.attributes['aria-expanded'] !== 'true') {
    throw new Error(
      'one click left aria-expanded as ' +
        JSON.stringify(header.toggle.attributes['aria-expanded'])
    );
  }
});

// The regression #6 was about: a transform hides the drawer but leaves every
// link focusable and in the accessibility tree.
check('the closed drawer is inert below the mobile breakpoint', function () {
  const header = mountHeader(true);
  if (!header.nav.hasAttribute('inert')) {
    throw new Error('#nav-links is not inert while closed at mobile width');
  }
});

check('opening clears inert and moves focus into the drawer', function () {
  const header = mountHeader(true);
  header.toggle.listeners.click();

  if (header.nav.hasAttribute('inert')) {
    throw new Error('#nav-links stayed inert after opening');
  }
  if (header.links[0].focused !== 1) {
    throw new Error(
      'opening did not focus the first nav link (focus calls: ' + header.links[0].focused + ')'
    );
  }
});

check('closing puts inert back', function () {
  const header = mountHeader(true);
  header.toggle.listeners.click();
  header.toggle.listeners.click();

  if (!header.nav.hasAttribute('inert')) {
    throw new Error('#nav-links did not regain inert after closing');
  }
});

// inert is not media-query aware, so the desktop nav has to be excluded by
// hand. Getting this wrong makes the whole nav unreachable on desktop.
check('the desktop nav is never inert', function () {
  const header = mountHeader(false);
  if (header.nav.hasAttribute('inert')) {
    throw new Error('#nav-links is inert above the mobile breakpoint');
  }
});

// The schedule statuses are the whole point of #10: the table presented a
// finished season, a live one and one open for registration identically.
// They are computed from each row's dates, so they are worth pinning down
// against a frozen clock rather than trusting to read correctly today.
const CHRONOLOGICAL_SEASONS = [
  ['Spring 2026', '2026-04-12', '2026-06-07', '2026-03-12'],
  ['Summer 2026', '2026-06-28', '2026-08-23', '2026-05-28'],
  ['Fall 2026', '2026-09-13', '2026-11-08', '2026-08-13'],
  ['Winter 2027', '2027-01-10', '2027-03-07', '2026-12-11'],
];

function buildScheduleTable(seasons) {
  const SEASONS = seasons || CHRONOLOGICAL_SEASONS;
  const rows = SEASONS.map(function (season) {
    const nameCell = createElementStub();
    nameCell.textContent = season[0];
    const row = createElementStub();
    row.cells = [nameCell];
    row.setAttribute('data-start', season[1]);
    row.setAttribute('data-end', season[2]);
    row.setAttribute('data-registration', season[3]);
    return row;
  });
  const headRow = createElementStub();
  const table = createElementStub(rows);
  // querySelector on the table is only ever asked for 'thead tr'.
  table.querySelector = function () {
    return headRow;
  };
  return { table: table, rows: rows, headRow: headRow };
}

// Node applies a change to process.env.TZ to Date immediately, which is what
// makes the visitor's timezone checkable here without adding a dependency.
function withTimeZone(tz, fn) {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }
}

// `when` is a bare yyyy-mm-dd, which freezes the clock at UTC noon, or a full
// instant when the time of day is the thing under test. opts.omit drops an id
// from the page, modelling markup that has lost that element.
function statusesOn(when, opts) {
  const omit = (opts && opts.omit) || [];
  const schedule = buildScheduleTable(opts && opts.seasons);
  const callout = createElementStub();
  callout.hidden = true;
  // Seeded with a trimmed copy of the label index.html ships. The real DOM
  // node also carries the newlines the markup wraps it across, which is what
  // the .trim() below absorbs; what matters is that reading back the shipped
  // label proves the bundle left it alone rather than merely never wrote.
  const join = createElementStub();
  join.textContent = 'Join the League';
  const note = createElementStub();
  note.hidden = true;
  // Its copy is static in the markup and the bundle only ever clears `hidden`,
  // so there is no text to read back. Whether it is showing is the whole
  // behavior, which is also why it survives a page that has lost the note.
  const sub = createElementStub();
  sub.hidden = true;

  const page = {
    'season-callout': callout,
    'hero-join': join,
    'hero-note': note,
    'hero-sub': sub,
  };
  omit.forEach(function (id) {
    delete page[id];
  });

  runBundle(
    page,
    false,
    { table: schedule.table, today: /T/.test(when) ? when : when + 'T12:00:00Z' }
  );

  return {
    labels: schedule.rows.map(function (row) {
      const cell = row.appended[row.appended.length - 1];
      return cell ? cell.textContent : null;
    }),
    callout: callout.hidden ? null : callout.textContent,
    join: join.textContent.trim(),
    joinDescribedBy: join.getAttribute('aria-describedby'),
    note: note.hidden ? null : note.textContent,
    noteClass: note.className,
    subShown: !sub.hidden,
  };
}

check('the status column it builds is a real table header', function () {
  const schedule = buildScheduleTable();
  runBundle({}, false, { table: schedule.table, today: '2026-07-31T12:00:00Z' });

  const th = schedule.headRow.appended[0];
  if (!th || th.tagName !== 'TH') {
    throw new Error('no th appended to thead, so the column has no header at all');
  }
  // Under the mobile breakpoint the thead is hidden and rows restack, so the
  // cell-to-header link is carried by scope and data-label, not by layout.
  if (th.attributes.scope !== 'col') {
    throw new Error('the generated header has no scope="col"');
  }
  const cell = schedule.rows[0].appended[0];
  if (!cell || cell.attributes['data-label'] !== 'Status') {
    throw new Error('generated cells lack data-label, so they lose their label on mobile');
  }
});

check('the schedule marks the season that is actually running', function () {
  const result = statusesOn('2026-07-31');
  const expected = ['Completed', 'In progress', 'Upcoming', 'Upcoming'];
  if (JSON.stringify(result.labels) !== JSON.stringify(expected)) {
    throw new Error('got ' + JSON.stringify(result.labels) + ', expected ' + JSON.stringify(expected));
  }
  if (!/Summer 2026 is in progress/.test(result.callout || '')) {
    throw new Error('callout does not name the running season: ' + JSON.stringify(result.callout));
  }
  if (!/Fall 2026 registration opens August 13, 2026/.test(result.callout)) {
    throw new Error('callout does not give the next registration date: ' + JSON.stringify(result.callout));
  }
});

check('the schedule flips to registration open on the right day', function () {
  const before = statusesOn('2026-08-12');
  if (before.labels[2] !== 'Upcoming') {
    throw new Error('Fall 2026 was ' + before.labels[2] + ' the day before registration opens');
  }
  const on = statusesOn('2026-08-13');
  if (on.labels[2] !== 'Registration open') {
    throw new Error('Fall 2026 was ' + on.labels[2] + ' on the day registration opens');
  }
  if (!/Fall 2026 registration is open now/.test(on.callout || '')) {
    throw new Error('callout did not switch to open: ' + JSON.stringify(on.callout));
  }
});

// Registration is a 24-hour window, not the month between the opening date and
// the first night. Treating it as the whole gap meant 214 days of "Registration
// open" across the seven seasons the table ships, against at most seven that
// are real, and a hero reading "Join Fall 2026" for a month after Fall 2026 had
// filled. Same defect class as #10, which was about announcing a window early
// rather than retiring one late.
check('registration is open on its day only', function () {
  const on = statusesOn('2026-08-13');
  if (on.labels[2] !== 'Registration open') {
    throw new Error('Fall 2026 was ' + on.labels[2] + ' on the day registration opens');
  }
  const dayAfter = statusesOn('2026-08-14');
  if (dayAfter.labels[2] !== 'Full') {
    throw new Error(
      'the window is 24 hours, so Fall 2026 should read Full the day after it opened, got ' +
        dayAfter.labels[2]
    );
  }
});

// A closed window must not leave the hero offering a season nobody can join.
// The next season is picked from the rows that are still open or still to open,
// so a filled one drops out of that set rather than needing its own branch.
check('the hero moves to the next season once a window has closed', function () {
  const during = statusesOn('2026-08-13');
  if (during.join !== 'Join Fall 2026') {
    throw new Error('hero should offer Fall 2026 on its open day, got ' + JSON.stringify(during.join));
  }
  const after = statusesOn('2026-08-14');
  if (after.join !== 'Join Winter 2027') {
    throw new Error(
      'hero still offers ' + JSON.stringify(after.join) + ' the day after Fall 2026 filled'
    );
  }
  if (!/Winter 2027 registration opens December 11, 2026/.test(after.note || '')) {
    throw new Error('hero note does not give the next window: ' + JSON.stringify(after.note));
  }
});

check('a season is complete the day after it ends, not before', function () {
  const lastDay = statusesOn('2026-08-23');
  if (lastDay.labels[1] !== 'In progress') {
    throw new Error('Summer 2026 read as ' + lastDay.labels[1] + ' on its final day');
  }
  const dayAfter = statusesOn('2026-08-24');
  if (dayAfter.labels[1] !== 'Completed') {
    throw new Error('Summer 2026 read as ' + dayAfter.labels[1] + ' the day after it ended');
  }
});

// Item 6 of #10: the button sat directly above a callout reading "Fall 2026
// registration opens August 13, 2026" while itself saying only "Join the
// League", so the page named a season everywhere except on the one control a
// visitor was being asked to click.
check('the hero CTA names the season a visitor would be joining', function () {
  const result = statusesOn('2026-07-31');
  if (result.join !== 'Join Fall 2026') {
    throw new Error('hero CTA reads ' + JSON.stringify(result.join) + ', which names no season');
  }
  // #51: this read only the second sentence, so on a day a season was being
  // played the hero named one three months out and said nothing about the one
  // on court. Both sentences, in the order the callout writes them.
  if (result.note !== 'Summer 2026 is in progress. Fall 2026 registration opens August 13, 2026.') {
    throw new Error('hero note does not say what is running and when the next opens: ' + JSON.stringify(result.note));
  }
  // The class carries the colour, and a wrong one is invisible to every other
  // check here: the sentence is still correct, it just stops being styled.
  if (result.noteClass !== 'hero-note') {
    throw new Error('pending note carries ' + JSON.stringify(result.noteClass) + ', which is not the muted style');
  }
  // The button names a season but not whether it is joinable yet. Without
  // this the date is only reachable by tabbing past the button.
  if (result.joinDescribedBy !== 'hero-note') {
    throw new Error('hero CTA is not described by the note, so the date is orphaned for a screen reader');
  }
});

// The boundary is the whole risk here. An off-by-one would have the button
// promise an open registration a day early, which is the same class of error
// as the hand-written copy this issue was filed about.
check('the hero CTA says registration is open on the day it opens', function () {
  const before = statusesOn('2026-08-12');
  if (before.note !== 'Summer 2026 is in progress. Fall 2026 registration opens August 13, 2026.') {
    throw new Error('hero note the day before registration opens: ' + JSON.stringify(before.note));
  }
  const on = statusesOn('2026-08-13');
  if (on.note !== 'Summer 2026 is in progress. Fall 2026 registration is open now.') {
    throw new Error('hero note on the opening day: ' + JSON.stringify(on.note));
  }
  // The modifier is what makes the open state visually distinct from the
  // pending one. Without it both states render identically muted.
  if (on.noteClass !== 'hero-note hero-note--open') {
    throw new Error('open note carries ' + JSON.stringify(on.noteClass) + ', so it is not styled as open');
  }
  if (on.join !== 'Join Fall 2026') {
    throw new Error('hero CTA stopped naming the season once registration opened: ' + JSON.stringify(on.join));
  }
});

// Every check above freezes the clock at UTC noon, which is the one time of
// day when the UTC calendar date and a Western visitor's local date agree, so
// none of them can see this. Half past midnight UTC is the previous evening
// in the league's own city, and a Sunday-night league's traffic peaks there.
check('an evening visitor west of UTC is not told registration opened a day early', function () {
  const result = withTimeZone('America/Chicago', function () {
    // Wed Aug 12 2026, 19:30 CDT. Fall registration opens tomorrow.
    return statusesOn('2026-08-13T00:30:00Z');
  });
  if (result.note !== 'Summer 2026 is in progress. Fall 2026 registration opens August 13, 2026.') {
    throw new Error('hero note on the evening before registration opens: ' + JSON.stringify(result.note));
  }
  if (result.labels[2] !== 'Upcoming') {
    throw new Error('Fall 2026 read as ' + result.labels[2] + ' the evening before registration opens');
  }
  // The other end of the same bug: the final Sunday night of a season is
  // league night, and the table must not have retired it yet.
  const lastNight = withTimeZone('America/Chicago', function () {
    // Sun Aug 23 2026, 19:30 CDT, the closing night of Summer 2026.
    return statusesOn('2026-08-24T00:30:00Z');
  });
  if (lastNight.labels[1] !== 'In progress') {
    throw new Error('Summer 2026 read as ' + lastNight.labels[1] + ' on its own closing night');
  }
});

// CLAUDE.md calls this table the most frequently edited part of the site, and
// nothing makes the rows chronological. Listing the newest season first is an
// ordinary edit; it must not leave the hero advertising a season four months
// out while the table two sections below says Fall is open now.
check('the next season is the soonest one, not whichever row comes first', function () {
  const newestFirst = [
    ['Winter 2027', '2027-01-10', '2027-03-07', '2026-12-11'],
    ['Fall 2026', '2026-09-13', '2026-11-08', '2026-08-13'],
    ['Summer 2026', '2026-06-28', '2026-08-23', '2026-05-28'],
    ['Spring 2026', '2026-04-12', '2026-06-07', '2026-03-12'],
  ];
  const result = statusesOn('2026-08-13', { seasons: newestFirst });
  if (result.join !== 'Join Fall 2026') {
    throw new Error('hero named ' + JSON.stringify(result.join) + ' with the rows listed newest first');
  }
  if (result.note !== 'Summer 2026 is in progress. Fall 2026 registration is open now.') {
    throw new Error('hero note with the rows listed newest first: ' + JSON.stringify(result.note));
  }
  if (!/Fall 2026 registration is open now/.test(result.callout || '')) {
    throw new Error('callout with the rows listed newest first: ' + JSON.stringify(result.callout));
  }
});

// ---- the schedule rows the page actually ships --------------------------
// Everything above this point drives the bundle with the synthetic fixture at
// the top of this section. Nothing read the rows index.html really carries, so
// the table that CLAUDE.md calls the most frequently edited part of the site
// was the one part of it no check could see. #58 is what that bought: the Fall
// 2026 row scheduled nine playing Sundays against the eight-week season sold in
// six places on the homepage and twice more in the FAQ, stayed valid HTML, kept
// every check green, and was the next season players would have paid for.
//
// That is the Bridgeton-against-St. Louis defect class one more time: two
// hand-maintained statements of one fact with no check between them.
function scheduleRows() {
  const body = indexHtml.slice(indexHtml.indexOf('<body'));
  // Tables are enumerated and then selected on a class token, rather than
  // matched with one pattern that reaches from <table to league-table. Any
  // such pattern has to cross the opening tag's closing >, so it does not
  // actually constrain the class to belong to the table it started at: add a
  // second table above this one and the match bridges into the wrong rows.
  const table = [...body.matchAll(/<table\b([^>]*)>([^]*?)<\/table>/g)].find(function (found) {
    const classAttr = found[1].match(/\bclass=(["'])(.*?)\1/);
    return classAttr !== null && classAttr[2].split(/\s+/).includes('league-table');
  });
  if (!table) {
    throw new Error('no league schedule table on the built homepage');
  }
  const rows = [...table[2].matchAll(/<tr\b([^>]*\bdata-start=[^>]*)>([^]*?)<\/tr>/g)];
  if (rows.length === 0) {
    throw new Error('the schedule table ships no rows carrying data-start');
  }
  return rows.map(function (row) {
    // Delimiter captured and matched to its next occurrence rather than
    // excluded with [^"']*, per the metaContent() rule near the top.
    function attr(name) {
      const found = row[1].match(new RegExp('\\b' + name + '=(["\'])(.*?)\\1'));
      if (!found) {
        throw new Error('a schedule row is missing ' + name);
      }
      return found[2];
    }
    // The label is escaped here rather than by the caller, so that "Bye
    // (reason)" can be passed as it is written in the markup. A helper that
    // silently requires pre-escaped input is a trap for whoever adds the next
    // column.
    function cell(label) {
      const found = row[2].match(
        new RegExp(
          '<td\\b[^>]*\\bdata-label=(["\'])' +
            label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            '\\1[^>]*>([^]*?)</td>'
        )
      );
      if (!found) {
        throw new Error('a schedule row has no "' + label + '" cell');
      }
      return found[2]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return {
      season: cell('Season'),
      start: attr('data-start'),
      end: attr('data-end'),
      registration: attr('data-registration'),
      datesCell: cell('Season Dates'),
      registrationCell: cell('Registration Opens'),
      byeCell: cell('Bye (reason)'),
    };
  });
}

// League Info renders as <li><strong>Label:</strong> value</li>, the same shape
// the Location and court-time checks read.
function leagueInfo(label) {
  const body = indexHtml.slice(indexHtml.indexOf('<body'));
  const found = body.match(new RegExp('<strong>' + label + ':</strong>([\\s\\S]*?)</li>'));
  return found
    ? found[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Parsed at UTC noon so a yyyy-mm-dd never lands on the wrong calendar day,
// the same reason the status checks above freeze their clock there.
function parseDay(iso) {
  const date = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(date.getTime())) {
    throw new Error('unparseable date: ' + iso);
  }
  return date;
}

// The night the league plays and the number of weeks it sells are both stated
// in League Info, so both are read from there rather than hardcoded here. Move
// the league to Saturdays, or sell a six-week season, and this check follows
// the copy instead of needing an edit of its own.
check('every season plays the number of weeks the price copy sells', function () {
  const cost = leagueInfo('Cost');
  if (!cost) {
    throw new Error('League Info has no Cost line to read a season length out of');
  }
  const sold = cost.match(/([A-Za-z]+)-week\b/);
  if (!sold) {
    throw new Error('the Cost line no longer states a season length: ' + cost);
  }
  const soldWeeks = NUMBER_WORDS[sold[1].toLowerCase()];
  if (soldWeeks === undefined) {
    throw new Error('unrecognised number word in the Cost line: ' + sold[1]);
  }

  const day = leagueInfo('Day');
  if (!day) {
    throw new Error('League Info has no Day line, so nothing says which night play falls on');
  }
  const playDay = WEEKDAYS.findIndex((name) => day.includes(name));
  if (playDay === -1) {
    throw new Error('the Day line does not name a weekday: ' + day);
  }

  const problems = [];
  scheduleRows().forEach(function (row) {
    const start = parseDay(row.start);
    const end = parseDay(row.end);
    if (end < start) {
      problems.push(row.season + ' ends before it starts');
      return;
    }
    let nights = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === playDay) {
        nights += 1;
      }
    }
    // "None" is the table's own word for a season with no bye.
    const noBye = row.byeCell.toLowerCase() === 'none';
    const byes = noBye ? 0 : (row.byeCell.match(/\b[A-Z][a-z]{2}\s+\d{1,2}\b/g) || []).length;
    if (!noBye && byes === 0) {
      problems.push(
        row.season + ' lists a bye this check cannot read a date out of: ' + row.byeCell
      );
      return;
    }
    const playing = nights - byes;
    if (playing !== soldWeeks) {
      problems.push(
        row.season +
          ' plays ' +
          playing +
          ' weeks (' +
          nights +
          ' ' +
          WEEKDAYS[playDay] +
          's minus ' +
          byes +
          (byes === 1 ? ' bye' : ' byes') +
          ') against the ' +
          sold[1].toLowerCase() +
          '-week season the price copy sells'
      );
    }
  });

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// CLAUDE.md already tells a maintainer to keep the data-* dates and the human
// readable ones in the same row in step, and says only the data-* ones are read
// by code. Nothing enforced it. A row whose attributes and cells disagree shows
// a visitor one season and behaves like another, and the check above would be
// satisfied by whichever half happened to be right. Both halves are edited by
// hand in the same edit, which is the edit that can go half-done.
check('each schedule row shows the dates its attributes claim', function () {
  const problems = [];
  scheduleRows().forEach(function (row) {
    // The cells abbreviate the month and state the year once, at the end:
    // "Sep 20 – Nov 8, 2026" and "Aug 20, 2026". Some Registration cells spell
    // the month out ("March 11, 2027"), so this matches on the prefix.
    function shows(text, iso, label) {
      const date = parseDay(iso);
      const month = MONTHS[date.getUTCMonth()];
      const dayOfMonth = date.getUTCDate();
      const year = date.getUTCFullYear();
      if (!new RegExp('\\b' + month + '[a-z]*\\s+' + dayOfMonth + '\\b').test(text)) {
        problems.push(
          row.season +
            ' ' +
            label +
            ' cell "' +
            text +
            '" does not show ' +
            month +
            ' ' +
            dayOfMonth +
            ' from ' +
            iso
        );
      }
      if (!text.includes(String(year))) {
        problems.push(
          row.season + ' ' + label + ' cell "' + text + '" does not show the year ' + year
        );
      }
    }
    shows(row.datesCell, row.start, 'Season Dates');
    shows(row.datesCell, row.end, 'Season Dates');
    shows(row.registrationCell, row.registration, 'Registration Opens');
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// The check above counts a bye by reading month-day tokens out of the bye cell.
// A bye typo'd onto a Tuesday, or onto a date outside its own season, still
// counts as one token, so the week arithmetic still balances and that check
// stays green while the table tells a player to skip the wrong night.
check('every bye falls on a league night inside its own season', function () {
  const day = leagueInfo('Day');
  const playDay = WEEKDAYS.findIndex((name) => day && day.includes(name));
  if (playDay === -1) {
    throw new Error('the Day line does not name a weekday, so no bye can be placed');
  }

  const problems = [];
  scheduleRows().forEach(function (row) {
    if (row.byeCell.toLowerCase() === 'none') {
      return;
    }
    const start = parseDay(row.start);
    const end = parseDay(row.end);
    // The bye cell carries no year, so the year comes from the season the bye
    // sits in. Both ends are tried because a winter season can straddle
    // December, and only a date landing inside the range is accepted.
    (row.byeCell.match(/\b[A-Z][a-z]{2}\s+\d{1,2}\b/g) || []).forEach(function (token) {
      const parts = token.match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
      const month = MONTHS.indexOf(parts[1]);
      if (month === -1) {
        problems.push(row.season + ' bye names no month this check knows: ' + token);
        return;
      }
      const placed = [start.getUTCFullYear(), end.getUTCFullYear()]
        .map((year) => new Date(Date.UTC(year, month, Number(parts[2]), 12)))
        .find((d) => d >= start && d <= end);
      if (!placed) {
        problems.push(
          row.season + ' bye ' + token + ' falls outside ' + row.start + ' to ' + row.end
        );
        return;
      }
      if (placed.getUTCDay() !== playDay) {
        problems.push(
          row.season +
            ' bye ' +
            token +
            ' is a ' +
            WEEKDAYS[placed.getUTCDay()] +
            ', but the league plays ' +
            WEEKDAYS[playDay] +
            's'
        );
      }
    });
  });

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// Relative luminance and contrast ratio, WCAG 2.1 definitions, on #rrggbb.
function relativeLuminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.substr(i, 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

// The minifier shortens #ffffff to #fff, so both forms have to be read here.
function cssVariable(css, name) {
  const match = css.match(new RegExp('--' + name + ':\\s*#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b'));
  if (!match) {
    throw new Error('no --' + name + ' in the emitted css');
  }
  const digits = match[1].toLowerCase();
  return '#' + (digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits);
}

// --amber-dark is the "you can act on this now" colour, used for the hero note
// and for the Registration open row in the schedule. It shipped at 3.5:1 on
// cream, under the 4.5:1 AA needs for text this size, which made the single
// most actionable sentence on the page the hardest one to read. Nothing else
// in the build can see a contrast regression: the markup stays valid and the
// text stays present, it just stops being legible.
check('the registration-open colour meets AA on the surfaces it is used on', function () {
  const css = fs.readFileSync(path.join(distDir, styleRef), 'utf8');
  const amber = cssVariable(css, 'amber-dark');
  const cream = cssVariable(css, 'cream');
  const white = cssVariable(css, 'white');

  [['cream', cream], ['white', white]].forEach(function ([label, background]) {
    const ratio = contrastRatio(amber, background);
    if (ratio < 4.5) {
      throw new Error(
        '--amber-dark ' + amber + ' on --' + label + ' ' + background + ' is ' +
          ratio.toFixed(2) + ':1, under the 4.5:1 AA needs for 14px text'
      );
    }
  });
});

// The mid-season subs offer is 0.9rem on the hero's cream, so both the
// sentence and the link inside it need 4.5:1. Same shape as the footer link
// check: each colour is resolved from whichever custom property its own rule
// names, so recolouring either one re-runs the sum instead of quietly dropping
// below AA. --court-green clears it at 4.94:1, which is not much room.
check('the hero subs line meets AA on the hero background', function () {
  const css = fs.readFileSync(path.join(distDir, styleRef), 'utf8');
  const background = cssVariable(css, 'cream');

  [['.hero-sub-cta', 'the sentence'], ['.hero-sub-cta a', 'the link']].forEach(
    function ([selector, label]) {
      const rule = css.match(
        new RegExp('[^{}]*' + selector.replace('.', '\\.') + '\\s*\\{([^}]*)\\}')
      );
      if (!rule) {
        throw new Error('no ' + selector + ' rule in the emitted css');
      }
      const colour = rule[1].match(/color:\s*var\(\s*--([a-z-]+)\s*\)/);
      if (!colour) {
        throw new Error(selector + ' does not take its colour from a custom property');
      }
      const foreground = cssVariable(css, colour[1]);
      const ratio = contrastRatio(foreground, background);
      if (ratio < 4.5) {
        throw new Error(
          label + ': --' + colour[1] + ' ' + foreground + ' on --cream ' + background +
            ' is ' + ratio.toFixed(2) + ':1, under the 4.5:1 AA needs for 0.9rem text'
        );
      }
    }
  );
});

// Resolves both sides of a contrast pair from the custom properties the rule
// itself names, so recolouring either one re-runs the sum instead of quietly
// dropping below AA. The subs check above has to hardcode its background
// because that rule sets none and inherits the hero's; a pill sets its own, so
// there is nothing here worth hardcoding.
function ruleContrast(css, selector, source) {
  const rule = css.match(
    new RegExp('[^{}]*' + selector.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}')
  );
  if (!rule) {
    throw new Error('no ' + selector + ' rule in ' + source);
  }
  // `background` also spells itself `background-color`, and either is a real
  // answer to "what is behind this text", so refusing the longhand would fail
  // a rule that had done nothing wrong. `color` takes no such alternative: it
  // is anchored on a declaration boundary precisely so it cannot match the
  // tail of `background-color:` and report the pill as if it were the text.
  const named = [['color', 'color'], ['background', 'background(?:-color)?']].map(
    function ([property, pattern]) {
      const match = rule[1].match(
        new RegExp('(?:^|;)\\s*' + pattern + ':\\s*var\\(\\s*--([a-z-]+)\\s*\\)')
      );
      if (!match) {
        throw new Error(
          selector + ' does not take its ' + property + ' from a custom property'
        );
      }
      return match[1];
    }
  );
  // cssVariable says "the emitted css", which is a lie when the caller handed
  // us a page's inline block instead. A check that misnames the file it read
  // sends a maintainer to the wrong one.
  const [foreground, background] = named.map(function (name) {
    try {
      return cssVariable(css, name);
    } catch {
      throw new Error('no --' + name + ' in ' + source);
    }
  });
  return {
    ratio: contrastRatio(foreground, background),
    foreground,
    background,
    foregroundName: named[0],
    backgroundName: named[1]
  };
}

// Shared by the two eyebrow checks below, which read the same pill out of two
// different files and have no other reason to agree on wording.
function eyebrowContrast(css, selector, source) {
  const pair = ruleContrast(css, selector, source);
  if (pair.ratio < 4.5) {
    throw new Error(
      '--' + pair.foregroundName + ' ' + pair.foreground + ' on --' +
        pair.backgroundName + ' ' + pair.background + ' is ' +
        pair.ratio.toFixed(2) + ':1, under the 4.5:1 AA needs for 0.85rem text'
    );
  }
}

// The eyebrow is the first text in the hero and it shipped as --amber on
// --amber-light, which is 2.44:1: under even the 3:1 large text gets, and this
// is 0.85rem at weight 600, so it is small text needing 4.5:1. That is the
// same defect the --amber-dark comment in css/style.css records, in the one
// place that darkening never reached.
check('the hero eyebrow meets AA on its own pill', function () {
  const css = fs.readFileSync(path.join(distDir, styleRef), 'utf8');
  eyebrowContrast(css, '.hero-eyebrow', 'the emitted css');
});

// The same pill on the 404 page, which carries its own copy of the palette so
// it still renders when the hashed stylesheet is the thing that failed. That
// is also why the check above cannot see it: there is no stylesheet to read.
// This one reads the page's own inline block, tokens included, so the pair is
// judged on the values that page actually ships rather than on whatever
// css/style.css happens to hold.
check('the 404 eyebrow meets AA on its own pill', function () {
  const html = fs.readFileSync(path.join(distDir, '404.html'), 'utf8');
  const style = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (!style) {
    throw new Error('dist/404.html has no inline styles to check');
  }
  eyebrowContrast(style[1], '.eyebrow', 'the 404 page inline styles');
});

// Nothing upstream guarantees the table always carries a future row. The last
// row here closes in March 2027, so a clock past that leaves no season to
// join, and the enhancement has to leave the page exactly as it shipped
// rather than write "Join undefined" or reveal an empty note.
check('the hero CTA falls back to the shipped markup with no season left to join', function () {
  const result = statusesOn('2027-06-01');
  if (result.join !== 'Join the League') {
    throw new Error('hero CTA was rewritten with no upcoming season: ' + JSON.stringify(result.join));
  }
  if (result.note !== null) {
    throw new Error('hero note was revealed with nothing to say: ' + JSON.stringify(result.note));
  }
  if (result.joinDescribedBy !== null) {
    throw new Error('hero CTA points aria-describedby at a note that is still hidden');
  }
});

// The other state a maintainer reaches by letting the table run out, and the
// one that used to share the check above: Winter 2027 being played, nothing
// after it. It is not a fallback, which is why it is no longer filed as one.
// #51: the hero said nothing here at all, so the one page state where the
// league is visibly active read as the same silence as a league that had
// stopped. It gets the running sentence but not the rename: with no next
// season there is nothing to name on the button, and "Join the League" is
// already true.
check('a running season with nothing after it is announced without renaming the CTA', function () {
  const result = statusesOn('2027-02-01');
  if (result.join !== 'Join the League') {
    throw new Error('hero named a season with only a running one left: ' + JSON.stringify(result.join));
  }
  if (result.note !== 'Winter 2027 is in progress.') {
    throw new Error('hero note with only a running season left: ' + JSON.stringify(result.note));
  }
  // Muted, not amber: amber means "you can act on this now", and with no next
  // row there is nothing to act on.
  if (result.noteClass !== 'hero-note') {
    throw new Error('a running season with nothing to join is styled as actionable: ' + JSON.stringify(result.noteClass));
  }
  if (result.joinDescribedBy !== null) {
    throw new Error('CTA describes itself by the note without having been renamed');
  }
});

// The inverse of this whole issue, and nothing covered it before: every other
// frozen clock in this suite lands inside a season, so a hero that announced a
// running season unconditionally would have gone green everywhere.
check('the hero claims no season is running during the gap between seasons', function () {
  // Dec 11 2026. Fall closed Nov 8, Winter starts Jan 10, and Winter
  // registration is open for exactly this one day. It used to be Sep 1, which
  // was only "between seasons with registration open" because a window was
  // treated as lasting until the season started; the state is real, the date
  // that reaches it is not.
  const open = statusesOn('2026-12-11');
  if (open.note !== 'Registration is open now.') {
    throw new Error('hero note between seasons with registration open: ' + JSON.stringify(open.note));
  }
  // The note stays as it shipped rather than gaining "Fall 2026 registration":
  // the button beside it already names the season, and the second name only
  // earns its place once a running season has put another one in the sentence.
  if (open.join !== 'Join Winter 2027') {
    throw new Error('hero CTA between seasons: ' + JSON.stringify(open.join));
  }
  // Nov 15 2026. Fall closed Nov 8 and Winter registration does not open until
  // Dec 11: the one window in this table with nothing running and nothing open.
  const pending = statusesOn('2026-11-15');
  if (pending.note !== 'Registration opens December 11, 2026.') {
    throw new Error('hero note in the gap before registration opens: ' + JSON.stringify(pending.note));
  }
});

// The dead end #51 was filed about: a season is being played, the next one
// cannot be registered for yet, and for 46 to 57 days at a stretch the hero
// offered nothing a visitor could act on. Subs are the one thing they can do
// and /subs/ already existed, so the hero just never connected the two.
//
// The rule is "cannot register today", not "a season is running". With
// registration open the join button is the stronger action and a second offer
// beside it only competes with it.
check('the subs link appears exactly when a season is running and cannot be joined yet', function () {
  const expectations = [
    // Summer 2026 being played, Fall 2026 registration a fortnight out.
    ['2026-07-31', true],
    // Same season still being played, but Fall registration opened today.
    ['2026-08-13', false],
    // Between seasons, Fall registration open. Nothing to sub in.
    ['2026-09-01', false],
    // Between seasons and before Winter registration opens. Still nothing to
    // sub in, which is why "cannot register today" is not the whole rule.
    ['2026-11-15', false],
    // Winter 2027 being played with no row after it: the state that used to
    // leave the hero completely silent.
    ['2027-02-01', true],
    // Every season finished.
    ['2027-06-01', false],
  ];
  expectations.forEach(function ([day, expected]) {
    const result = statusesOn(day);
    if (result.subShown !== expected) {
      throw new Error(
        'on ' + day + ' the subs link was ' + (result.subShown ? 'shown' : 'hidden') +
          ', expected ' + (expected ? 'shown' : 'hidden')
      );
    }
  });
});

// Renaming the button is what creates the obligation to say whether the season
// can be joined; the note is what discharges it. If the note is missing, the
// page would otherwise name a season and stay silent about a registration
// window that may not be open, which is worse than the label it replaced.
check('the hero CTA is not renamed when there is no note to qualify it', function () {
  const result = statusesOn('2026-07-31', { omit: ['hero-note'] });
  if (result.join !== 'Join the League') {
    throw new Error('CTA named a season with no note on the page: ' + JSON.stringify(result.join));
  }
  if (result.joinDescribedBy !== null) {
    throw new Error('CTA points aria-describedby at an element that is not on the page');
  }
  // The schedule itself must be unaffected by the hero markup being absent.
  if (result.labels[1] !== 'In progress') {
    throw new Error('losing the hero note broke the schedule: ' + JSON.stringify(result.labels));
  }
  // The subs offer makes no season claim, so unlike the rename it carries no
  // obligation for the note to discharge and must survive the note going
  // missing. Nesting it in the same branch would silently drop the one thing a
  // mid-season visitor can act on from a page that had lost a paragraph.
  if (!result.subShown) {
    throw new Error('the subs link was suppressed by the note being missing');
  }
});

// The three checks above mount their own stubs, so every one of them still
// passes against a page that has lost these ids and silently stopped
// enhancing anything. This is the half that reads the real built markup.
check('the built hero ships the ids the bundle enhances', function () {
  if (!/<a\b[^>]*\bid=["']hero-join["']/.test(indexHtml)) {
    throw new Error('dist/index.html has no a#hero-join, so the CTA is never renamed');
  }
  // Matched in two steps rather than one pattern, so that the attributes may
  // appear in any order. A check that goes red on correct markup teaches
  // people to edit the check.
  const noteTag = indexHtml.match(/<p\b[^>]*\bid=["']hero-note["'][^>]*>/);
  if (!noteTag) {
    throw new Error('dist/index.html has no p#hero-note, so the note is never written');
  }
  if (!/\bhidden\b/.test(noteTag[0])) {
    throw new Error('p#hero-note ships without hidden, so a no-JS visitor gets an empty visible paragraph');
  }
  // The no-JS fallback. A season name baked into the markup goes stale the
  // day that season ends, which is what this whole issue was about.
  if (!/>\s*Join the League\s*</.test(indexHtml)) {
    throw new Error('the shipped CTA label is not the season-neutral fallback');
  }
  // The subs offer, read out of the real built page for the same reason as the
  // note above it: every stub-mounted check would pass against markup that had
  // stopped shipping it. It has to arrive hidden, or the offer also stands in
  // the gaps between seasons, when there is nothing to sub in, and on a page
  // without JS, which cannot know either way.
  // Matched to the closing tag, not by a character window, so rewrapping the
  // copy cannot move the link out of range. Both assertions below read this
  // one match rather than running the pattern twice.
  const subPara = indexHtml.match(/<p\b[^>]*\bid=["']hero-sub["'][^>]*>[^]*?<\/p>/);
  if (!subPara) {
    throw new Error('dist/index.html has no p#hero-sub, so the mid-season offer never appears');
  }
  if (!/\bhidden\b/.test(subPara[0].match(/^<p\b[^>]*>/)[0])) {
    throw new Error('p#hero-sub ships without hidden, so it shows out of season and without JS');
  }
  // The offer is only worth making if it goes somewhere.
  if (!/href=["']\/subs\/["']/.test(subPara[0])) {
    throw new Error('p#hero-sub does not link to /subs/');
  }
});

// ---- content pages ------------------------------------------------------
// CONTENT_PAGES itself is declared at the top of this file, above the first
// check that reads it. See the note there.

check('every content page has its own canonical, one h1, and a sitemap entry', function () {
  const sitemap = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8');
  const problems = [];

  CONTENT_PAGES.forEach(function (page) {
    const html = pageHtml(page);

    const canonical = html.match(/<link[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']*)["']/);
    if (!canonical || canonical[1] !== page.url) {
      problems.push(page.file + ' canonical is ' + (canonical && canonical[1]) + ', expected ' + page.url);
    }
    const h1s = [...html.matchAll(/<h1[\s>]/g)].length;
    if (h1s !== 1) {
      problems.push(page.file + ' has ' + h1s + ' h1 elements');
    }
    if (!sitemap.includes('<loc>' + page.url + '</loc>')) {
      problems.push(page.file + ' is missing from sitemap.xml');
    }
    // Every page shares the header partial, so a page that skipped it would
    // have no navigation at all.
    if (!html.includes('id="site-header"')) {
      problems.push(page.file + ' does not include the shared header');
    }
  });

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

const faqHtml = fs.readFileSync(path.join(distDir, 'faq', 'index.html'), 'utf8');
const subsHtml = fs.readFileSync(path.join(distDir, 'subs', 'index.html'), 'utf8');

// FAQ rich results need every answer to exist on the page. Structured data
// that promises text the visitor cannot find is worse than none.
check('the FAQ structured data matches the visible page', function () {
  const block = faqHtml.match(JSON_LD_BLOCK);
  if (!block) {
    throw new Error('no JSON-LD on the FAQ page');
  }
  let data;
  try {
    data = JSON.parse(block[1]);
  } catch (error) {
    throw new Error('FAQ JSON-LD does not parse: ' + error.message, { cause: error });
  }
  if (data['@type'] !== 'FAQPage') {
    throw new Error('expected FAQPage, got ' + data['@type']);
  }
  if (!Array.isArray(data.mainEntity) || data.mainEntity.length < 4) {
    throw new Error('too few questions to be worth marking up');
  }

  // Strip tags, and the JSON-LD and comments before them, so neither the block
  // nor an explanatory comment can satisfy this the way the homepage check was
  // shown to be satisfiable in #48.
  const visible = visiblePage(faqHtml, block[0])
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

  data.mainEntity.forEach(function (entry) {
    const question = entry.name;
    if (!visible.includes(question)) {
      throw new Error('question is not on the page: ' + question);
    }
    // Match on the answer's opening clause; the page wraps and hyphenates.
    const opening = entry.acceptedAnswer.text.split('.')[0];
    if (!visible.includes(opening)) {
      throw new Error('answer text is not on the page: ' + opening);
    }
  });
});

// How much court time a member gets and when the league runs are two
// hand-maintained statements of one fact, sitting two lines apart in the same
// list, and the FAQ states both again on another page. Widen the league to
// 6:00–9:00 PM and every court-time claim on the site is silently wrong: the
// markup stays valid, the sentence stays present, it just stops being true.
// That is the Bridgeton-against-St. Louis failure the Location check exists to
// catch, one list further up the same page.
//
// The hours are derived from the Time line rather than hardcoded, so moving the
// league is one edit here and none in this file. NUMBER_WORDS is declared with
// the shared helpers near the top, because the schedule week-count check reads
// it too and runs before this point.
check('the court time a member gets matches the hours the league runs', function () {
  const body = indexHtml.slice(indexHtml.indexOf('<body'));

  // League Info renders as <li><strong>Label:</strong> value</li>, the same
  // shape the Location check reads.
  function listed(label) {
    const found = body.match(new RegExp('<strong>' + label + ':</strong>([\\s\\S]*?)</li>'));
    return found ? found[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null;
  }

  const time = listed('Time');
  const courtTime = listed('Court time');
  if (!time || !courtTime) {
    throw new Error(
      'League Info needs both a Time and a Court time line, found ' +
        (time ? 'only Time' : courtTime ? 'only Court time' : 'neither')
    );
  }

  // "6:00–8:00 PM" states the meridiem once, at the end, so a start without one
  // takes the end's. En dash, because the copy style guide requires it here.
  const window = time.match(/(\d{1,2}):(\d\d)\s*(AM|PM)?\s*[–-]\s*(\d{1,2}):(\d\d)\s*(AM|PM)/i);
  if (!window) {
    throw new Error('cannot read a time window out of the Time line: ' + time);
  }

  function minutesInto(hour, minute, meridiem) {
    const h = Number(hour) % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    return h * 60 + Number(minute);
  }

  const meridiem = window[6];
  const span =
    minutesInto(window[4], window[5], meridiem) -
    minutesInto(window[1], window[2], window[3] || meridiem);
  if (span <= 0) {
    throw new Error('the Time line does not describe a forward window: ' + time);
  }
  if (span % 60 !== 0) {
    throw new Error(
      'the league no longer runs a whole number of hours (' +
        time +
        '), so the copy cannot keep saying "N hours" and this check needs rewriting'
    );
  }
  const hours = span / 60;

  const claimed = courtTime.match(/^([A-Za-z]+)\s+hours?\b/);
  if (!claimed) {
    throw new Error('the Court time line does not open with a number of hours: ' + courtTime);
  }
  const claimedHours = NUMBER_WORDS[claimed[1].toLowerCase()];
  if (claimedHours === undefined) {
    throw new Error('unrecognised number word in the Court time line: ' + claimed[1]);
  }
  if (claimedHours !== hours) {
    throw new Error(
      'League Info promises ' +
        claimed[1].toLowerCase() +
        ' hours of court time but the league runs ' +
        time +
        ', which is ' +
        hours
    );
  }

  // The FAQ states the same amount again, so it can drift from the homepage as
  // easily as the homepage can drift from itself. Read from visiblePage() and
  // not the raw file: the same sentence is in the FAQ's JSON-LD, and that copy
  // must not be what satisfies this.
  const faqBlock = faqHtml.match(JSON_LD_BLOCK);
  if (!faqBlock) {
    throw new Error('no JSON-LD block on the FAQ page to exclude from the visible text');
  }
  const faqVisible = visiblePage(faqHtml, faqBlock[0])
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  const faqClaim = faqVisible.match(/([A-Za-z]+)\s+hours? of court time/i);
  if (!faqClaim) {
    throw new Error('the FAQ never says how much court time a member gets');
  }
  if (NUMBER_WORDS[faqClaim[1].toLowerCase()] !== hours) {
    throw new Error(
      'the FAQ promises ' +
        faqClaim[1].toLowerCase() +
        ' hours of court time, the homepage runs ' +
        hours
    );
  }
});

// The whole point of moving the FAQ on-site was to stop sending people to
// Notion and to a dead GroupMe. Both should be gone from every built page.
check('nothing still points at Notion or GroupMe', function () {
  const stale = [];
  walk(distDir)
    .filter((rel) => rel.endsWith('.html'))
    .forEach(function (rel) {
      const html = fs.readFileSync(path.join(distDir, rel), 'utf8').toLowerCase();
      if (html.includes('notion.site') || html.includes('notion.so')) {
        stale.push(rel + ' links to Notion');
      }
      if (html.includes('groupme')) {
        stale.push(rel + ' mentions GroupMe');
      }
    });
  if (stale.length > 0) {
    throw new Error(stale.join('; '));
  }
});

// ---- code of conduct ----------------------------------------------------
// The conduct page is only useful if a player can find it without already
// knowing it exists. It is linked from the shared footer rather than the nav,
// which means one edit to partials/footer.html takes the link off every page
// at once and no other check would notice.
check('every content page links to the code of conduct', function () {
  const missing = CONTENT_PAGES
    .filter(function (page) {
      return !fs
        .readFileSync(path.join(distDir, page.file), 'utf8')
        .includes('href="/code-of-conduct/"');
    })
    .map((page) => page.file);
  if (missing.length > 0) {
    throw new Error('no code of conduct link on ' + missing.join(', '));
  }
});

// The FAQ and the subs page each state a rule this page completes. The footer
// link alone would satisfy the check above on every page, so the footer is
// stripped out first: what is asserted here is a link from the prose, where
// someone reading the related rule actually meets it.
check('the pages that state related rules link to the full policy in their prose', function () {
  const problems = [];
  [['faq/index.html', faqHtml], ['subs/index.html', subsHtml]].forEach(function ([file, html]) {
    const body = html.replace(/<footer[\s\S]*?<\/footer>/, '');
    if (!body.includes('href="/code-of-conduct/"')) {
      problems.push(file + ' does not link to the code of conduct outside the shared footer');
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// A conduct policy whose reporting address has drifted from the one the
// homepage publishes sends reports nowhere, and nothing about the page would
// look broken. Same class of defect as the venue and email agreement checks:
// two pages stating the same fact separately.
check('the code of conduct reports to the address the homepage publishes', function () {
  const conductHtml = fs.readFileSync(path.join(distDir, 'code-of-conduct', 'index.html'), 'utf8');
  const homepageEmail = indexHtml.match(/mailto:([^"']+)/);
  if (!homepageEmail) {
    throw new Error('no mailto: on the homepage to compare against');
  }
  if (!conductHtml.includes('mailto:' + homepageEmail[1])) {
    throw new Error('the code of conduct does not report to ' + homepageEmail[1]);
  }
  // Settled when the page was written: more than one organizer reads that
  // inbox, so the page must not promise a confidentiality it cannot keep.
  if (/\bconfidential/i.test(conductHtml.replace(/<[^>]+>/g, ' '))) {
    throw new Error('the code of conduct promises confidentiality on a shared inbox');
  }
});

// The footer carried no links at all until this page shipped, so its link
// colour is new and unproven. Footer text is 0.85rem, under the 18.66px large
// text threshold, so it needs the full 4.5:1. Same failure mode as
// --amber-dark: the markup stays valid and the text stays present, it just
// stops being legible.
check('the footer link meets AA on the footer background', function () {
  const css = fs.readFileSync(path.join(distDir, styleRef), 'utf8');
  const rule = css.match(/[^{}]*\.footer-links a[^{}]*\{([^}]*)\}/);
  if (!rule) {
    throw new Error('no .footer-links a rule in the emitted css');
  }
  const colour = rule[1].match(/color:\s*var\(\s*--([a-z-]+)\s*\)/);
  if (!colour) {
    throw new Error('.footer-links a does not take its colour from a custom property');
  }
  const foreground = cssVariable(css, colour[1]);
  const background = cssVariable(css, 'ink');
  const ratio = contrastRatio(foreground, background);
  if (ratio < 4.5) {
    throw new Error(
      '--' + colour[1] + ' ' + foreground + ' on --ink ' + background + ' is ' +
        ratio.toFixed(2) + ':1, under the 4.5:1 AA needs for 0.85rem text'
    );
  }
});

if (failures.length > 0) {
  console.error('\n' + failures.length + ' smoke check(s) failed:');
  failures.forEach(function (failure) {
    console.error('  ' + failure);
  });
  process.exit(1);
}

console.log('\nAll smoke checks passed.');
