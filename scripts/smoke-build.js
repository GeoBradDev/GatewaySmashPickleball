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

// Every built page, 404.html included, the way the price check walks them. The
// error page ships three icon links of its own and had never been read by
// anything: review of #69 pointed one at a missing file and declared its PNG as
// image/svg+xml, and the whole suite stayed green. Its block is deliberately
// smaller than a content page's, carrying no manifest link and no og:image, so
// only the two checks about a page's own claims being true reach it. The floor
// and the agreement check below stay on CONTENT_PAGES.
function builtPages() {
  return walk(distDir).filter((rel) => rel.endsWith('.html'));
}

// Parses every <link> on a page into its attributes, with HTML comments
// stripped first and the attribute order thrown away. Three checks read this
// and each half of it closed a live hole found in review of #69.
//
// Comments are stripped because nothing in this build strips them and they
// reach dist/ intact, which is the rule CLAUDE.md states in four places and the
// #67 parity check obeys one commit before this branch. Wrapping the FAQ's
// whole icon block in <!-- --> left npm test at exit 0 with that page shipping
// no icons at all, and the agreement check reading the commented tags as
// present is the worse half: a comment satisfying an assertion reads as
// coverage.
//
// Attributes are parsed rather than matched in sequence because a single regex
// running rel before href only matches tags written that way. Writing
// href="/img/does-not-exist.png" rel="apple-touch-icon" on all four pages left
// every check green against a file absent from dist/, and the sort in
// iconLinkFingerprints then certified that reorder as no difference at all. The
// order-independent form is what the third-party subresource check already
// uses; this makes it the only form in the file.
function linkAttributes(html) {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<link\b[^>]*>/g)].map(function (match) {
    const attrs = new Map();
    for (const attr of match[0]
      .slice('<link'.length)
      .matchAll(/([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*["']([^"']*)["'])?/g)) {
      attrs.set(attr[1].toLowerCase(), attr[2] === undefined ? '' : attr[2]);
    }
    return attrs;
  });
}

// og:image, read the same order-independent way, so a content= written ahead of
// its property= is not silently skipped.
function ogImages(html) {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<meta\b[^>]*>/g)]
    .filter((match) => /\bproperty=["']og:image["']/.test(match[0]))
    .map((match) => match[0].match(/\bcontent=["']([^"']*)["']/))
    .filter(Boolean)
    .map((match) => match[1]);
}

const ICON_RELS = ['icon', 'apple-touch-icon', 'manifest'];

function iconLinks(html) {
  return linkAttributes(html).filter((attrs) => ICON_RELS.includes(attrs.get('rel')));
}

// The orphaned manifest carried icon paths that were root-relative to files
// that lived one directory down, so every one of them would have 404'd. That
// is silent: nothing fails a build, the install prompt just shows no icon.
//
// Every content page ships its own copy of this block, in its own <head>,
// which is not what partials/header.html holds. Reading the homepage alone
// left the other three unwatched, and #69 proved it live: faq/index.html's
// apple-touch-icon repointed at a file absent from dist/, npm test green.
check('every icon and manifest URL on every built page resolves', function () {
  const problems = [];
  builtPages().forEach(function (file) {
    const html = fs.readFileSync(path.join(distDir, file), 'utf8');
    const urls = [...iconLinks(html).map((attrs) => attrs.get('href')), ...ogImages(html)];
    const missing = missingFromDist(urls);
    if (missing.length > 0) {
      problems.push('dist/' + file + ' references but does not ship: ' + missing.join(', '));
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// Which links have to be there, rather than how many there are in total. A
// count is the wrong shape for this: each page ships six icon and manifest
// links against a floor of five, so exactly one could vanish unnoticed, and
// review of #69 showed which one. Delete the manifest link from all four pages
// and nothing on the site references the manifest, the install prompt is gone
// everywhere, and both checks with the word manifest in their names report ok.
// "The web manifest is installable and its icons exist" cannot help, because it
// reads dist/site.webmanifest directly and never asks whether a page links it.
//
// Naming the rels rather than pinning the count keeps the thing that made a
// bare floor attractive: adding or dropping a favicon size is still a copy
// edit with none in this file, while the three links that must never disappear
// are held by name.
//
// CONTENT_PAGES rather than every built page. 404.html deliberately carries no
// manifest link, and requiring one would either be wrong or would quietly
// redefine what that page is for.
check('every content page declares an icon, an apple-touch-icon and a manifest', function () {
  const problems = [];
  CONTENT_PAGES.forEach(function (page) {
    const rels = new Set(iconLinks(pageHtml(page)).map((attrs) => attrs.get('rel')));
    const absent = ICON_RELS.filter((rel) => !rels.has(rel));
    if (absent.length > 0) {
      problems.push('dist/' + page.file + ' declares no ' + absent.join(' and no '));
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// index.html once declared a PNG as type="image/svg+xml". html-validate does
// not catch that, because the markup is structurally valid; only the claim
// about the file is wrong. So it is checked here.
//
// Over every built page for the same reason as the check above. Each content
// page's <head> carries its own three typed links, and #69 declared
// subs/index.html's favicon-32x32.png as image/svg+xml with the suite green.
// 404.html carries one typed link and was reached by nothing at all, so review
// of #69 shipped the exact defect this check's first line describes, on the one
// page no check opened.
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
  builtPages().forEach(function (file) {
    for (const attrs of linkAttributes(fs.readFileSync(path.join(distDir, file), 'utf8'))) {
      const href = attrs.get('href');
      const type = attrs.get('type');
      if (!href || !type) {
        continue;
      }
      const ext = path.extname(href.split('?')[0]).toLowerCase();
      const expected = EXTENSION_TYPES[ext];
      if (!expected) {
        continue;
      }
      const allowed = Array.isArray(expected) ? expected : [expected];
      if (!allowed.includes(type)) {
        wrong.push(
          'dist/' + file + ': ' + href + ' declared as ' + type +
            ', expected ' + allowed.join(' or ')
        );
      }
    }
  });
  if (wrong.length > 0) {
    throw new Error(wrong.join('; '));
  }
});

// One icon or manifest <link> reduced to a comparison key: its parsed
// attributes written back in name order, so the order they appear in the tag
// cannot read as a difference. Returns the page's icon and manifest links as a
// sorted array.
//
// Sorting is what makes this a comparison of links rather than of text. The
// four blocks are byte-identical today, so comparing raw text would pass, but
// that is the state of four hand-copied blocks rather than something to build a
// check on: writing href before rel is valid, html-validate accepts it, and
// calling it a drift is the #ffffff-against-#fff trap #67 names in a different
// spelling.
//
// That same reorder used to blind the URL check, which read rel and href in one
// pattern that only matched them in that order. Sorting here without fixing
// that there is the worst of both: the reorder stops the href being resolved
// and this check certifies it as no difference at all. Both now read
// linkAttributes, so neither can see an ordering.
//
// The tag list is sorted for the same reason as the attributes: a browser picks
// an icon by rel and sizes, so document order is not a fact worth pinning,
// while a link added, dropped or repointed is. Sorted rather than
// de-duplicated, so the same link shipped twice on one page stays a difference.
function iconLinkFingerprints(html) {
  return iconLinks(html)
    .map((attrs) =>
      [...attrs]
        .map(([name, value]) => name + '="' + value + '"')
        .sort()
        .join(' ')
    )
    .sort();
}

// The two checks above ask whether each page's own claims are true. Neither
// can see the four hand-copied blocks drifting apart, because a link repointed
// at a different file that ships is a URL that resolves and a type that is
// honest. Repointing code-of-conduct/index.html's apple-touch-icon at
// /img/favicon-32x32.png left both green while that page handed iOS a 32px
// favicon for the home screen. This is the move #68 made for the bundle and
// the stylesheet, pointed at the block those checks do not cover: four
// hand-kept copies become one enforced fact.
//
// Grouped rather than compared against a reference page. Naming one page the
// reference means a break in that page is reported as the other three
// disagreeing, sending a maintainer to three files that are correct. Grouping
// prints each distinct block beside the pages that ship it, so the page at
// fault is the group of one. assetRefs answers the same question a shorter way,
// with a Set over one ref per page, which does not carry here: a page holds six
// links rather than one, so a flat list would not say which of them differed.
//
// og:image is deliberately not here. The check above already proves each
// page's resolves in dist/, which is the silent 404 it exists for, and
// requiring the four to name the *same* image would additionally forbid a
// per-page share image. That is a reasonable thing for this site to want
// later, in a way four different favicons is not.
//
// No floor of its own. "Every content page declares an icon, an
// apple-touch-icon and a manifest" is the floor, and it is the better shape:
// four pages that had all lost the block would agree with each other here, and
// that check names the rels rather than counting them. A second count in this
// function would be one more thing to keep in step and would forbid the league
// ever shipping fewer favicon sizes.
//
// No non-empty guard on CONTENT_PAGES itself either: "every page the sitemap
// lists was actually built" asserts that once, above every check that loops the
// list.
check('every content page ships the same icon and manifest links', function () {
  const blocks = new Map();
  CONTENT_PAGES.forEach(function (page) {
    const key = iconLinkFingerprints(pageHtml(page)).join('\n');
    blocks.set(key, [...(blocks.get(key) || []), page.file]);
  });
  if (blocks.size === 1) {
    return;
  }

  // Only the links that actually differ. Printing all six per group put roughly
  // 1.5 KB on one line and left the maintainer to spot the odd entry by eye,
  // which is the useful half buried in the rest.
  //
  // Counted rather than tested for membership, because the duplicate case
  // differs by multiplicity alone: a manifest link shipped twice on one page is
  // present in both groups, so an `includes` test finds nothing varying and the
  // message reduces to "[] against []". Filtering the group's own array against
  // the varying list then keeps the repeat visible, which is what says which
  // side has two of them.
  const groups = [...blocks].map(([key, files]) => ({ files, links: key.split('\n') }));
  const counted = groups.map((group) =>
    group.links.reduce((seen, link) => seen.set(link, (seen.get(link) || 0) + 1), new Map())
  );
  const varying = [...new Set(groups.flatMap((group) => group.links))].filter(
    (link) => new Set(counted.map((seen) => seen.get(link) || 0)).size > 1
  );
  throw new Error(
    'content pages ship different icon and manifest links: ' +
      groups
        .map(
          (group) =>
            group.files.map((file) => 'dist/' + file).join(' and ') + ' has ' +
            JSON.stringify(group.links.filter((link) => varying.includes(link)))
        )
        .join('; against ')
  );
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

// A wrong price is the worst bug this site can ship, and the fee is stated on
// two pages now: six times in dist/index.html and four times in the FAQ. This
// read dist/index.html alone, which left the realistic failure uncovered. The
// league changes the fee, one page is edited, the other page's copies are
// missed, and every check stays green while the site quotes two prices to the
// same player. The FAQ's own JSON-LD-matches-page check does not close it: it
// compares each answer's opening clause only, and the FAQ's four copies drift
// together anyway.
//
// Walks every built page rather than CONTENT_PAGES, 404.html included, so a
// price landing on a page nobody expected to carry one is still held to the
// rest. Reads the whole document rather than slicing from <body>, which the
// single-page version did: the three description tags in index.html's <head>
// state the fee too and nothing compared them to the body. The per-page
// description check requires only that a page's own three tags agree with each
// other, so all three could say $75 against a body saying $70 and stay green,
// and a price wrong only in og:description is the price a link preview shows.
// Scanning the JSON-LD is correct for the same reason: a rich result surfaces
// it. The amounts stay strings and are never coerced to Number, so $70 and
// $70.00 read as a disagreement rather than folding into one value. A thousands
// separator folds the other way, $1,250 capturing 1, which costs nothing at one
// two-digit fee and is the thing to settle before the site prices anything over
// $999.
//
// The floor and the comparison read deliberately different things, and that
// asymmetry is load-bearing. The comparison takes the raw document, because
// og:description and the JSON-LD are where a link preview and a rich result get
// the fee. The floor takes visiblePage(), because "the page states a price" has
// to mean a price a player can read: widening the comparison to the whole
// document otherwise downgrades the floor to "the document mentions one
// somewhere", and three <meta> tags nobody reads would satisfy an error message
// that says this is the first thing a player asks. That is the drift #54 shipped
// pointing the other way. The floor is stricter than the <body> slice it
// replaces for the same reason: that slice could be satisfied by the JSON-LD
// block or by a stray comment alone. Do not collapse the two back together.
//
// The floor is also what makes the widening safe. Collecting across every page
// would otherwise let index.html drop the fee entirely while the FAQ's copies
// satisfied the check on their own. It cannot, however, catch a dist/ that built
// nothing: line 30 reads dist/index.html and line 55 walks dist/, both at module
// load, so an empty build directory throws before any check runs.
//
// If a second, genuinely different amount is ever added, this check is the
// thing that should be updated deliberately.
check('every price on the site states the same amount', function () {
  const block = indexHtml.match(JSON_LD_BLOCK);
  if (!block) {
    throw new Error('no JSON-LD block in dist/index.html');
  }
  if (!/\$\d/.test(visiblePage(indexHtml, block[0]))) {
    throw new Error(
      'dist/index.html states no price a reader can see, which is the first thing a player asks'
    );
  }

  // Comments are stripped before the comparison, and this direction of the
  // #48 rule is the less obvious one. A comment cannot show a visitor a price,
  // so it cannot disagree with one either, but it can fail the build: a line
  // recording that the fee was $60 before Spring 2026 reads as a second amount
  // and goes red. The repair a maintainer reaches for is deleting the
  // explanation, which is the check teaching people to remove the history that
  // makes the next fee change safe.
  const pagesByAmount = new Map();
  walk(distDir)
    .filter((rel) => rel.endsWith('.html'))
    .forEach(function (rel) {
      const html = fs
        .readFileSync(path.join(distDir, rel), 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '');
      for (const match of html.matchAll(/\$(\d+(?:\.\d\d)?)/g)) {
        if (!pagesByAmount.has(match[1])) {
          pagesByAmount.set(match[1], new Set());
        }
        pagesByAmount.get(match[1]).add(rel);
      }
    });
  if (pagesByAmount.size > 1) {
    // The message names this file as well as the pages. Every failure here has
    // two possible repairs, and they point opposite ways: one of the copies has
    // drifted and the copy is wrong, or the site genuinely states a second
    // amount and this check is wrong. Reporting only "conflicting prices" makes
    // editing the copy the path of least resistance, which on the second reading
    // means making a true sentence false to get the build green.
    throw new Error(
      'conflicting prices across the site: ' +
        [...pagesByAmount]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([amount, pages]) => '$' + amount + ' in ' + [...pages].sort().join(', '))
          .join('; ') +
        '; if the site now states a second, genuinely different amount, this check in ' +
        'scripts/smoke-build.js is what to update'
    );
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
    // Only the argument-less call is frozen. `new Date(value)` has to honour
    // its argument: js/app.js builds a Date from a parsed timestamp to read
    // the day back off it, and a stub that answered "today" to every one of
    // those made every row on the page fail to parse. A constructor that
    // ignores its argument is not a stand-in for the real one, and the way
    // this surfaced, 17 checks red for a reason none of their messages named,
    // is what that costs.
    function FrozenDate(value) {
      return arguments.length > 0 ? new Date(value) : new Date(frozen);
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
    // A null in the fixture models an attribute the markup never carried,
    // which is a different failure from one carrying a garbled value: the
    // bundle reads null rather than a string, and null.split() throws.
    //
    // Only meaningful for data-end and data-registration. A real page loses a
    // row with no data-start to the `tbody tr[data-start]` selector before the
    // bundle ever sees it, and this stub's querySelectorAll ignores its
    // selector, so nulling data-start here would model a row no browser
    // delivers. That row is caught in the markup instead, by the tbody count
    // in scheduleRows().
    [
      ['data-start', season[1]],
      ['data-end', season[2]],
      ['data-registration', season[3]],
    ].forEach(function ([name, value]) {
      if (value !== null) {
        row.setAttribute(name, value);
      }
    });
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

// parseDate is Date.UTC over three Number() calls, so anything that is not
// three numbers yields NaN, and NaN loses every comparison in statusOf
// silently. The row does not error, it just answers wrongly forever, and the
// wrong answer reaches the most prominent control on the page.
const GARBLED_START = [
  ['Spring 2026', '2026-04-12', '2026-06-07', '2026-03-12'],
  ['Summer 2026', '2026-06-28', '2026-08-23', '2026-05-28'],
  ['Fall 2026', '2026-09-1O', '2026-11-08', '2026-08-13'],
  ['Winter 2027', '2027-01-10', '2027-03-07', '2026-12-11'],
];

// The mechanism issue #63 names: a NaN start wins the nextRegistration
// selection the moment it is reached, because `!nextRegistration` is true for
// the first candidate, and then no later row can displace it, because
// `start < NaN` is false for every one of them. The hero is pinned to the
// unreadable row for as long as the typo is in the markup.
check('a row the bundle cannot read is skipped rather than guessed at', function () {
  const result = statusesOn('2026-07-31', { seasons: GARBLED_START });
  if (result.labels[2] !== null) {
    throw new Error(
      'the unreadable row was labelled ' + JSON.stringify(result.labels[2]) +
        ', which is a status derived from a date nothing could parse'
    );
  }
  // Every other row still has to behave exactly as it does with the fixture
  // intact, or the guard has swallowed the whole table rather than one row.
  const others = [result.labels[0], result.labels[1], result.labels[3]];
  if (JSON.stringify(others) !== JSON.stringify(['Completed', 'In progress', 'Upcoming'])) {
    throw new Error('one bad row changed the rest of the table: ' + JSON.stringify(result.labels));
  }
  if (result.join !== 'Join Winter 2027') {
    throw new Error(
      'the hero offers ' + JSON.stringify(result.join) +
        ', a season picked from a row whose start date is unreadable'
    );
  }
});

// The same defect one attribute over, and this is the half a visitor sees:
// longDate used to read the garbled string straight into the sentence beside
// the Join button, so the page asked for money under copy reading "August NaN".
// The rolled-over spellings are the check above; this one is the unparseable
// spelling, and the two titles are worded to say which is which.
check('an unparseable date never reaches the hero as copy', function () {
  const garbledRegistration = GARBLED_START.map(function (season) {
    return season[0] === 'Fall 2026'
      ? ['Fall 2026', '2026-09-13', '2026-11-08', '2026-08-1O']
      : season;
  });
  const result = statusesOn('2026-07-31', { seasons: garbledRegistration });
  // Scanned before the sentence is compared, not after. Reversed, the equality
  // below rejects any note containing "NaN" first and this branch could never
  // run, which is an assertion that reads as coverage while being unable to go
  // red. It also gives the more diagnostic message of the two.
  if (/NaN|undefined/.test(result.note + ' ' + result.join)) {
    throw new Error(
      'the hero rendered an unparsed date: ' + JSON.stringify(result.note + ' / ' + result.join)
    );
  }
  // The scan above only proves nothing garbled reached the page. This proves
  // the right thing did: the unreadable row dropped out and the hero named the
  // next season a visitor could really join.
  if (result.note !== 'Summer 2026 is in progress. Winter 2027 registration opens December 11, 2026.') {
    throw new Error('hero note with an unreadable registration date: ' + JSON.stringify(result.note));
  }
});

// Rejecting NaN is not the same as requiring a date, and review of the first
// pass at #63 caught the difference. Date.UTC(2026, 12, 1) is January 1 2027,
// not an error, so a month of 13 sails through an isNaN guard, and longDate
// then reads MONTHS[12] off the raw attribute and puts "Registration opens
// undefined 1, 2026." beside the Join button. That is the exact string issue
// #63 was filed about, still reachable after the guard that was supposed to
// close it. Every value below is a single keystroke away from a real date.
const ROLLOVER_DATES = [
  // A month that does not exist. Rolls forward a year.
  ['2026-13-01', 'month 13'],
  // A day its month does not have. Rolls into September.
  ['2026-08-32', 'day 32'],
  // February 30, which Date.UTC and V8's own string parser both accept.
  ['2026-02-30', 'February 30'],
  // A two-digit year, which Date.UTC maps to 1926 and nothing else notices.
  ['26-08-20', 'a two-digit year'],
];

check('a date that rolls over instead of failing is still not a date', function () {
  ROLLOVER_DATES.forEach(function ([value, description]) {
    const seasons = CHRONOLOGICAL_SEASONS.map(function (season) {
      return season[0] === 'Fall 2026'
        ? ['Fall 2026', '2026-09-13', '2026-11-08', value]
        : season;
    });
    const result = statusesOn('2026-07-31', { seasons: seasons });
    const rendered = result.note + ' / ' + result.join + ' / ' + result.callout;
    if (/NaN|undefined/.test(rendered)) {
      throw new Error(description + ' (' + value + ') reached the page: ' + JSON.stringify(rendered));
    }
    if (result.labels[2] !== null) {
      throw new Error(
        description + ' (' + value + ') was given the status ' + JSON.stringify(result.labels[2])
      );
    }
    // Winter 2027 is the next season a visitor could really join once the
    // unreadable row drops out. Asserted as well as the NaN scan, because a
    // row that silently rolls to a plausible-looking date renders no NaN at
    // all: "2026-02-30" would quietly advertise March 2.
    if (result.join !== 'Join Winter 2027') {
      throw new Error(
        description + ' (' + value + ') left the hero offering ' + JSON.stringify(result.join)
      );
    }
  });
});

// A missing attribute is the far end of the same problem and is worse than a
// garbled one: getAttribute returns null, null.split() throws, and the throw
// escapes the schedule IIFE and aborts the rest of the module, taking the
// footer year with it. One typo'd row must not cost the page every other
// thing this bundle does.
//
// On the regression this was written for, the throw propagates out of
// runBundle before either assertion below is reached, so what a maintainer
// actually reads is the raw TypeError under this check's name. The footer-year
// assertion is what proves the rest of the module still ran once the throw is
// gone, which is the half a TypeError cannot tell you.
check('a row missing a date attribute does not take the rest of the bundle down', function () {
  const schedule = buildScheduleTable([
    ['Summer 2026', '2026-06-28', '2026-08-23', '2026-05-28'],
    ['Fall 2026', '2026-09-13', null, '2026-08-13'],
  ]);
  const year = createElementStub();
  runBundle(
    { 'footer-year': year },
    false,
    { table: schedule.table, today: '2026-07-31T12:00:00Z' }
  );
  if (year.textContent !== '2026') {
    throw new Error(
      'the footer year reads ' + JSON.stringify(year.textContent) +
        ', so a row with a missing date attribute aborted the rest of the bundle'
    );
  }
  if (schedule.rows[1].appended.length !== 0) {
    throw new Error('the row with no data-end was given a status anyway');
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
  // Scoped to the tbody so the row count below is a count of season rows and
  // not of the header row as well.
  const tbody = table[2].match(/<tbody\b[^>]*>([^]*?)<\/tbody>/);
  if (!tbody) {
    throw new Error('the schedule table has no tbody, so no season row can be read out of it');
  }
  const rows = [...tbody[1].matchAll(/<tr\b([^>]*\bdata-start=[^>]*)>([^]*?)<\/tr>/g)];
  if (rows.length === 0) {
    throw new Error('the schedule table ships no rows carrying data-start');
  }
  // Every check in this section reads this list, and a row without data-start
  // is not in it. Deleting that one attribute therefore dropped a whole season
  // out of all of them with the suite green, which is precisely the shape of
  // failure this section exists to catch. It is not a paper cut either: the
  // browser's own `tbody tr[data-start]` selector drops the row too, while the
  // bundle still appends the Status header, so the page ships a column that
  // row has no cell for. Selecting rows by an attribute means the absence of
  // that attribute has to be an error rather than a smaller set.
  const total = (tbody[1].match(/<tr\b/g) || []).length;
  if (total !== rows.length) {
    throw new Error(
      'the schedule tbody has ' + total + ' rows but only ' + rows.length +
        ' carry data-start, and a row without it is invisible to every check in this section'
    );
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

// The night the league plays is stated once, in the League Info Day line, and
// three checks below need it. Read in one place so the three cannot drift:
// they already carried three different messages for the same failure, one of
// which did not echo the line it had rejected, and a maintainer who moves the
// league to Saturdays should be reading one derivation rather than three.
// `consequence` keeps each caller's half of the sentence.
function playNight(consequence) {
  const day = leagueInfo('Day');
  if (!day) {
    throw new Error('League Info has no Day line, so nothing says which night play falls on');
  }
  const index = WEEKDAYS.findIndex((name) => day.includes(name));
  if (index === -1) {
    throw new Error('the Day line does not name a weekday, ' + consequence + ': ' + day);
  }
  return index;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Part message, part coverage, and which half depends on the attribute.
//
// For an unparseable value the build was already red: the four checks below
// all reach the dates through parseDay, which throws. What they reported was
// "unparseable date: 2026-09-2O" from a check named after a week count, or,
// for a day its month does not have, "cell ... does not show Dec 1 from
// 2026-11-31", which sends a maintainer to edit a cell that is correct. Both
// are the wrong repair. This names the row, the attribute and the value, and
// it runs ahead of them.
//
// For data-registration it is the only check there is. A roll-forward moves a
// start or an end by one to three days, never a multiple of seven, so the
// league-night check below always catches those; nothing catches a
// registration date. Set data-registration="2027-09-31" and write the cell as
// October 1, which is where it lands, and this is the sole failure in the
// suite. Verified, not assumed.
//
// It is also the only statement of the contract that does not depend on
// parseDay throwing, which is a side effect of a helper written for something
// else: make parseDay lenient enough to accept an unpadded "2026-8-20" and
// every guarantee below evaporates with the suite green.
//
// The round-trip is what makes the regex mean anything. V8's string parser and
// Date.UTC both accept "2026-11-31" and roll it forward to December 1 without
// complaining, so the shape alone passes a value that is not a date, and a
// check that half-validates reads as one that validates.
//
// js/app.js enforces the same rule in its own parseDate, and that is not
// duplication for its own sake: this one tells a maintainer at build time
// which row to open, and that one stops a visitor being shown the result if a
// bad row ever reaches the page. Pushing to main is the deploy here and CI
// does not gate it, so the second is not covered by the first.
check('every schedule row carries dates that are real calendar dates', function () {
  const problems = [];
  scheduleRows().forEach(function (row) {
    [
      ['data-start', row.start],
      ['data-end', row.end],
      ['data-registration', row.registration],
    ].forEach(function ([name, value]) {
      const parts = ISO_DATE.exec(value);
      if (!parts) {
        problems.push(row.season + ' ' + name + '="' + value + '" is not a yyyy-mm-dd date');
        return;
      }
      const [year, month, day] = parts.slice(1).map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        problems.push(
          row.season + ' ' + name + '="' + value + '" is not a day that exists; it lands on ' +
            date.toISOString().slice(0, 10)
        );
      }
    });
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// ---- rows that are wrong about which season they are ---------------------
// The four checks below came out of an adversarial pass on #63, and they share
// a shape none of the checks around them can see. Every row they reject ships
// dates that are real, agree with their cells, fall on league nights and count
// to the eight weeks the price copy sells. Nothing is malformed. The row is
// simply wrong about which season it belongs to, and each one reaches the hero.
//
// Both rules a maintainer might have expected to be hardcoded here are taken
// from the table instead, which is the same reason the play night comes from
// League Info: a rule written into this file is a second place to edit when
// the league changes, and the one that gets forgotten.

check('every registration window belongs to the season beside it', function () {
  const rows = scheduleRows();
  const problems = [];

  rows.forEach(function (row) {
    const start = parseDay(row.start);
    const opens = parseDay(row.registration);

    // Registration on or after the first night is not a window at all. statusOf
    // tests `today >= start` before it tests the registration day, so such a
    // row runs Upcoming straight into In progress and "Registration open" is
    // unreachable: the hero can never announce the one season a visitor could
    // join. This is deliberately weaker than the "one month before" practice
    // CLAUDE.md declines to check, and Winter 2027, the row that would fail
    // that rule, satisfies this one comfortably.
    if (opens >= start) {
      problems.push(
        row.season + ' registration opens ' + row.registration + ', on or after its own start ' +
          row.start + ', so the row can never read Registration open'
      );
      return;
    }

    // A registration date left behind from the row it was copied out of is how
    // this goes wrong in practice, and every other check is blind to it: the
    // date is real, it matches its own cell, and it is before its start. No
    // interval has to be invented to catch it, because the table already says
    // which starts exist. A window belongs to the season it is nearest.
    const distance = start - opens;
    const days = (ms) => Math.round(ms / 86400000);
    // The nearest other start, not every nearer one. A stale date is nearer to
    // most of the table, and a list of six seasons buries the one it was
    // actually copied from, which is the row a maintainer has to open.
    const nearest = rows
      .filter((other) => other !== row)
      .map((other) => ({ season: other.season, gap: Math.abs(parseDay(other.start) - opens) }))
      .sort((a, b) => a.gap - b.gap)[0];
    if (nearest && nearest.gap < distance) {
      problems.push(
        row.season + ' registration opens ' + row.registration + ', ' + days(distance) +
          ' days before its own start but only ' + days(nearest.gap) + ' from ' +
          nearest.season + ', so it is the wrong season\'s window'
      );
    }
  });

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// js/app.js reads cells[0] straight into the hero CTA, so the Season cell is
// the name a visitor is asked to join, and nothing checked it against the dates
// in its own row. Roll a row forward a year and forget the name and the page
// offers "Join Fall 2027" for a season playing in October 2028, with every
// other check green because the dates themselves are impeccable.
check('every season name states the year its own dates fall in', function () {
  const problems = [];
  scheduleRows().forEach(function (row) {
    // Either end counts, because a winter season can straddle December. That is
    // the same reason the bye check tries both years.
    const years = [parseDay(row.start).getUTCFullYear(), parseDay(row.end).getUTCFullYear()];
    if (!years.some((year) => row.season.includes(String(year)))) {
      problems.push(
        '"' + row.season + '" names no year its own dates fall in (' +
          [...new Set(years)].join(' or ') + ')'
      );
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// The other half of that same edit: copy a row, update the dates, forget the
// name, and the table ships two rows called "Fall 2027", one Completed and one
// Registration open. The hero names whichever the selection reaches, and a
// visitor comparing the button against the table sees the button naming a row
// that closed.
check('no two schedule rows name the same season', function () {
  const startsByName = new Map();
  const problems = [];
  scheduleRows().forEach(function (row) {
    if (startsByName.has(row.season)) {
      problems.push(
        '"' + row.season + '" is the name of two rows, one starting ' +
          startsByName.get(row.season) + ' and one starting ' + row.start
      );
    } else {
      startsByName.set(row.season, row.start);
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// A ladder league plays one season at a time, and js/app.js assumes it without
// saying so: the row loop assigns `current` unconditionally, so two rows both
// reading In progress leave the callout and the hero naming whichever sits
// later in the document. CLAUDE.md pins the mirror image of this for the next
// season, which is chosen by comparing start dates precisely so document order
// cannot decide it; the running season had the same exposure with no rule and
// no check. Rows need not be chronological, so every pair is compared rather
// than each row and the one after it.
check('no two seasons are on court at the same time', function () {
  const rows = scheduleRows();
  const problems = [];
  rows.forEach(function (row, index) {
    rows.slice(index + 1).forEach(function (other) {
      if (parseDay(row.start) <= parseDay(other.end) && parseDay(other.start) <= parseDay(row.end)) {
        problems.push(
          row.season + ' (' + row.start + ' to ' + row.end + ') overlaps ' +
            other.season + ' (' + other.start + ' to ' + other.end + ')'
        );
      }
    });
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// Unlike the check above, this one is coverage rather than a message. The
// week count below counts league nights between the two dates, so nudging a
// start off the play night still balances: Sat Sep 19 to Sun Nov 8 holds the
// same eight Sundays that Sun Sep 20 does. The cell beside it agrees, because
// both halves are written in the same edit and this is the edit that goes
// half-done. Every other row check stays green while the table opens a season
// on a night the league does not play, and js/app.js flips the row to In
// progress a day early.
//
// data-registration is deliberately not held to this. It opens on a weekday,
// a Thursday or a Friday on every row the table ships, because it is a window
// rather than a night of play.
check('every season starts and ends on a league night', function () {
  const playDay = playNight('so no season can start on one');

  const problems = [];
  scheduleRows().forEach(function (row) {
    [['starts', row.start], ['ends', row.end]].forEach(function ([label, iso]) {
      const weekday = parseDay(iso).getUTCDay();
      if (weekday !== playDay) {
        problems.push(
          row.season + ' ' + label + ' on ' + iso + ', a ' + WEEKDAYS[weekday] +
            ', but the league plays ' + WEEKDAYS[playDay] + 's'
        );
      }
    });
  });

  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

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

  const playDay = playNight('so no season length can be counted');

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
  const playDay = playNight('so no bye can be placed');

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

// The <style> block the 404 page carries instead of a stylesheet link. Read
// through one helper because three checks want it and each of them would
// otherwise carry its own copy of this pattern, which is the trap that let the
// html-validate page list drift.
function inlineStyles(file) {
  const html = fs.readFileSync(path.join(distDir, file), 'utf8');
  const style = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (!style) {
    throw new Error('dist/' + file + ' has no inline styles to check');
  }
  return style[1];
}

// #ffffff and #fff are the same colour and a different string. The built
// stylesheet is minified and the 404 page's inline block is not, so the two
// halves of the palette reach a comparison spelled differently, and comparing
// the raw text would report every shortened token as a drift. Anything that is
// not a bare hex is compared on its collapsed whitespace instead, which is the
// other thing minification changes, so this stays honest for a non-colour
// token without pretending to understand it.
//
// What that leaves, named rather than hidden: the minifier also rewrites
// rgba() to eight-digit hex, so a token copied in the longhand form would read
// as a drift against a stylesheet that had shortened it. The eight tokens the
// 404 page copies are all bare six-digit hex, and the failure would be a red
// build with a message naming both spellings, not a silent pass.
function normaliseCssValue(value) {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  const hex = collapsed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!hex) {
    return collapsed;
  }
  const digits = hex[1].toLowerCase();
  return '#' + (digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits);
}

// Every custom property a :root block declares, as a name -> value map.
//
// The *first* :root block, which is what source order means here: the
// stylesheet reopens :root inside two media queries to shrink --section-pad
// and --container-pad, and the base value is the one a copy has to match.
// Neither of those is a colour and neither is copied, so this only decides
// which value wins for a token that is overridden, never which tokens exist.
//
// Each declaration is anchored on a boundary rather than matched loose, for
// the reason ruleContrast anchors `color`: an unanchored `--name:` can match
// inside a value and report a token the block never declared.
//
// Comments are stripped before that anchoring runs, and the two halves are one
// rule. The only boundary in front of the first declaration is the start of
// the block, so a comment sitting there pushes it past the anchor and it drops
// out of the map: the check goes on reporting ok over seven of the eight
// tokens. css/style.css opens its own :root with `/* Palette */`, and the 404
// block is not minified, so that is a plausible edit and not a hypothetical.
function rootTokens(css, source) {
  const block = css.match(/:root\s*\{([^}]*)\}/);
  if (!block) {
    throw new Error('no :root block in ' + source);
  }
  const declarations = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map();
  for (const [, name, value] of declarations.matchAll(/(?:^|;)\s*--([\w-]+)\s*:\s*([^;}]+)/g)) {
    tokens.set(name, normaliseCssValue(value));
  }
  return tokens;
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
  eyebrowContrast(inlineStyles('404.html'), '.eyebrow', 'the 404 page inline styles');
});

// The 404 page copies eight colour tokens out of the :root block in
// css/style.css, and a comment above them asking a maintainer to keep the two
// in step is all that has ever held them together. That is a list kept in step
// by hand, which this file names as a trap in four other places.
//
// All eight agree today, so this ships as a guard rather than with a fix, and
// that is the reason to add it now: it goes in green instead of arriving with
// a repair and proving nothing.
//
// The copy is permanent by design and cannot be refactored away. That page
// carries its own styles so it still renders when the hashed stylesheet is the
// thing that failed, so it can never link or @import the real palette. A check
// is the only option there is.
//
// The #60 contrast check above does not cover this and must not absorb it.
// Parity asks whether the two files agree; contrast asks whether a pair is
// legible, and a page can pass either while failing the other. A token that
// drifts to some other perfectly legible colour is invisible to contrast, and
// contrast is blind to the six tokens the eyebrow does not use at all.
//
// Two of the pairs on that page have little headroom, --ink-muted on --cream
// at 4.99:1 and --white on --court-green at 5.27:1, so lightening either token
// in css/style.css alone leaves the 404 page on the old value, and doing it in
// 404.html alone drops that page under 4.5:1 by itself. Either way the markup
// stays valid and the text stays present.
//
// Iterating the 404 page's tokens rather than the stylesheet's is what keeps
// this workable. The stylesheet declares the whole type, shadow, spacing and
// radius scale on top of a wider palette, so comparing the other way would
// demand the error page carry the entire design system. The subset is
// deliberate.
check('every colour token 404.html copies still matches the stylesheet', function () {
  const copied = rootTokens(inlineStyles('404.html'), 'dist/404.html');
  const palette = rootTokens(
    fs.readFileSync(path.join(distDir, styleRef), 'utf8'),
    'the emitted css'
  );

  // A loop over a derived list passes vacuously when the list is empty, and
  // this list is derived by reading a :root block out of an HTML file. A
  // rewritten <style> block, or the palette moved out of :root, would leave
  // this reporting ok over nothing at all.
  if (copied.size === 0) {
    throw new Error('the :root block in dist/404.html declares no tokens, so this compared nothing');
  }

  const problems = [];
  copied.forEach(function (value, name) {
    if (!palette.has(name)) {
      problems.push(
        '--' + name + ' is ' + value + ' in 404.html and the stylesheet does not declare it'
      );
    } else if (palette.get(name) !== value) {
      problems.push(
        '--' + name + ' is ' + palette.get(name) + ' in the stylesheet and ' + value +
          ' in 404.html'
      );
    }
  });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
});

// The other half of holding that copy honest. #60 removed --amber from the 404
// palette when the eyebrow stopped using it, and nothing would have caught it
// staying: an unused token is one more line for the check above to hold in step
// for no benefit, and it is the copy most likely to drift, because no rendered
// pixel changes when it does.
//
// The reverse is the sharper failure and is why this is set equality rather
// than a scan for leftovers. A token the page uses but never declares resolves
// to nothing, so the property it sets falls back to its initial value: colour
// goes black, background goes transparent. The page still renders, which is
// the whole point of it carrying its own styles, it just renders wrong.
//
// This is also what stops the check above being satisfiable by an empty block.
// Its own floor catches the list going to zero; this one catches it going to
// zero while eight var() calls are still asking for those tokens, and derives
// the second number from something that does not depend on the :root regex.
check('404.html declares exactly the colour tokens it uses', function () {
  const style = inlineStyles('404.html');
  const declared = rootTokens(style, 'dist/404.html');
  const used = new Set([...style.matchAll(/var\(\s*--([\w-]+)/g)].map((match) => match[1]));

  const problems = [];
  [...declared.keys()]
    .filter((name) => !used.has(name))
    .forEach(function (name) {
      problems.push('--' + name + ' is declared in 404.html and never used');
    });
  [...used]
    .filter((name) => !declared.has(name))
    .forEach(function (name) {
      problems.push('--' + name + ' is used in 404.html and never declared');
    });
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
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
