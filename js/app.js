// The stylesheet enters the build through this import. Without it Vite has no
// reason to process css/style.css, and it would ship unhashed and unminified
// the way the old CopyPlugin pattern shipped it.
import '../css/style.css';

(function () {
  'use strict';

  var toggle = document.getElementById('menu-toggle');
  var nav = document.getElementById('nav-links');
  var header = document.getElementById('site-header');

  // Nothing below applies on a page without the site header, and an
  // unguarded addEventListener on null would break the whole bundle.
  if (!toggle || !nav || !header) {
    return;
  }

  // Mirrors the breakpoint that turns .nav-links into the off-canvas drawer in
  // css/style.css. `inert` is not media-query aware, so the two have to be kept
  // in step by hand: inerting the desktop nav would make it unusable.
  var mobile = window.matchMedia('(max-width: 768px)');

  // A closed drawer is moved off-screen by a transform, which hides it from
  // sight but leaves it in the tab order and the accessibility tree. CSS
  // visibility handles that before this script runs; `inert` is the belt to
  // that suspenders and additionally blocks pointer events and find-in-page.
  function syncInert() {
    if (mobile.matches && !nav.classList.contains('open')) {
      nav.setAttribute('inert', '');
    } else {
      nav.removeAttribute('inert');
    }
  }

  function navLinks() {
    return nav.querySelectorAll('a[href]');
  }

  function openMenu() {
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation menu');
    nav.classList.add('open');
    document.body.classList.add('menu-open');
    // Before the focus call, not after: focus is refused inside an inert tree.
    syncInert();
    var links = navLinks();
    if (links.length > 0) {
      links[0].focus();
    }
  }

  function closeMenu() {
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    nav.classList.remove('open');
    document.body.classList.remove('menu-open');
    syncInert();
  }

  toggle.addEventListener('click', function () {
    var isOpen = nav.classList.contains('open');
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close menu when a nav link is clicked
  nav.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      closeMenu();
    }
  });

  // Close menu when clicking outside (on the overlay)
  document.addEventListener('click', function (e) {
    if (
      nav.classList.contains('open') &&
      !nav.contains(e.target) &&
      !toggle.contains(e.target)
    ) {
      closeMenu();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      closeMenu();
      toggle.focus();
    }
  });

  // Keep Tab inside the open drawer. The page behind it stays focusable, so
  // without this the third Tab walks out of the menu and into content the
  // overlay is covering. The toggle doubles as the close button and sits above
  // the panel, so it is part of the cycle rather than an escape hatch.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !nav.classList.contains('open')) {
      return;
    }
    var cycle = [toggle].concat(Array.prototype.slice.call(navLinks()));
    var first = cycle[0];
    var last = cycle[cycle.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Crossing the breakpoint with the drawer open would otherwise leave the
  // desktop nav carrying menu-open state and a full-page overlay.
  mobile.addEventListener('change', function () {
    if (!mobile.matches && nav.classList.contains('open')) {
      closeMenu();
    } else {
      syncInert();
    }
  });

  syncInert();

  // Header shadow on scroll
  var scrollThreshold = 10;
  var ticking = false;

  function updateHeader() {
    if (window.scrollY > scrollThreshold) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      requestAnimationFrame(updateHeader);
      ticking = true;
    }
  }, { passive: true });
})();
(function () {
  'use strict';

  // League schedule status.
  //
  // Every label here is derived from the dates on each row rather than written
  // by hand, because a hand-written "current season" is wrong the moment the
  // season ends, which is exactly the state issue #10 found the table in.
  //
  // Progressive enhancement on purpose. Without JS the table renders as it
  // always did, with real dates in it; the status column and the callout are
  // simply absent rather than empty or stale.

  var table = document.querySelector('.league-table');
  var callout = document.getElementById('season-callout');
  if (!table) {
    return;
  }

  var rows = table.querySelectorAll('tbody tr[data-start]');
  if (rows.length === 0) {
    return;
  }

  // Parsed as UTC midnight so a visitor's timezone cannot shift a season by a
  // day either side of a boundary.
  function parseDate(value) {
    var parts = value.split('-');
    return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  var now = new Date();
  var today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function longDate(value) {
    var parts = value.split('-');
    return MONTHS[Number(parts[1]) - 1] + ' ' + Number(parts[2]) + ', ' + parts[0];
  }

  function statusOf(row) {
    var start = parseDate(row.getAttribute('data-start'));
    var end = parseDate(row.getAttribute('data-end'));
    var registration = parseDate(row.getAttribute('data-registration'));

    if (today > end) {
      return { label: 'Completed', modifier: 'past' };
    }
    if (today >= start) {
      return { label: 'In progress', modifier: 'current' };
    }
    if (today >= registration) {
      return { label: 'Registration open', modifier: 'open' };
    }
    return { label: 'Upcoming', modifier: 'upcoming' };
  }

  // Build the column rather than shipping empty cells in the markup.
  var headRow = table.querySelector('thead tr');
  if (headRow) {
    var th = document.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = 'Status';
    headRow.appendChild(th);
  }

  var current = null;
  var nextRegistration = null;

  Array.prototype.forEach.call(rows, function (row) {
    var status = statusOf(row);
    var cell = document.createElement('td');
    cell.setAttribute('data-label', 'Status');
    cell.className = 'season-status season-status--' + status.modifier;
    cell.textContent = status.label;
    row.appendChild(cell);
    row.classList.add('season-row--' + status.modifier);

    var name = row.cells[0].textContent.trim();
    if (status.modifier === 'current') {
      current = name;
    }
    // The soonest season that has not started yet, whether or not its
    // registration window has opened.
    if ((status.modifier === 'open' || status.modifier === 'upcoming') && !nextRegistration) {
      nextRegistration = { name: name, opens: row.getAttribute('data-registration'), isOpen: status.modifier === 'open' };
    }
  });

  if (callout) {
    var parts = [];
    if (current) {
      parts.push(current + ' is in progress.');
    }
    if (nextRegistration) {
      parts.push(
        nextRegistration.isOpen
          ? nextRegistration.name + ' registration is open now.'
          : nextRegistration.name + ' registration opens ' + longDate(nextRegistration.opens) + '.'
      );
    }
    if (parts.length > 0) {
      callout.textContent = parts.join(' ');
      callout.hidden = false;
    }
  }
})();

(function () {
  'use strict';

  // The footer year was hardcoded and needed an edit every January. The markup
  // still ships the current year, so a visitor without JS sees a correct year
  // rather than an empty gap; this just stops it going stale on its own.
  var year = document.getElementById('footer-year');
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }
})();
