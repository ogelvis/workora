# Workora

Workora is a multi-tenant business workspace with a React/Vite client and an Express API backed by Neon PostgreSQL.

## Configure Neon

1. In Neon, create a database and copy its connection string with SSL enabled.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to that Neon connection string and replace `SESSION_SECRET` with a random value of at least 32 characters. Keep `.env` private and never commit it.

Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` and use that value for `SESSION_SECRET`.

PowerShell:

```powershell
Copy-Item .env.example .env
```

## Run locally

```powershell
npm install
npm run db:migrate
```

Start the API and client in separate terminals:

```powershell
npm run dev:api
npm run dev
```

Vite proxies `/api` requests to the API at `http://localhost:3001`. The API health check is available at `/api/health`.

To use the local app, run `npm run dev:api` as well as `npm run dev`; the local API requires `DATABASE_URL` and `SESSION_SECRET` in an ignored `.env` file. Vercel's project environment variables are only injected into Vercel deployments, not into local Vite.

## Backend included

- Organization registration creates the business, initial owner, trial subscription, and audit event in a database transaction.
- Passwords are hashed with bcrypt. Authentication uses random opaque session tokens stored only as HMAC hashes in PostgreSQL and sent in HttpOnly, SameSite cookies.
- Every tenant resource query is scoped by the authenticated organization ID. Role checks are performed by the API; the client-side role display is not an authorization boundary.
- Owners, admins, and managers can create clients, projects, tasks, campaigns, and calendar events. Only those roles can read all clients/projects/campaigns; staff task lists and notifications are limited to that user. Task assignees and project/client links are validated against the active tenant.
- Members can update the status of their assigned tasks; managers can update any task in their organization. Campaign status is manager-controlled. Notification reads are scoped to the current member.
- The schema includes organization membership, sessions, clients, projects, tasks, campaigns, calendar events, per-member notifications, audit events, and subscription-plan foundations.
- Authentication endpoints are rate-limited, request bodies are validated, and cross-origin state-changing requests are rejected.
- SQL migrations are applied once and recorded in `schema_migrations`; the migration runner applies numbered migration files in order.

## API routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET|POST /api/clients`
- `GET|POST /api/projects`
- `GET|POST /api/tasks`
- `PATCH /api/tasks/:taskId`
- `GET|POST /api/campaigns`
- `PATCH /api/campaigns/:campaignId/status`
- `GET|POST /api/calendar`
- `GET /api/notifications`
- `PATCH /api/notifications/:notificationId/read`

The workspace UI now persists campaigns, calendar events, task status changes, and per-user notification reads through these API routes. The following are still not implemented: email verification/password-reset delivery, member invitations and team chat, object storage/file uploads and the document vault, payment processing, and platform super-admin actions. Configure and test the Neon database before relying on these migrations or API routes in production. External email, storage, and payment features need real providers before they can be enabled.

## Production

The Vercel project can build the Vite frontend and deploy the Express API function in `api/[...path].js` from the connected Git repository. Set `DATABASE_URL` and `SESSION_SECRET` in the Vercel project's Environment Variables for both Production and Preview. Use the pooled Neon connection URL for `DATABASE_URL`; the Neon integration may also expose an unpooled URL under a different variable name. The application specifically reads `DATABASE_URL`.

Apply database migrations once per database before using a deployment by running `npm run db:migrate` in an environment with that database's `DATABASE_URL`. Vercel does not automatically run this script during a frontend build. The deployment health endpoint is `/api/health`; a successful response includes `"database":"connected"`. Do not expose database connection strings or session secrets in client-side `VITE_*` variables.

For local development, `npm run dev:api` starts the Express listener and `npm run dev` starts Vite. In a conventional non-Vercel Node deployment, configure `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, and `PORT`, run `npm run db:migrate`, build with `npm run build`, and run `npm start`.
