# SHBS Peer Tutoring

A school peer-tutoring website for student intake, matching, attendance, service hours, interviews and private support. Management changes proposed by coordinators require ADMIN or HEAD approval.

## Find your guide

| I want to… | Read… |
| --- | --- |
| Use the website as a student, tutor, crew member or staff member | [User report and role guide](docs/user-guide.md) |
| Understand the architecture, access rules and verification | [Technical report](docs/technical-report.md) |
| Browse all documentation | [Documentation hub](docs/README.md) |
| Read or publish the current handbooks | [Policy documents](docs/policies/README.md) |
| Run locally | [Local setup and testing](README-LOCAL.md) |
| Prepare a production installation | [Deployment runbook](README-DEPLOY.md) |
| Report a bug, suggest a feature or request a documentation change | [Issue guide](docs/issues.md) |

Printable HTML editions: [user report](docs/reports/user-guide.html) · [technical report](docs/reports/technical-report.html). Download a report and open it in a browser. Markdown above is easier to read directly on GitHub.

## Release status

[PR #9](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/9) merged the reviewed deployment, participant, survey-first and approval work into main. See the [verification record](SHIPPING-READINESS.md) for the tested baseline and launch prerequisites.

No deployment was performed for this release task. Real SMTP delivery, school-approved content and target-host operations must be configured before opening real intake. Repository policy edits do not publish existing database policies.

## Development

Next.js 16, React 19, tRPC 11, Prisma 7/PostgreSQL and Auth.js. Use Node 22 as in CI; follow the [environment setup](README-LOCAL.md) before running commands.

```bash
npm ci
npm run dev
npm run check
npm run docs:check
npm test -- --maxWorkers=1
```

Tests require an explicitly allowed isolated local database and reset their fixtures. The development seed contains synthetic accounts; production uses the seed-free bootstrap. Read [contributor conventions](CLAUDE.md) before changing application behavior.

## Browser tab icon (favicon)

Replace **`src/app/icon.png`** with your logo as an actual PNG image, keeping the
filename. Use a square image (512 × 512 recommended) with a simple design that
remains readable at 16 × 16. Transparency is supported. The current artwork is a
temporary placeholder until a replacement logo is supplied.

Next.js serves this file and generates the browser icon link on every page,
including pages with their own titles. No TypeScript or environment changes are
needed. Keep this as the single icon source; do not add a competing
`public/favicon.ico` or `src/app/favicon.ico`.

Restart the development server after replacing the image. For production, rebuild
and redeploy the app (including rebuilding the Docker image if used). If a browser
still shows the old icon, close and reopen the tab or clear its cached site data.
This controls the browser tab/bookmark icon, not an image inside the page.

With the app running locally, verify the icon and its page metadata with:

```bash
node --test scripts/test-tab-icon.mjs
```

The smoke test defaults to `http://localhost:3000`; set `TEST_BASE_URL` to test a
different local port. It only reads public pages and image assets.
