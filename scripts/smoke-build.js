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

check('dist/404.html was emitted', function () {
  const target = path.join(distDir, '404.html');
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    throw new Error('dist/404.html is missing or empty');
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
// that do not exist. Root-relative and relative both land in the same place
// here, since dist/ is the document root.
function missingFromDist(urls) {
  return urls.filter(function (url) {
    return !fs.existsSync(path.join(distDir, url.replace(/^\//, '')));
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
  const external = [
    ...[...indexHtml.matchAll(/<(?:link|script)[^>]*\b(?:href|src)=["'](https?:\/\/[^"']+)["']/g)],
    ...[...indexHtml.matchAll(/<link[^>]*\brel=["']preconnect["'][^>]*\bhref=["']([^"']+)["']/g)],
  ].map((m) => m[1]);
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
