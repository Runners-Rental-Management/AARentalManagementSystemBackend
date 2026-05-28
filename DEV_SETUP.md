# Backend dev setup (all actors: tenant, landlord, authority)

Login fails with **Internal server error** when the API cannot reach PostgreSQL.

## 1. Start the API (port 3001)

```powershell
cd AARentalManagementSystemBackend
npm install
npm run start:dev
```

Check: http://127.0.0.1:3001/health — `database` must be `"connected"`.

**Neon users:** The API uses `@prisma/adapter-neon` (WebSocket) when `DATABASE_URL` points to Neon, because direct TCP port 5432 is often blocked on local networks. `npx prisma db push` may still require network access to port 5432; use the Neon SQL editor or a machine with open 5432 if push fails.

## 2. Fix the database

### Option A — Local PostgreSQL (recommended)

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), then:

```powershell
npm run db:up
npm run db:setup:local
```

Add to `.env` (keep other keys):

```env
DATABASE_URL_LOCAL=postgresql://aarental:aarental@127.0.0.1:5433/aarental
```

Restart `npm run start:dev`. The API prefers `DATABASE_URL_LOCAL` over `DATABASE_URL`.

### Option B — Neon (cloud)

1. Open your [Neon](https://neon.tech) project and ensure it is **not paused**.
2. Copy a fresh connection string (`postgresql://...?sslmode=require`).
3. Remove `channel_binding=require` from the URL if present.
4. Update `DATABASE_URL` in `.env`.
5. If the pooler host fails, try direct endpoint: set `NEON_USE_DIRECT=1` in `.env`.
6. Run:

```powershell
npx prisma db push
npm run db:seed
```

## 3. Start frontends

| App | Port | Command |
|-----|------|---------|
| Tenant / landlord | 45000 | `cd AARentalManagementSystemFrontend` → `npm run dev` |
| Authority portal | 46000 | `cd .../authority-portal` → `npm run dev` |

Both use proxy to `http://127.0.0.1:3001` (`BACKEND_PROXY_TARGET` / `VITE_API_BASE_URL`).

## 4. Demo logins (after `npm run db:seed`)

| Role | Email | Password |
|------|-------|----------|
| Authority (all locations) | `admin@aarental.local` | `Passw0rd!234` |
| Authority (Bole) | `admin-bole@aarental.local` | `Passw0rd!234` |
| Landlord | `landlord@aarental.local` | `Passw0rd!234` |
| Tenant | `tenant@aarental.local` | `Passw0rd!234` |
