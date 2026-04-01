# Bill Ledger - Nuxt + Node Setup

## Stack
- Frontend: Nuxt 3 (`/frontend`)
- Backend API: Node.js + Express (`/server`)
- Database: SQLite (`bills.db` in repo root)

The Node server uses the same `bills.db` file so your existing data carries over.

## Prerequisites
- Node.js 20+
- npm

## One-Time Setup
From the repo root:

1) Install backend dependencies
- `cd server`
- `npm install`

2) Install frontend dependencies
- `cd ../frontend`
- `npm install`

## Run the app
### Option A (recommended): two terminals
Terminal 1:
- `cd server`
- `npm run dev`

Terminal 2:
- `cd frontend`
- `npm run dev`

Nuxt runs on `http://localhost:3000`.
Node API runs on `http://127.0.0.1:3001`.

### Option B: helper scripts
- macOS/Linux: `./start_mac_linux.sh`
- Windows: `Start Bill Ledger (Windows).bat`

## API base URL
Frontend defaults to:
- `http://127.0.0.1:3001`

Override with:
- `NUXT_PUBLIC_API_BASE`

Example:
- `NUXT_PUBLIC_API_BASE=http://localhost:3001 npm run dev`

## Database recommendation (best practice)
- **Best for this local single-user app:** SQLite (already in use), because it is simple, reliable, and requires no server management.
- **Best for multi-user / production deployment:** PostgreSQL, typically with Prisma or Drizzle ORM, migrations, and managed backups.
