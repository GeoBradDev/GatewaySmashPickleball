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

  var ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  // The one place a string becomes a date. Everything downstream works in
  // timestamps, so there is no second parser to disagree with this one.
  //
  // Parsed as UTC midnight so a visitor's timezone cannot shift a season by a
  // day either side of a boundary. NaN is the answer for anything that is not
  // a date, in three families that look nothing alike from here:
  //
  //  - A missing attribute, which reads as null rather than a string.
  //    null.split() would throw out of this IIFE and abort the rest of the
  //    module, taking the footer year down with a typo in the schedule.
  //  - A value Number() cannot read, "2026-08-2O" with a letter O, which makes
  //    Date.UTC return NaN.
  //  - A value that is three numbers but not a day: "2026-13-01" is January 1
  //    2027 to Date.UTC and "2026-02-30" is March 2, neither of them an error.
  //    Rejecting only NaN let those through, and the first pass at #63 shipped
  //    exactly that, putting "Registration opens undefined 1, 2026." beside
  //    the Join button. Reading the three fields back off the result is what
  //    separates a date from a sum that happens to produce one.
  function parseDate(value) {
    var parts = typeof value === 'string' ? ISO_DATE.exec(value) : null;
    if (!parts) {
      return NaN;
    }
    var year = Number(parts[1]);
    var month = Number(parts[2]);
    var day = Number(parts[3]);
    var time = Date.UTC(year, month - 1, day);
    var date = new Date(time);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return NaN;
    }
    return time;
  }

  // Local accessors, not UTC ones. Both sides of every comparison have to be
  // UTC midnight of the same calendar day, and the calendar day that matters
  // is the visitor's. Reading getUTCDate() off a local Date gives the UTC day
  // instead, which rolls over during the evening for everyone west of UTC: a
  // St. Louis visitor at 19:30 on the 12th was being shown the 13th, so the
  // page announced an open registration hours before it opened, and retired a
  // season on its own closing night.
  var now = new Date();
  var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Formats a timestamp parseDate has already vetted, rather than splitting the
  // attribute a second time. It used to take the raw string, which made it a
  // second parser with no guard of its own: statusOf could accept a row whose
  // "2026-13-01" Date.UTC had quietly rolled into 2027, and this would then
  // read MONTHS[12] and render the word "undefined" into the hero.
  function longDate(time) {
    var date = new Date(time);
    return MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate() + ', ' + date.getUTCFullYear();
  }

  // One sentence, two consumers. The callout under the schedule table and the
  // hero note both have to name the running season in the same words, and #51
  // was filed because they had drifted: the callout said what was being played
  // and the hero, three screens above it, did not. Building both from one
  // string is what stops that recurring; a comment asking the next maintainer
  // to keep two copies level is what let it happen the first time.
  function inProgressSentence(name) {
    return name + ' is in progress.';
  }

  // nameSeason names the season the registration belongs to. The hero leaves it
  // off when nothing else in the sentence names a season, because the button
  // beside it already does, and turns it on the moment a running season has put
  // a second name in play and "Registration opens" would be ambiguous.
  function registrationSentence(next, nameSeason) {
    var subject = nameSeason ? next.name + ' registration' : 'Registration';
    return next.isOpen
      ? subject + ' is open now.'
      : subject + ' opens ' + longDate(next.opens) + '.';
  }

  function statusOf(row) {
    var start = parseDate(row.getAttribute('data-start'));
    var end = parseDate(row.getAttribute('data-end'));
    var registration = parseDate(row.getAttribute('data-registration'));

    // parseDate answers NaN for anything that is not a date, and NaN loses
    // every comparison below without erroring: the row reads Upcoming forever,
    // and it wins the nextRegistration selection the moment it is reached,
    // after which no later row can displace it because `start < NaN` is false.
    // The hero then names a season off a row nothing could read. Answering "no
    // status" is the honest reply, and it leaves the row exactly as the page
    // without JavaScript already shows it.
    if (isNaN(start) || isNaN(end) || isNaN(registration)) {
      return null;
    }

    if (today > end) {
      return { label: 'Completed', modifier: 'past' };
    }
    if (today >= start) {
      return { label: 'In progress', modifier: 'current' };
    }
    // The window is 24 hours from the moment it opens, or however long it takes
    // to fill 56 spots, whichever comes first. So a season is joinable on its
    // registration day and not afterwards. Reading this as "open until the
    // season starts" put "Registration open" on the row, and "Join <season>" on
    // the hero, for the month in between: 214 days across the seven seasons the
    // table ships, against seven that are real.
    //
    // Whether capacity was actually reached is not something a static page can
    // know, so Full is the honest-in-practice label rather than a fact derived
    // from the dates. It is right whenever the window closed the usual way.
    if (today > registration) {
      return { label: 'Full', modifier: 'full' };
    }
    if (today === registration) {
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
    if (!status) {
      return;
    }
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
    // registration window has opened. Chosen by comparing start dates rather
    // than by taking the first matching row: nothing forces the tbody to be
    // chronological, and this table is the most frequently edited part of the
    // site, so a maintainer adding the newest season at the top would
    // otherwise point the hero at a season a year out while the table beside
    // it showed one open now.
    if (status.modifier === 'open' || status.modifier === 'upcoming') {
      var start = parseDate(row.getAttribute('data-start'));
      if (!nextRegistration || start < nextRegistration.start) {
        nextRegistration = {
          name: name,
          start: start,
          // The parsed timestamp, not the attribute. Both re-reads here are
          // safe because statusOf returned a status, which it only does when
          // all three of this row's dates parsed.
          opens: parseDate(row.getAttribute('data-registration')),
          isOpen: status.modifier === 'open',
        };
      }
    }
  });

  if (callout) {
    var parts = [];
    if (current) {
      parts.push(inProgressSentence(current));
    }
    // Always named here. This line sits under a table of seasons, where a bare
    // "Registration opens" would not say which row it meant.
    if (nextRegistration) {
      parts.push(registrationSentence(nextRegistration, true));
    }
    if (parts.length > 0) {
      callout.textContent = parts.join(' ');
      callout.hidden = false;
    }
  }

  // The hero CTA sat above all of this reading "Join the League", naming no
  // season and giving no hint that registration might not be open yet, which
  // is item 6 of issue #10. It reads the state the callout already computed
  // rather than carrying a second copy of the season name.
  //
  // #51: it read only nextRegistration, so on 310 of the 342 days on which one
  // of the scheduled seasons was actually being played it named a season the
  // visitor could not join for weeks and said nothing at all about the one on
  // court. Both sentences now, from the same helpers the callout uses.
  var join = document.getElementById('hero-join');
  var note = document.getElementById('hero-note');

  var heroParts = [];
  if (current) {
    heroParts.push(inProgressSentence(current));
  }
  if (nextRegistration) {
    heroParts.push(registrationSentence(nextRegistration, Boolean(current)));
  }

  // note is required, for the same reason the rename below is nested inside
  // it: renaming the button is what creates the obligation to say whether that
  // season can actually be joined, and the note is what discharges it. Naming
  // a season while staying silent about a registration window that may not be
  // open yet is worse than the label it replaced.
  if (note && heroParts.length > 0) {
    note.textContent = heroParts.join(' ');
    note.className = 'hero-note' +
      (nextRegistration && nextRegistration.isOpen ? ' hero-note--open' : '');
    note.hidden = false;
    // nextRegistration, separately: once the last row in the table has
    // finished, a state the schedule reaches on its own if nobody adds a
    // season, there is nothing to name and reading .name off null would throw.
    // "Join the League" is already true in every season, so leaving the label
    // alone is correct, and the note above still reports what is being played.
    if (join && nextRegistration) {
      join.textContent = 'Join ' + nextRegistration.name;
      // The button now names a season but not its availability. Tying the two
      // together means a screen reader reads the date with the button instead
      // of only on the way past it.
      join.setAttribute('aria-describedby', 'hero-note');
    }
  }

  // Shown only when the visitor cannot register today: a season is on court
  // and the next one's window has not opened. That, and not "a season is
  // running", is the rule. With registration open the join button is the
  // stronger action and a second offer beside it only competes with it.
  //
  // Deliberately outside the note branch above. This offer names no season, so
  // it carries none of the obligation the rename does, and a page that had
  // lost only the note should still make it.
  var subCta = document.getElementById('hero-sub');
  if (subCta && current && !(nextRegistration && nextRegistration.isOpen)) {
    subCta.hidden = false;
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
