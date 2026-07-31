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

// Pulls the single asset URL matching a pattern out of the built HTML, and
// fails loudly on zero or many. Returns the dist-relative path.
function soleAssetRef(label, pattern) {
  const matches = [...indexHtml.matchAll(pattern)].map((m) => m[1]);
  if (matches.length !== 1) {
    throw new Error(
      'expected exactly 1 ' + label + ' in dist/index.html, found ' +
        matches.length + ': ' + JSON.stringify(matches)
    );
  }
  return matches[0].replace(/^\//, '');
}

let scriptRef = null;
let styleRef = null;

check('dist/index.html references exactly one hashed module script', function () {
  scriptRef = soleAssetRef(
    'module script',
    /<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/g
  );
  if (!HASHED.test(scriptRef)) {
    throw new Error('script is not content-hashed: ' + scriptRef);
  }
  if (!fs.existsSync(path.join(distDir, scriptRef))) {
    throw new Error('referenced script is missing from dist/: ' + scriptRef);
  }
});

check('dist/index.html references exactly one hashed stylesheet', function () {
  styleRef = soleAssetRef(
    'stylesheet link',
    /<link[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/g
  );
  if (!HASHED.test(styleRef)) {
    throw new Error('stylesheet is not content-hashed: ' + styleRef);
  }
  const target = path.join(distDir, styleRef);
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    throw new Error('referenced stylesheet is missing or empty: ' + styleRef);
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

// One origin, declared in several places that all have to agree. og:url was
// shipped empty, which is the failure mode: nothing breaks, link previews just
// quietly have no canonical target.
const CANONICAL = 'https://www.gatewaysmash.com/';
const ORIGIN = CANONICAL.replace(/\/$/, '');

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
check('the built page loads no third-party subresources', function () {
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
  for (const match of indexHtml.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0];
    const rel = tag.match(/\brel=["']([^"']+)["']/);
    const href = tag.match(/\bhref=["']([^"']+)["']/);
    if (!rel || !href || !FETCHING_RELS.has(rel[1].toLowerCase())) {
      continue;
    }
    if (/^https?:\/\//.test(href[1]) && !href[1].startsWith(ORIGIN + '/')) {
      external.push(href[1]);
    }
  }
  for (const match of indexHtml.matchAll(/<script[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/g)) {
    if (!match[1].startsWith(ORIGIN + '/')) {
      external.push(match[1]);
    }
  }
  if (external.length > 0) {
    throw new Error('third-party subresources in dist/index.html: ' + external.join(', '));
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

// The same sentence is declared three times. Search results, link previews and
// X cards each read a different one, so they drift apart silently.
check('the three description tags agree', function () {
  const found = [
    indexHtml.match(/<meta[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["']/),
    indexHtml.match(/<meta[^>]*\bproperty=["']og:description["'][^>]*\bcontent=["']([^"']*)["']/),
    indexHtml.match(/<meta[^>]*\bname=["']twitter:description["'][^>]*\bcontent=["']([^"']*)["']/),
  ];
  if (found.some((m) => !m)) {
    throw new Error('one of description, og:description or twitter:description is missing');
  }
  const values = new Set(found.map((m) => m[1]));
  if (values.size !== 1) {
    throw new Error('descriptions disagree: ' + [...values].map((v) => JSON.stringify(v)).join(' vs '));
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
  const block = indexHtml.match(
    /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/
  );
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
  // it has to appear in the visible markup. Search the page with the JSON-LD
  // removed: searching the whole document would find the block's own copy and
  // the check could never fail.
  const withoutJsonLd = indexHtml.replace(block[0], '');
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
});

// Minimal stand-in for a DOM element, tracking only what js/app.js touches.
// children, when given, is what querySelectorAll returns.
function createElementStub(children) {
  const classes = new Set();
  const element = {
    attributes: {},
    listeners: {},
    focused: 0,
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
    querySelectorAll: function () {
      return children || [];
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
function runBundle(elementsById, isMobile) {
  const bundle = fs.readFileSync(path.join(distDir, scriptRef), 'utf8');
  const sandbox = {
    document: {
      getElementById: function (id) {
        return elementsById ? elementsById[id] || null : null;
      },
      addEventListener: noop,
      querySelectorAll: function () {
        return [];
      },
      // Vite prepends a modulepreload polyfill. Reporting support for it
      // makes that preamble return early instead of reaching MutationObserver.
      createElement: function () {
        return { relList: { supports: function () { return true; } } };
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

if (failures.length > 0) {
  console.error('\n' + failures.length + ' smoke check(s) failed:');
  failures.forEach(function (failure) {
    console.error('  ' + failure);
  });
  process.exit(1);
}

console.log('\nAll smoke checks passed.');
