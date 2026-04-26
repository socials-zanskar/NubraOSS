# NubraOSS

NubraOSS is a Nubra-connected trading workspace built around three main ideas:

- authenticate a user against Nubra REST APIs
- build and backtest rule-based strategies from a visual UI
- support scanner, scalper, and live-strategy workflows from the same app shell

This repository contains the application runtime itself:

- `backend/` is the FastAPI service
- `frontend/` is the React + Vite client
- `supabase/` contains durable schema artifacts used by longer-lived market-data flows

## What This Repo Does

Today, this repo supports:

- Nubra login flow with OTP or TOTP and MPIN verification
- stock search backed by Nubra refdata
- strategy catalog + no-code rule builder
- historical backtesting against Nubra chart data
- live strategy deployment endpoints
- scanner / scalper / volume-breakout related UI and services
- local SQLite-backed caching tables for some app-side runtime data

## High-Level Architecture

### Frontend

The frontend is a React app in `frontend/` that provides:

- authentication screens
- backtest lab / no-code strategy builder
- chart preview
- scanner and scalper panels
- strategy AI assist flow for generating entry/exit JSON with ChatGPT

The main strategy builder lives in:

- [frontend/src/components/StrategyBuilder.tsx](frontend/src/components/StrategyBuilder.tsx)

### Backend

The backend is a FastAPI app in `backend/app/` that exposes:

- auth endpoints
- strategy catalog
- instrument search
- strategy preview
- strategy backtest
- live strategy lifecycle
- tunnel / system helpers

The API boot entry is:

- [backend/app/main.py](backend/app/main.py)

### Data Paths

NubraOSS uses a mix of live API data and local persistence:

- live Nubra REST calls for auth, refdata, and historical chart fetches
- local SQLite for app-owned tables and caches
- optional Supabase configuration for durable market-data use cases

## Auth Flow

The login flow is Nubra-native and happens in stages.

### OTP path

1. start login
2. send OTP through Nubra
3. verify OTP
4. verify MPIN
5. receive session token

Relevant backend methods are in:

- [backend/app/services/auth_service.py](backend/app/services/auth_service.py)

The main Nubra calls used there are:

- `sendphoneotp`
- `verifyphoneotp`
- `verifypin`

### TOTP path

1. start login with TOTP mode
2. verify TOTP
3. verify MPIN
4. receive session token

The backend tracks login flows in memory and enforces factor ordering before MPIN verification.

## Strategy / Backtest Flow

The strategy builder does not generate Python source dynamically.

Instead, the flow is:

1. user builds Entry / Exit rules in the frontend
2. frontend serializes those rules into a JSON strategy payload
3. backend parses that JSON into typed Python condition trees
4. backend fetches historical candles from Nubra
5. backend computes indicator columns
6. backend evaluates the strategy bar by bar
7. backend returns trades, equity curve, warnings, and portfolio metrics

### Frontend serialization

Frontend strategy payload construction happens in:

- [frontend/src/components/StrategyBuilder.tsx](frontend/src/components/StrategyBuilder.tsx)

Key pieces there:

- `buildStrategyPayload()`
- entry and exit condition serialization
- allocation mode serialization

### Backend parsing and execution

Backend parsing and execution happen in:

- [backend/app/services/strategy_backtester.py](backend/app/services/strategy_backtester.py)
- [backend/app/services/strategy_eval.py](backend/app/services/strategy_eval.py)

Important concepts:

- `ParsedStrategy`
- `Condition`
- `ConditionGroup`
- `evaluate_node(...)`
- `run_backtest(...)`

### AI assist flow

The backtest builder now includes an AI assist entry point that:

1. helps the user describe entry / exit logic in plain English
2. prepares a structured prompt for ChatGPT
3. expects strict JSON back
4. imports the JSON directly into the existing Entry / Exit builder
5. provides a repair prompt when pasted JSON is invalid

This is a UI assist layer only. It still feeds the same strategy schema and backtest engine underneath.

## Local Database Behavior

### Does the DB initialize from scratch on a fresh machine?

Yes, the local SQLite database structure auto-initializes.

The local DB path is configured in:

- [backend/app/config.py](backend/app/config.py)

By default it points to:

- `backend/data/nubraoss.sqlite3`

When the app opens a DB connection, it:

1. creates the parent folder if needed
2. opens the SQLite file
3. runs the schema bootstrap with `create table if not exists ...`

That logic lives in:

- [backend/app/db.py](backend/app/db.py)

### Important distinction

The schema auto-creates, but the DB starts empty.

That means:

- the file and tables do not need to be committed to GitHub
- a fresh clone can create its own DB locally
- cached tables will still be empty until populated

### What works from a fresh clone?

These paths are largely self-sufficient as long as Nubra credentials are valid:

- login flow
- stock search
- chart preview
- strategy backtesting

That is because they fetch live data from Nubra REST instead of depending on a preloaded local DB.

### What may still need warmup or external population?

Features that rely on cached / durable tables may need first-time population, such as:

- volume dashboard datasets
- liquidity rank tables
- OHLCV cache tables
- any workflow expecting Supabase-backed durable history

## Environment Variables

The sample env file is:

- [backend/.env.example](backend/.env.example)

Current variables:

```env
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
CLOUDFLARED_PATH=cloudflared
CLOUDFLARE_TUNNEL_TARGET_URL=http://127.0.0.1:8000
SUPABASE_DB_URL=
SUPABASE_DB_HOST=
SUPABASE_DB_PORT=5432
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=postgres
SUPABASE_DB_PASSWORD=
```

Backend defaults also define:

- Nubra PROD base URL
- Nubra UAT base URL
- local SQLite DB path

If you need different values, create:

- `backend/.env`

## Local Setup

### Prerequisites

- Python 3.11+ recommended
- Node.js + npm
- access to Nubra APIs
- valid Nubra login credentials for real auth / backtest usage

### Backend setup

```powershell
cd backend
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

### Frontend setup

```powershell
cd frontend
npm install
npm run dev
```

### One-command local startup

```powershell
.\start-dev.ps1
```

That script launches:

- backend on `http://127.0.0.1:8000`
- frontend dev server on `http://localhost:5173`

See:

- [start-dev.ps1](start-dev.ps1)

## Key API Endpoints

Some useful backend routes:

- `GET /health`
- `GET /api/strategy/catalog`
- `POST /api/strategy/backtest`
- `POST /api/strategy/preview`
- `POST /api/strategy/live/start`
- `GET /api/strategy/live/status`
- `POST /api/strategy/live/stop`
- `POST /api/instruments/stocks/search`
- `GET /api/system/tunnel/status`
- `POST /api/system/tunnel/start`
- `POST /api/system/tunnel/stop`

Defined in:

- [backend/app/main.py](backend/app/main.py)

## Repo Boundaries

NubraOSS is the application/runtime repo.

It should own:

- frontend UI
- backend APIs
- strategy builder and backtester runtime
- local app-side persistence and caches
- session-driven live workflows

It should not be the primary home for:

- TOTP automation scripts
- background data sync jobs
- GitHub Actions market refresh pipelines
- external durable market-data updater infrastructure

Those responsibilities may live in companion repos or operational environments.

## Fresh Clone Expectations

When someone downloads this repo:

### They can expect

- backend and frontend to install locally
- local SQLite DB file to auto-create
- schema to initialize automatically
- source-controlled app code to run without the committed DB file

### They should not assume

- cached local tables are already populated
- Supabase data is already connected
- backtests will work without valid Nubra auth/session data
- every scanner/dashboard module is fully usable without upstream data availability

## Suggested First Run

For a clean first run:

1. create `backend/.env` if you need non-default values
2. install backend dependencies
3. install frontend dependencies
4. start backend and frontend
5. log in with Nubra credentials
6. verify stock search works
7. open Backtest Lab
8. run a simple one-stock strategy first

## Testing / Validation

Backend tests exist under:

- `backend/tests/`

Frontend uses TypeScript build validation.

Useful commands:

```powershell
frontend\node_modules\.bin\tsc.cmd -b frontend\tsconfig.json
```

```powershell
$env:PYTHONPATH='backend'
py -m pytest backend/tests/test_strategy_backend.py
```

## Notes

- Generated local logs, SQLite files, and build artifacts are intentionally not committed.
- The backtest path is strongest when the app has valid Nubra connectivity.
- If a module appears empty on a fresh machine, check whether it depends on cached or external market-data population rather than assuming the app failed to boot.
