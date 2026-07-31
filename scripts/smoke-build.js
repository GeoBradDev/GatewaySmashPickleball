'use strict';

// Build-output smoke checks. Runs against dist/ after `npm run build`.
// Deliberately dependency-free; wiring up a real test runner is issue #13.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const distDir = path.resolve(__dirname, '..', 'dist');
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
  const bundle = fs.readFileSync(path.join(distDir, 'js', 'app.js'), 'utf8');
  const sandbox = {
    document: {
      getElementById: function (id) {
        return elementsById ? elementsById[id] || null : null;
      },
      addEventListener: noop,
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

check('dist/index.html references app.js exactly once', function () {
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const matches = html.match(/<script[^>]*\bsrc=["'][^"']*app\.js["'][^>]*>/g) || [];
  if (matches.length !== 1) {
    throw new Error(
      'expected 1 app.js script tag, found ' + matches.length + ': ' + JSON.stringify(matches)
    );
  }
});

check('dist/js/app.js survives a page with no menu elements', function () {
  runBundle(null);
});

check('dist/js/app.js opens the menu on the first toggle click', function () {
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

// Every path copy-webpack-plugin is configured to emit, per
// webpack.config.prod.js. Listed literally rather than imported so the check
// fails loudly if the two drift, instead of silently agreeing with a config
// that dropped an entry.
const copiedAssets = [
  'img',
  'css',
  'js/vendor',
  'icon.svg',
  'favicon.ico',
  'robots.txt',
  'icon.png',
  '404.html',
  'site.webmanifest',
];

// Counts files beneath a path, treating a plain file as one. Existence alone
// is too weak a test: a directory that was created but never populated is
// exactly how a glob-engine change drops assets without failing the build.
function countFiles(target) {
  if (!fs.statSync(target).isDirectory()) {
    return 1;
  }
  return fs.readdirSync(target).reduce(function (total, entry) {
    return total + countFiles(path.join(target, entry));
  }, 0);
}

check('dist/ contains every copied asset', function () {
  const problems = copiedAssets.filter(function (asset) {
    const target = path.join(distDir, asset);
    return !fs.existsSync(target) || countFiles(target) === 0;
  });
  if (problems.length > 0) {
    throw new Error('missing or empty in dist/: ' + problems.join(', '));
  }
});

check('dist/css/style.css is non-empty', function () {
  const stylesheet = path.join(distDir, 'css', 'style.css');
  if (!fs.existsSync(stylesheet)) {
    throw new Error('dist/css/style.css was not emitted');
  }
  if (fs.statSync(stylesheet).size === 0) {
    throw new Error('dist/css/style.css is empty');
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
