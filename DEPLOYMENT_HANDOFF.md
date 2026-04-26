# NubraOSS Deployment Handoff

This document is for the person or team receiving this codebase for deployment.

It is intentionally **not** a step-by-step deployment tutorial.
It is a handoff brief that explains:

- what this system is
- how it works
- what runs at runtime
- what tech stack it uses
- what infra characteristics it expects
- what deployment-sensitive constraints exist in the current codebase

If someone already knows how to deploy software but needs to understand **what
they are deploying**, this is the correct document to send.

Related docs:

- [CODEBASE_CONTEXT.md](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/CODEBASE_CONTEXT.md)
- [DEPLOYMENT_GUIDE.md](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/DEPLOYMENT_GUIDE.md)
- [DEPLOYMENT_GUIDE_SHORT.md](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/DEPLOYMENT_GUIDE_SHORT.md)

---

## 1. What This Codebase Is

NubraOSS is a **Nubra-connected trading workstation** with both UI and backend
runtime logic.

It is not just:

- a static frontend
- a stateless REST API
- a simple webhook endpoint

It is a mixed application made of:

- a React single-page frontend
- a FastAPI backend
- long-lived WebSocket features
- in-process runtime jobs
- local persistent data/cache storage
- integrations with Nubra REST and live websocket feeds

The app currently exposes these main product areas:

- Auth / login bootstrap using Nubra phone OTP + MPIN
- Dashboard / home screen
- Scanner / Volume Breakout dashboard
- TradingView webhook setup and order execution
- Scalper snapshot and live charting
- No-code strategy builder, preview, backtesting, and live strategy execution
- Optional Cloudflare tunnel control for webhook exposure

---

## 2. High-Level Runtime Architecture

At runtime the system is best understood as four parts:

### 1. Frontend SPA

Location:

- `frontend/src/*`

Purpose:

- renders the UI
- manages browser session state
- calls backend REST APIs
- opens backend WebSocket connections

Build artifact:

- static frontend files in `frontend/dist`

### 2. Backend API + realtime server

Location:

- `backend/app/*`

Purpose:

- authenticates users against Nubra
- serves REST APIs to the frontend
- exposes WebSocket endpoints to the frontend
- talks to Nubra REST and live feeds
- runs background feature runtimes
- manages local persistence for scanner/cache data

Primary entrypoint:

- [backend/app/main.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/main.py)

### 3. Local persistent storage

Location:

- `backend/data/nubraoss.sqlite3`

Purpose:

- local cache and persistence layer for scanner-related market data
- universe membership
- 1-minute OHLCV bars
- snapshots and sync metadata

### 4. External dependencies

The app depends on external systems for meaningful runtime behavior:

- Nubra REST APIs
- Nubra live websocket feeds
- optional `cloudflared`
- optional `nubra_python_sdk` protobuf availability for live quote streaming

---

## 3. Core Tech Stack

### Frontend

- React 19
- TypeScript
- Vite
- lightweight-charts

Main files:

- [frontend/src/main.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/main.tsx)
- [frontend/src/App.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/App.tsx)
- [frontend/src/components/VolumeDashboard.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/components/VolumeDashboard.tsx)
- [frontend/src/components/ScalperLiveChart.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/components/ScalperLiveChart.tsx)

### Backend

- Python 3.12 style codebase
- FastAPI
- Uvicorn
- Pydantic / pydantic-settings
- httpx
- pandas
- protobuf
- psycopg available in dependencies
- nubra-talib for indicator/backtest calculations

Main files:

- [backend/app/main.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/main.py)
- [backend/app/config.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/config.py)
- [backend/app/db.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/db.py)
- [backend/app/services/*](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services)

### Data / storage

- SQLite is the current active local runtime persistence layer
- Supabase/Postgres schema exists in the repo, but the active runtime path in
  this codebase is still SQLite-first

Schema file present:

- [supabase/schema.sql](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/supabase/schema.sql)

---

## 4. How The System Works

## 4.1 Frontend to backend relationship

The frontend is not currently configured like a separate API client with an
env-driven external base URL.

Current behavior:

- many frontend API calls use relative paths like `/api/...`
- WebSocket URLs are built from `window.location.host`

Implication:

- the current frontend expects the backend to appear under the same public host
- the clean runtime model is one public domain with path-based proxying

This is an important deployment characteristic, not just a code detail.

## 4.2 Backend route model

The backend exposes three kinds of interfaces:

- stateless REST endpoints
- stateful REST endpoints
- WebSocket endpoints

Main route groups:

- `/health`
- `/api/system/*`
- `/api/auth/*`
- `/api/instruments/*`
- `/api/webhooks/tradingview/*`
- `/api/strategy/*`
- `/api/scalper/*`
- `/api/volume-breakout/*`
- `/ws/scalper`
- `/ws/volume-breakout`
- `/ws/volume-quotes`

## 4.3 Feature runtimes are not fully stateless

Several important features are implemented as **in-memory singleton services**
inside the backend process.

Examples:

- auth flow state
- instrument cache
- trading webhook config/history/logs
- scanner runtime
- strategy live runtime
- tunnel process state

This matters operationally because the backend process is not a purely
interchangeable stateless worker.

## 4.4 Local data model

The backend uses SQLite for the currently active local data/cache layer.

Key stored entities:

- instruments
- dashboard universes
- dashboard universe members
- stock taxonomy
- stock liquidity ranks
- 1-minute OHLCV bars
- sync runs
- volume dashboard snapshots

Core implementation:

- [backend/app/db.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/db.py)

---

## 5. Feature Breakdown

## 5.1 Auth

Purpose:

- authenticate against Nubra using phone OTP and MPIN
- establish a usable session for the app

Backend:

- [backend/app/services/auth_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/auth_service.py)

Frontend:

- [frontend/src/App.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/App.tsx)

How it works:

1. frontend sends phone number to backend
2. backend calls Nubra `sendphoneotp`
3. frontend sends OTP to backend
4. backend calls Nubra `verifyphoneotp`
5. frontend sends MPIN to backend
6. backend calls Nubra `verifypin`
7. backend returns session data used by the UI

Operational note:

- auth flow state is partly in memory during the multi-step login process

## 5.2 Scanner / Volume Breakout

Purpose:

- build a market scanner focused on volume breakout style ranking
- display leaders, movers, summaries, and sector views

Backend core:

- [backend/app/services/volume_breakout_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/volume_breakout_service.py)

Frontend core:

- [frontend/src/components/VolumeDashboard.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/components/VolumeDashboard.tsx)

Realtime support:

- `/ws/volume-breakout`
- `/ws/volume-quotes`

What it does:

- selects a stock universe
- builds or refreshes local history cache
- computes volume-breakout rows
- pushes scanner events to clients
- optionally overlays live quotes for currently watched symbols

Operational note:

- scanner runtime is long-lived and stateful inside the backend process
- scanner data also uses local SQLite persistence

## 5.3 Scalper

Purpose:

- show underlying + CE + PE option context
- provide snapshot and live charting
- support scalper-side tools such as delta-neutral pairs and expiry heatmaps
- place option orders

Backend snapshot logic:

- [backend/app/services/scalper_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/scalper_service.py)

Backend live logic:

- [backend/app/services/scalper_live_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/scalper_live_service.py)

Frontend live logic:

- [frontend/src/hooks/useScalperLive.ts](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/hooks/useScalperLive.ts)
- [frontend/src/components/ScalperLiveChart.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/components/ScalperLiveChart.tsx)

How it works:

1. frontend requests a scalper snapshot
2. backend resolves instrument metadata and historical data
3. frontend renders 3 panels
4. frontend opens `/ws/scalper`
5. backend streams candle updates and reconcile/fallback-driven corrections

Operational note:

- live scalper depends on backend outbound websocket access to Nubra

## 5.4 TradingView webhook

Purpose:

- provide a webhook endpoint for TradingView alerts
- allow order execution through inbound alert payloads
- track logs/history/order state in the UI

Backend:

- [backend/app/services/tradingview_webhook_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/tradingview_webhook_service.py)

Frontend:

- webhook screen inside [frontend/src/App.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/App.tsx)

How it works:

1. user configures webhook settings
2. backend stores config in memory
3. external alerts post into `/api/webhooks/tradingview`
4. backend validates payload and optionally places orders
5. UI renders logs, history, positions, and PnL summaries

Operational note:

- webhook config/history are currently in-memory state, not durable state
- restart behavior should be understood before operational use

## 5.5 Strategy builder / backtester / live strategy

Purpose:

- let users build rules visually
- preview data
- backtest strategies
- optionally run a live in-process strategy runtime

Backend files:

- [strategy_catalog.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/strategy_catalog.py)
- [strategy_data.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/strategy_data.py)
- [strategy_eval.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/strategy_eval.py)
- [strategy_backtester.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/strategy_backtester.py)
- [strategy_live_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/strategy_live_service.py)

Frontend:

- [frontend/src/components/StrategyBuilder.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/components/StrategyBuilder.tsx)

Operational note:

- live strategy execution is an in-process background runtime, not an external
  job runner or queue-backed worker system

---

## 6. Primary Runtime Files The Deployer Should Know

These are the most important files for understanding the deployed shape.

### Backend

- [backend/app/main.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/main.py)
  What it is:
  FastAPI app entrypoint and route wiring.

- [backend/app/config.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/config.py)
  What it is:
  runtime settings and env-driven config.

- [backend/app/db.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/db.py)
  What it is:
  SQLite schema and data access helpers.

- [backend/app/services](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services)
  What it is:
  almost all feature logic.

### Frontend

- [frontend/src/App.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/App.tsx)
  What it is:
  the main UI shell and feature orchestrator.

- [frontend/src/components/VolumeDashboard.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/components/VolumeDashboard.tsx)
  What it is:
  the scanner feature UI.

- [frontend/src/hooks/useScalperLive.ts](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/hooks/useScalperLive.ts)
  What it is:
  the main frontend client for live scalper updates.

---

## 7. Infrastructure Expectations

This codebase implies certain infra characteristics even before anyone chooses
exact deployment tooling.

## 7.1 One public host is the natural shape

Because the frontend assumes same-origin access for API and WebSocket routes,
the natural infra shape is:

- one public domain
- frontend served at `/`
- backend reachable under `/api`, `/health`, and `/ws`

The deployer can implement that with Nginx, Caddy, Traefik, or another proxy,
but the **shape** matters more than the product used.

## 7.2 Reverse proxy must support WebSockets

Required live routes:

- `/ws/scalper`
- `/ws/volume-breakout`
- `/ws/volume-quotes`

Any deployed shape that cannot pass websocket upgrades correctly will break
major parts of the app.

## 7.3 The backend should be treated as a single active process

Current state model strongly suggests:

- one backend process
- one worker
- supervised restart model

This is because multiple feature services hold memory-local state.

## 7.4 Persistent writable local disk is required

The current runtime is not read-only.

It needs writable local storage for:

- SQLite DB
- cached market data
- snapshots

The key path is:

- `backend/data/`

## 7.5 Outbound internet access is required

The backend must be able to reach Nubra external endpoints for:

- auth
- instruments
- historical data
- live data
- current prices
- order actions

## 7.6 TLS is effectively required

Because this app handles:

- session tokens
- user auth flow
- trading-related actions
- webhook traffic

The intended deployed shape should be HTTPS/WSS.

---

## 8. Stateful vs Durable Behavior

This is one of the most important sections for ops.

## Durable today

These are persisted in local SQLite:

- instrument records
- universe membership
- stock taxonomy
- liquidity ranks
- 1-minute OHLCV bars
- scanner snapshots
- sync metadata

## In-memory today

These are primarily process-local runtime state:

- multi-step auth flow map
- webhook config
- webhook history/logs
- strategy live runtime
- tunnel process state
- some feature caches and currently running singleton runtimes

Implication:

- a backend restart is not transparent
- some features resume from persisted data, others reset to default state

The deployer should understand this before choosing restart policy,
high-availability shape, or scaling model.

---

## 9. External Dependencies And Optional Components

## Required external dependency

### Nubra APIs and live feeds

The app meaningfully depends on Nubra services.

Without those, many major features are non-functional.

Examples:

- auth
- refdata
- history
- order placement
- live scalper feed

## Optional but supported

### `cloudflared`

Used by the tunnel service:

- [backend/app/services/tunnel_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/tunnel_service.py)

It is optional from a system architecture perspective.

If the app is deployed on a public domain, the webhook endpoint can still
exist without using the internal tunnel feature.

### `nubra_python_sdk`

Particularly relevant for:

- live volume quotes

If unavailable, that feature degrades, while the rest of the app can still run.

---

## 10. Environment / Config Surface

Primary backend config file:

- [backend/app/config.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/config.py)

Example env file:

- [backend/.env.example](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/.env.example)

Important config categories:

- CORS
- Nubra PROD/UAT base URLs
- cloudflared path and target URL
- SQLite path
- optional Supabase/Postgres connection details

Operationally important point:

- Supabase config exists, but the active local runtime path is still SQLite-led
  in this codebase

---

## 11. Repo Artifacts That Matter To Infra

### Backend entrypoint

- `backend/app/main.py`

### Frontend build output source

- `frontend/`

### Frontend build artifact location

- `frontend/dist`

### Local database / persistent state path

- `backend/data/nubraoss.sqlite3`

### Process launcher convenience script

- `start-dev.ps1`

Useful for local development understanding, but not a required production
artifact.

---

## 12. Things The Deployer Must Know Before Choosing A Deployment Pattern

These are the practical design facts that should influence infra decisions.

### 1. This is not ready-made for horizontal scaling

Not because scaling is impossible in theory, but because current runtime state
is tied to the backend process.

### 2. This is not a frontend-only deployment

The frontend is just one part. Most real behavior depends on the backend.

### 3. This is not a fully stateless API

There is persistent storage plus process-local runtime state.

### 4. This is not currently packaged with opinionated infra manifests

There is no built-in Docker stack or orchestrator definition in the repo today.

### 5. Static frontend + proxied backend is the natural runtime split

That is what the current source code most directly expects.

---

## 13. Suggested Questions For Whoever Deploys It

Before deploying, the receiver should answer these:

1. Will frontend and backend be hosted under the same public domain?
2. What will provide WebSocket-capable reverse proxying?
3. Where will `backend/data` live so it persists across restarts?
4. Will the backend be run as one supervised process?
5. Does the environment have outbound access to Nubra REST and websocket endpoints?
6. Is `cloudflared` needed, or is the app already on a public HTTPS domain?
7. Is `nubra_python_sdk` needed for the live quote feature in this environment?
8. Is restart-driven loss of in-memory feature state acceptable?

Those questions matter more than the exact choice of VPS, container, or
orchestrator.

---

## 14. Short Operational Summary

If someone asks “what are we deploying?” the shortest accurate answer is:

NubraOSS is a React + FastAPI trading workstation that depends on Nubra APIs
and live feeds, uses WebSockets for realtime features, stores scanner/cache
data in local SQLite, keeps several feature runtimes in backend process memory,
and is best deployed as a same-origin frontend + single-process backend system
behind a WebSocket-capable reverse proxy with persistent local storage.

