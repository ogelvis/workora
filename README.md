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

## What's included

- **Accounts & teams**: registration creates the business, owner, 14-day Starter trial and a `#general` chat channel in one transaction. Owners and admins invite people with single-use links (7-day expiry), change roles, remove members and issue password-reset links (24-hour expiry). Everyone can change their password and sign out other sessions.
- **Work**: projects (with client, status and task progress), tasks (assignee, priority, due date, board and list views, drag-and-drop status), clients, campaigns (budget, platforms, leads, conversions, revenue) and a month-view calendar. Everything can be created, edited and deleted.
- **Collaboration**: company files organised by folder, an owners-and-admins-only Document Vault, team chat channels (refreshed every few seconds), and notifications for task assignment, task completion and new members.
- **Company**: editable company profile, and a billing page showing plan, trial status and usage.
- **Plan limits enforced**: members (including pending invites), projects and storage. Storage is a hard ceiling to the byte: an upload that would go over the plan's limit is refused, concurrent uploads are serialised so they cannot overshoot together, and a workspace over its limit after a downgrade cannot upload until it deletes files or upgrades. An ended trial is shown but does not lock the workspace, because online payments are not connected yet.
- **Security**: bcrypt password hashes, opaque session tokens stored as HMAC hashes in HttpOnly SameSite cookies, organisation-scoped queries everywhere, server-side role checks, rate-limited auth endpoints, validated request bodies and a same-origin check on state-changing requests. Downloads are served as attachments with a sandboxing CSP; only raster images can open inline.

### Not connected yet

- **Email delivery**: invitations and password resets produce links that an owner or admin shares themselves. "Forgot password?" explains this.
- **Payments**: plans can't be purchased or changed in the app.
- **File storage**: files are stored in PostgreSQL, up to 4 MB each, because Vercel functions accept request bodies of up to 4.5 MB. For larger files or heavy use, move storage to an object store such as Vercel Blob or S3.

## Super admin (platform owner)

The owner's control console has its own private sign-in at a secret address. Set these in Vercel's Environment Variables (Production) and redeploy:

- `ADMIN_PATH`: the secret address, for example `MaryNgaji` gives `https://your-domain/MaryNgaji`. 6–64 letters, numbers, `-` or `_`. Without it the console is switched off. The path is checked on the server only and never appears in the public JavaScript.
- `PLATFORM_ADMIN_EMAILS`: comma-separated emails allowed to sign in there. They must also have a normal Workora account.
- `SUPPORT_EMAIL`: where customers' upgrade requests go (shown on the Billing page).

Only sessions started through the secret address get console access, and they last 12 hours. Signing in on the normal page with an owner email opens that person's workspace only. Any other address shows the homepage, and checks of the secret address are rate-limited. The console has an overview (sign-ups, paying workspaces, monthly recurring revenue), workspace search with plan, payment ("paid until"), trial, suspension and deletion controls, user lookup with password-reset links, plan prices and limits, and an audit log of every admin action. Suspended workspaces are locked out until reactivated.

Plan prices live in the database (`subscription_plans`) and appear on the landing page and Billing page. Migration `004_platform_admin_pricing.sql` seeds the suggested launch prices; change them any time under **Super admin → Plans & pricing**.

## Roles

| Role | Can do |
|---|---|
| Owner | Everything, including inviting admins |
| Admin | Team management, billing, Document Vault and all work |
| Manager | Create, assign and edit projects, tasks, clients, campaigns, events and chat channels |
| Staff | Their assigned tasks, files, chat, calendar and notifications |

## API routes

- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`, `GET /api/auth/sessions`, `POST /api/auth/sessions/revoke-others`, `GET /api/auth/invitations/:token`, `POST /api/auth/accept-invite`, `GET /api/auth/password-resets/:token`, `POST /api/auth/reset-password`
- Work: `GET /api/dashboard`; `GET|POST /api/clients`, `PUT|DELETE /api/clients/:id`; `GET|POST /api/projects`, `PUT|DELETE /api/projects/:id`; `GET|POST /api/tasks`, `PUT|PATCH|DELETE /api/tasks/:id`; `GET|POST /api/campaigns`, `PUT|DELETE /api/campaigns/:id`, `PATCH /api/campaigns/:id/status`; `GET|POST /api/calendar`, `PUT|DELETE /api/calendar/:id`
- Notifications: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`
- Team: `GET /api/members`, `PATCH|DELETE /api/members/:userId`, `POST /api/members/:userId/reset-link`, `GET|POST /api/invitations`, `DELETE /api/invitations/:id`, `GET|PUT /api/organization`, `GET /api/billing`
- Public: `GET /api/plans`
- Owner sign-in: `GET /api/auth/gateway/:path`, `POST /api/auth/console-login`
- Super admin (console sessions only): `GET /api/admin/overview`, `GET /api/admin/organizations`, `GET /api/admin/organizations/:id`, `PUT /api/admin/organizations/:id/subscription`, `DELETE /api/admin/organizations/:id`, `GET /api/admin/users`, `POST /api/admin/users/:id/reset-link`, `GET /api/admin/plans`, `PUT /api/admin/plans/:name`, `GET /api/admin/audit`
- Files: `GET|POST /api/files`, `GET /api/files/:id/download`, `DELETE /api/files/:id`
- Chat: `GET|POST /api/channels`, `DELETE /api/channels/:id`, `GET|POST /api/channels/:id/messages`; private direct messages: `GET|POST /api/dms`, `GET|POST /api/dms/:id/messages` (only the two participants can read them)

Remember to run `npm run db:migrate` after pulling these changes; migrations `003`–`006` add the new tables.

## Production

The Vercel project can build the Vite frontend and deploy the Express API function in `api/[...path].js` from the connected Git repository. Set `DATABASE_URL` and `SESSION_SECRET` in the Vercel project's Environment Variables for both Production and Preview. Use the pooled Neon connection URL for `DATABASE_URL`; the Neon integration may also expose an unpooled URL under a different variable name. The application specifically reads `DATABASE_URL`.

Apply database migrations once per database before using a deployment by running `npm run db:migrate` in an environment with that database's `DATABASE_URL`. Vercel does not automatically run this script during a frontend build. The deployment health endpoint is `/api/health`; a successful response includes `"database":"connected"`. Do not expose database connection strings or session secrets in client-side `VITE_*` variables.

For local development, `npm run dev:api` starts the Express listener and `npm run dev` starts Vite. In a conventional non-Vercel Node deployment, configure `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, and `PORT`, run `npm run db:migrate`, build with `npm run build`, and run `npm start`.
