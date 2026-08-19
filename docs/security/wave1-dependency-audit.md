# Wave 1 Dependency Audit

## Current Re-audit — 2026-08-19

Scope: the current `backend/api` and `frontend` package trees and lockfiles in the
`lawyer-growth` worktree. Reviewed backend runtime: Node `22.18.0` (`>=22.18.0 <23`).

Fresh audit commands were run separately in both package directories:

```bash
npm audit --json
npm audit --audit-level=high --json
```

The backend remediation used a normal exact paired install of the owning AWS SDK packages. No
`npm audit fix`, `--force`, override, or manual transitive pin was used. The backend command now
returns exit `0` at the configured high threshold; the frontend command remains exit `1`.

### Exact Current Results

| Tree | Exact current result | High-threshold result | Release ruling |
|---|---:|---:|---|
| Backend | 0 critical, 0 high, 2 moderate, 0 low | exit 0 | High gate clean; two moderate UUID/Sequelize findings remain tracked |
| Frontend | 31 total: 14 high, 8 moderate, 9 low | exit 1 | Release blocker; Session B owns warning and Router/CRA remediation |

### Backend AWS SDK Remediation

- Exact direct pins moved together from `3.955.0` to
  `@aws-sdk/client-s3@3.1113.0` and `@aws-sdk/s3-request-presigner@3.1113.0`.
- The resolved path is now `@aws-sdk/client-s3@3.1113.0 -> @aws-sdk/core@3.977.8 ->
  @aws-sdk/xml-builder@3.972.39`. The vulnerable `fast-xml-parser` node is absent from the lockfile
  and installed graph; no override is present.
- Both direct packages and the resolved core/XML graph support Node `>=20`; the reviewed Node 22.18.0
  client/presigner smoke passed without a provider request.
- Storage/file/import/cleanup/migration reconciliation coverage passed 18 suites and 276/276 tests.
  A clean `npm ci --ignore-scripts` installed the regenerated lockfile and reported only two moderate
  findings.

### Remaining Backend Findings

- The remaining two moderate findings are the direct `uuid@9.0.1` and
  `sequelize@6.37.8 -> uuid@8.3.2` advisory paths. npm proposes a breaking direct UUID upgrade and an
  invalid Sequelize downgrade, so they remain a separate compatibility track below the configured
  high gate.
- Nodemailer remains `9.0.5`; no Nodemailer advisory is present in the current backend audit.
- Frontend counts are unchanged. Runtime React Router findings and the CRA build/test/development
  graph remain as historically triaged below. The reported complete CRA fix remains breaking/invalid
  (`react-scripts@0.0.0`).

### Current Release Ruling

The backend high-severity audit gate is clean after the paired owning-package update. The frontend
31-finding audit and strict 47-warning build remain release blockers. Their warning cleanup and
Router/CRA dependency migration are deferred to Session B ownership, not accepted or silently
waived. Re-run both JSON audits against the exact release lockfiles after any dependency change.

---

## Historical Audit — 2026-08-15

Date: 2026-08-15
Scope: `backend/api` and `frontend`
Commands: `npm audit --json` and `npm audit fix --dry-run --json` in both package trees.

## Result

| Tree | Before | Safe remediation | After | Dry-run after |
|---|---:|---|---:|---|
| Backend | 3: 1 high, 2 moderate | None compatible | 3: 1 high, 2 moderate | 0 changes |
| Frontend | 36: 1 critical, 18 high, 8 moderate, 9 low | Removed unused `react-pdf` | 31: 14 high, 8 moderate, 9 low | 0 changes |

No `--force` command was run. No blind major upgrade or transitive override was applied.

## Remediation Applied

`react-pdf@7.7.3` was a direct dependency but had no import in `frontend/src`. Its
`pdfjs-dist@3.11.174 -> canvas -> @mapbox/node-pre-gyp -> tar` chain included the PDF.js
runtime code-execution advisory and the only critical audit finding. `npm uninstall react-pdf`
removed eight packages. The actual document preview remains
`frontend/src/pages/Documents/DocumentsPageGlass.js:275-308,824-854`, which downloads an
authorized blob and uses the browser PDF viewer in an `iframe`; it does not execute PDF.js.

The dependency removal is tracked in `frontend/package.json`. npm also updated the workspace's
`frontend/package-lock.json`, but that file is ignored by `.gitignore`; it is local audit evidence,
not a claimed Git diff artifact.

Removed advisories:

- `GHSA-wgrm-67xf-hhpq`, `CVE-2024-4367`, PDF.js arbitrary JavaScript execution. Runtime
  exposure would have existed if the unused library were later imported with default
  `isEvalSupported=true`; patched PDF.js is `4.2.67`, while npm proposed breaking
  `react-pdf@10.4.1`.
- `tar` through the unused canvas install path:
  `GHSA-34x7-hfp2-rc4v`, `GHSA-8qq5-rm4j-mr97`, `GHSA-83g3-92jg-28cx`,
  `GHSA-qffp-2rhf-9h96`, `GHSA-9ppj-qmqm-q256`, `GHSA-r6q2-hw4h-h46w`,
  `GHSA-vmf3-w455-68vh`, `GHSA-w8wr-v893-vjvp`, `GHSA-23hp-3jrh-7fpw`,
  `GHSA-8x88-c5mf-7j5w`, `GHSA-gvwx-54wh-qm9j`, and `GHSA-r292-9mhp-454m`.
  npm audit did not emit CVE IDs for these records. The chain was install/build-time in this
  application and is now absent.

## Backend Findings

### Nodemailer

- Advisory: `GHSA-p6gq-j5cr-w38f`; no known CVE in the advisory.
- Installed/path: direct `nodemailer@8.0.11`; `backend/api/src/services/emailService.js`.
- Exposure: production runtime SMTP. The vulnerable sink requires attacker-controlled
  message-level `raw: {path|href}`. MaslaXat's `sendMail` accepts only `{to, subject, html}` and
  passes exactly `{from, to, subject, html}`. It exposes no `raw`, attachment, path, href, or
  arbitrary Nodemailer options, so the audited exploit path is currently unreachable.
- Fix availability: npm proposes `nodemailer@9.0.5`, a SemVer-major change; the advisory is
  patched from `9.0.1`. This was not treated as a safe nonbreaking update.
- Controls/blocker: retain the strict message-field allowlist; do not add pass-through mail
  options. Upgrade to Nodemailer 9 in a dedicated compatibility change with SMTP/Ethereal tests.

### UUID / Sequelize

- Advisory: `GHSA-w5hq-g745-h8pq`; npm audit emitted no CVE ID.
- Installed/path: direct `uuid@9.0.1`, plus `sequelize@6.37.8 -> uuid@8.3.2`.
- Exposure: runtime, but the defect requires v3/v5/v6 APIs with a caller-provided output buffer.
  Application usage is UUID generation without an external buffer; Sequelize owns its nested copy.
- Fix availability: npm proposes breaking `uuid@14.0.1` and an invalid-for-this-codebase
  Sequelize downgrade/major path. Dry-run changed zero packages.
- Controls/blocker: do not pass caller-controlled buffers to UUID APIs. Resolve with a tested
  Sequelize/direct UUID upgrade track, not an override that leaves Sequelize unverified.

## Frontend Findings After Remediation

### Runtime navigation

- Advisories: `GHSA-wrjc-x8rr-h8h6` (`CVE-2025-68470`),
  `GHSA-337j-9hxr-rhxg`, and `GHSA-jjmj-jmhj-qwj2`.
- Installed/path: direct `react-router-dom@6.30.4 -> react-router@6.30.4`.
- Exposure: browser runtime. The application is a client-rendered CRA SPA, not React Router SSR;
  the SSR hydration constructor-injection path is not used. Redirects introduced by Wave1 validate
  Payme URLs before assigning `window.location`; normal route targets are internal constants.
- Fix availability: the router advisory range extends through `7.17.0`; a fixed line requires a
  React Router 7 migration. No same-major direct remediation is available and dry-run changed zero.
- Controls/blocker: keep external URLs behind explicit origin/protocol validation; do not pass
  untrusted strings to `Link`/`navigate`; plan and test the Router 7 migration separately.

### CRA build, test, and development graph

These packages are reached through `react-scripts@5.0.1` and are not application runtime modules
in the static production bundle unless noted. npm's proposed complete fix is the invalid/breaking
`react-scripts@0.0.0`; dry-run changed zero packages.

- SVG/CSS build processing: `GHSA-rp65-9cf3-cjxr` (`nth-check`),
  `GHSA-2p49-hgcm-8545` (`svgo`), `GHSA-7fh5-64p2-3v2j`,
  `GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-fxqj-rqcc-2cmp`, and
  `GHSA-r28c-9q8g-f849` (`postcss`). Inputs are repository-controlled source assets/CSS; CI must
  not build attacker-provided SVG/CSS. npm audit emitted no CVE IDs for these records.
- Minification/service-worker build: `GHSA-5c6j-r48x-rmvq` and
  `GHSA-qj8w-gfj5-8c6v` (`serialize-javascript`). Build inputs are trusted repository source;
  do not run production builds on unreviewed artifacts. npm audit emitted no CVE IDs.
- Build JSON processing: `GHSA-qpx9-hpmf-5gmw` through
  `react-scripts -> bfj -> jsonpath -> underscore`. It processes build data, not API user input.
- Test-only JSDOM proxy: `GHSA-vpq2-c234-7xj6` through Jest/JSDOM. It is not shipped.
- Development server: `GHSA-9jgg-88mc-972h`, `GHSA-4v9v-hfq4-rm2v`,
  `GHSA-79cf-xcqc-c78w`, `GHSA-mx8g-39q3-5c79`, `GHSA-f5vj-f2hx-8m93`, and
  `GHSA-m28w-2pqf-7qgj`. Never expose CRA's development server publicly; use the static
  production build behind the deployment web server.
- Development `sockjs -> uuid`: `GHSA-w5hq-g745-h8pq`; no external buffer is supplied by
  application code and this graph is not in the production static runtime.

## Nonbreaking Fix Availability

Both post-remediation dry runs report `changed: 0`. npm marks some transitive nodes as
`fixAvailable: true`, but the owning direct dependency graph does not produce a lockfile change.
The remaining direct resolutions require major/toolchain migrations: Nodemailer 9, React Router 7,
and replacement/migration of CRA/react-scripts. Applying isolated transitive overrides would bypass
the owning packages' tested dependency contracts and is not accepted as a safe remediation.

## Required Follow-up

1. Block pilot release on a dedicated Nodemailer 9 compatibility update or an approved risk
   acceptance that preserves the strict message allowlist.
2. Plan React Router 7 and CRA replacement as tested frontend migrations.
3. Keep `npm audit --json` and `npm audit fix --dry-run --json` as CI evidence; never use
   `--force` automatically.
4. Re-run this triage against the exact release lockfiles before staging approval.
