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

## Backend included

- Organization registration creates the business, initial owner, trial subscription, and audit event in a database transaction.
- Passwords are hashed with bcrypt. Authentication uses random opaque session tokens stored only as HMAC hashes in PostgreSQL and sent in HttpOnly, SameSite cookies.
- Every tenant resource query is scoped by the authenticated organization ID. Role checks are performed by the API; the client-side role display is not an authorization boundary.
- Owners, admins, and managers can create clients/projects/tasks. Only those roles can read all clients/projects; staff task lists are limited to tasks assigned to that user. Task assignees and project links are validated against the active tenant.
- The schema includes organization membership, sessions, clients, projects, tasks, audit events, and subscription-plan foundations.
- Authentication endpoints are rate-limited, request bodies are validated, and cross-origin state-changing requests are rejected.

## API routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET|POST /api/clients`
- `GET|POST /api/projects`
- `GET|POST /api/tasks`

This initial backend does not yet implement email verification, password-reset delivery, staff invitations, object storage/file uploads, chat, campaign persistence, payment processing, or platform super-admin actions. Those features must be connected to actual services before being enabled in production.

## Production

Build the client with `npm run build`, configure `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, and `PORT`, apply the migration with `npm run db:migrate`, then run `npm start`. When `dist/` exists, the API serves the built client as well.
