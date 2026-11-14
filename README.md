# CourseMasters ProjectOS

AniScholar project-delivery workspace built with React, TypeScript and Vite.

## Run locally

Requirements: Node.js 22 or later.

```powershell
npm install
npm run dev
```

Quality checks:

```powershell
npm test
npm run lint
npm run build
```

## Live Google Sheet connection

ProjectOS reads the [AniScholar WRC Live Workplan](https://docs.google.com/spreadsheets/d/1jodhzJhTFvFY_H-SqpjOZiUpgKDU74uvEZJ0PgzNvy8/edit?usp=sharing) directly. It fetches all eight tabs on startup and every 60 seconds; the connection page also has a manual refresh button. No workbook download or upload is required.

The connection is read-only: sheet values are displayed as returned, and ProjectOS does not write changes back. The app does not persist data in browser storage; it holds the latest response in memory until the page closes. Workplan and lesson editing are disabled until shared application storage is configured.

The browser fetch does not use Google sign-in. The sheet must allow viewer access to anyone with its link. Because records are loaded into the browser, anyone who can access a deployed ProjectOS page may be able to read those sheet records; restrict access to the app and sheet appropriately. If the sheet is not publicly readable, use an authenticated server-side integration rather than exposing credentials in the client.

The 36 core micro-lesson rows are still generated placeholders (`CORE-01`–`CORE-36`), not records from the Google Sheet. Their titles and module assignments remain unverified.

The 36 core micro-lesson records are created as `CORE-01`–`CORE-36` placeholders with **Title Pending Verification**. Their module assignment remains blank until confirmed from an approved curriculum. Source dates are treated as proposed dates, not confirmed contractual dates.

## Current operating mode and limitations

This is a functional local preview, not a production deployment. It is a read-only live view and does not provide shared database persistence, Google write-back, authentication, or permission-enforced approvals.

Do not use this local mode for unrestricted client collaboration. Production use still requires a protected deployment, shared database persistence, server-enforced roles, authorized approval and finance actions, and an authenticated integration if the sheet must not be publicly readable. These are not configured in this workspace.

The first slice provides a project overview, live read-only workplan, numbered lesson placeholders, a searchable and filterable Review Center for source deliverables, an LMS activity view derived from the workplan, a planned-date Gantt timeline with a today marker, owner workload and filters, overdue flags (planned finish passed and not complete), shareable per-view URLs (`#workplan`, `#timeline`, …), and live source-tab status. Review feedback and approval actions are not enabled. Gantt editing, multi-user authentication, shared database CRUD, file storage, notifications, reporting exports, and end-to-end authorization are not implemented yet.

## Project baseline

- Project: AniScholar Work Readiness Course and Moodle LMS
- Client: AniScholar Career Hub Ltd
- Service provider: Qraft Academy | CourseMasters
- Proposed dates: 2 November 2026 – 24 January 2027
- Contract value: UGX 25,000,000
- Payment allocation: 20% / 30% / 30% / 20%

Values above are source-brief references. Dashboard progress is calculated only from imported workplan completion percentages using an equal-weight average; it is not inferred from elapsed time.
