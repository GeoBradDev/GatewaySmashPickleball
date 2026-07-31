# Worklog

A running record of issue work: what changed, how it was verified, where it landed,
and what was deliberately left undone.

## Baseline

Recorded before any changes, against `origin/main` at commit `de38f13`.

- `npm run build` succeeds. Node v24.18.0, npm 11.16.0, webpack 5.109.2.
- `npm audit`: 0 vulnerabilities.
- Build emits 2 warnings, both for `img/android-chrome-512x512.png` at 402 KiB
  exceeding the 244 KiB asset size limit. That is issue #16.
- `dist/` totals 579,809 bytes across 18 files:

| Bytes | File |
|---|---|
| 411246 | img/android-chrome-512x512.png |
| 59259 | img/android-chrome-192x192.png |
| 53255 | img/apple-touch-icon.png |
| 18864 | css/style.css |
| 15406 | img/favicon.ico |
| 10603 | index.html |
| 4029 | icon.png |
| 2472 | img/favicon-32x32.png |
| 1054 | 404.html |
| 1032 | js/app.js |
| 822 | img/favicon-16x16.png |
| 766 | favicon.ico |
| 429 | icon.svg |
| 263 | img/site.webmanifest |
| 231 | site.webmanifest |
| 78 | robots.txt |
| 0 | img/.gitkeep |
| 0 | js/vendor/.gitkeep |

## Batch 1: security and dependencies

### #3 npm vulnerabilities in the webpack toolchain

Already closed before this pass began, by PR #25 (commit `b34eaa2`). Confirmed
rather than redone: `npm audit` and `npm audit --omit=dev` both report 0
vulnerabilities on `origin/main`. No further work needed.

### #4 Add Dependabot

Added `.github/dependabot.yml` with two update streams, both monthly:

- `npm` at `/`, limit 5 open PRs, with `webpack*` and `*-webpack-plugin`
  grouped into a single `webpack` group so a toolchain major arrives as one PR
  instead of five partial ones.
- `github-actions` at `/`, which covers the `actions/checkout` and
  `actions/setup-node` pins in `.github/workflows/ci.yml`.

Monthly rather than weekly matches a site that changes a few times a year.

Verified: `npm run build` and `npm run smoke` both pass unchanged, and the
`dist/` file list and byte counts are byte-identical to the baseline above.
Config-only change with no build surface, so that is the whole verification
that applies. Dependabot itself cannot be exercised until the file is on
`main`, since GitHub reads it from the default branch.

Merge commit: pending
