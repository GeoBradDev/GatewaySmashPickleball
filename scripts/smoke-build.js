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

// Minimal stand-in for a DOM element, tracking only what js/app.js touches.
function createElementStub() {
  const classes = new Set();
  const element = {
    attributes: {},
    listeners: {},
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
    addEventListener: function (type, handler) {
      element.listeners[type] = handler;
    },
    contains: function () {
      return false;
    },
    focus: noop,
  };
  return element;
}

// elementsById maps an id to a stub, or is null to model a page that has
// none of the header elements at all.
function runBundle(elementsById) {
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
    },
    requestAnimationFrame: noop,
    console: console,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = noop;
  sandbox.window.scrollY = 0;

  vm.runInNewContext(bundle, sandbox, { timeout: 5000 });
}

check('the bundle survives a page with no menu elements', function () {
  runBundle(null);
});

check('the bundle opens the menu on the first toggle click', function () {
  const toggle = createElementStub();
  const nav = createElementStub();

  runBundle({
    'menu-toggle': toggle,
    'nav-links': nav,
    'site-header': createElementStub(),
  });

  if (typeof toggle.listeners.click !== 'function') {
    throw new Error('no click handler was registered on #menu-toggle');
  }

  toggle.listeners.click();

  if (!nav.classList.contains('open')) {
    throw new Error('one click did not add the open class to #nav-links');
  }
  if (toggle.attributes['aria-expanded'] !== 'true') {
    throw new Error(
      'one click left aria-expanded as ' + JSON.stringify(toggle.attributes['aria-expanded'])
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
