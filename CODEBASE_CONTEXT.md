# NubraOSS Codebase Context

This file is a working map of the current NubraOSS repository.

It is meant to answer three questions:

1. What does each important file do?
2. How do the main features fit together?
3. Where should I edit when I want to change a specific behavior?

This document focuses on source files and meaningful runtime/config files.
It intentionally skips generated or low-signal artifacts like `node_modules`,
`dist`, `__pycache__`, `*.tsbuildinfo`, and SQLite WAL/SHM sidecars.

---

## 1. Repo At A Glance

Top-level layout:

```text
NubraOSS-harsh/
  backend/      FastAPI API server and feature services
  frontend/     React + Vite single-page app
  data/         Seed/static data used by the app
  supabase/     Postgres schema for durable market-data storage
  start-dev.ps1 Convenience launcher for backend + frontend
  README.md     High-level project overview
```

Main product surfaces currently present in the repo:

- Auth / Nubra session bootstrap
- Dashboard / home screen
- Scanner / Volume Breakout dashboard
- TradingView webhook setup + execution
- Scalper snapshot + live charts + scalper tools
- No-code strategy builder / backtester / live strategy runner
- Tunnel management for webhook exposure

High-level architecture:

- The backend is relatively well-separated: `main.py` wires routes, and
  `backend/app/services/*` contains almost all business logic.
- The frontend is more centralized: `frontend/src/App.tsx` owns a very large
  amount of top-level product state and screen rendering.
- The scanner is the most self-contained frontend feature and mainly lives in
  `frontend/src/components/VolumeDashboard.tsx`.

---

## 2. Source Of Truth By Runtime Layer

### Backend source of truth

- Route wiring: `backend/app/main.py`
- Settings and environment: `backend/app/config.py`
- Local SQLite cache/store: `backend/app/db.py`
- API contracts: `backend/app/schemas.py`
- Real business logic: `backend/app/services/*`

### Frontend source of truth

- App bootstrap: `frontend/src/main.tsx`
- Global shell and navigation: `frontend/src/App.tsx`
- Scanner UI: `frontend/src/components/VolumeDashboard.tsx`
- Scalper chart rendering: `frontend/src/components/ScalperLiveChart.tsx`
- Live scalper websocket client: `frontend/src/hooks/useScalperLive.ts`
- Scanner websocket clients: `frontend/src/hooks/useVolumeBreakoutWS.ts`,
  `frontend/src/hooks/useVolumeQuotesWS.ts`

---

## 3. Top-Level Files

### `README.md`

Project overview, intended scope, and run instructions.

Useful when:

- you want the intended product boundaries
- you want to know what belongs in this repo vs external updater jobs

### `start-dev.ps1`

Starts both runtime processes in separate PowerShell windows:

- backend: `python -m uvicorn app.main:app --port 8000`
- frontend: `npm.cmd install` then `npm.cmd run dev`

Useful when:

- you want local one-command startup

### `data/universes/nifty300_symbols.csv`

Static seed list used by the scanner/volume dashboard universe logic.

Useful when:

- you want to change the curated stock universe

### `supabase/schema.sql`

Postgres/Supabase schema for durable market-data storage:

- instruments
- stock taxonomy
- universes and universe members
- 1-minute OHLCV bars
- sync run tracking

Useful when:

- you want to understand the durable market-data model
- you are integrating a real Supabase/Postgres backend

### `.gitignore`

Ignore rules only.

---

## 4. Backend Folder Map

## `backend/requirements.txt`

Python dependency list.

Key packages:

- `fastapi`, `uvicorn` for the API server
- `httpx` for Nubra REST calls
- `pandas` for history and analytics
- `nubra-talib` for indicator/backtest computation
- `protobuf` for live websocket decoding
- `psycopg` for Postgres/Supabase access

## `backend/.env.example`

Sample env values for backend configuration.

## `backend/data/nubraoss.sqlite3`

Local SQLite runtime DB used by the app for:

- instrument cache
- universes
- local 1-minute bar storage
- scanner snapshots
- sync runs

## `backend/backend.log`, `backend/backend.err.log`

Runtime logs from local backend runs.

Useful when:

- tracing websocket failures
- debugging live-feed or startup issues

---

## 5. Backend Core Files

### `backend/app/config.py`

Centralized settings loader using `pydantic-settings`.

Responsibilities:

- app name
- CORS origins
- frontend dev origin
- Nubra PROD/UAT base URLs
- cloudflared binary and target URL
- SQLite DB path
- Supabase/Postgres connection settings

Edit here when:

- backend URL or env configuration changes
- CORS needs to change
- you switch DB/tunnel settings

### `backend/app/db.py`

SQLite schema + persistence helpers.

What it owns:

- schema creation for all local cache tables
- DB connection bootstrap
- upsert/load helpers for instruments, universes, bars, ranks, snapshots
- pruning old OHLCV bars
- sync run recording

Important concept:

- This file is the local cache/storage layer for the scanner and related
  market-data features.

Edit here when:

- you add a new cached entity
- snapshot persistence shape changes
- scanner storage logic changes

### `backend/app/schemas.py`

All backend Pydantic request/response contracts.

Main schema groups:

- Auth
- Tunnel/system
- TradingView webhook
- Scalper snapshot/order/tools
- Strategy preview/backtest/live
- Volume breakout scanner
- Market status

Edit here when:

- an API payload changes
- frontend/backend contract must be updated safely

### `backend/app/main.py`

FastAPI entrypoint.

This file mainly does:

- create the `FastAPI` app
- apply CORS middleware
- expose REST routes
- expose websocket routes
- convert raw service outputs into response models

Current route groups:

- `/health`
- `/api/system/public-ip`
- `/api/system/tunnel/*`
- `/api/system/market-status`
- `/api/auth/*`
- `/api/instruments/stocks/search`
- `/api/webhooks/tradingview/*`
- `/api/strategy/*`
- `/api/scalper/*`
- `/api/volume-breakout/*`
- `/ws/scalper`
- `/ws/volume-breakout`
- `/ws/volume-quotes`

Edit here when:

- you need to add a new route
- a route shape changes
- websocket init/close behavior changes

Do not start here for feature logic unless the issue is specifically route
parsing, response wiring, or websocket lifecycle handling.

---

## 6. Backend Services By File

### `backend/app/services/auth_service.py`

Implements Nubra auth flow.

Main jobs:

- send phone OTP
- verify phone OTP
- verify MPIN
- decode token expiry
- resolve client code/account data from Nubra endpoints
- warm instrument cache after login
- check whether a session is still active

If auth breaks, this is the first file to inspect.

### `backend/app/services/instrument_service.py`

Instrument metadata fetch and cache service.

Main jobs:

- fetch exchange refdata from Nubra
- cache instrument rows in memory by session token
- stock search for strategy builder and other UIs
- list cash stocks
- resolve stock metadata like `ref_id`, `tick_size`, `lot_size`

If something fails to resolve a symbol or `ref_id`, check here first.

### `backend/app/services/market_history_service.py`

Historical candle fetch + normalization service.

Main jobs:

- call Nubra `charts/timeseries`
- normalize response into pandas OHLCV frames
- convert cumulative volume into bucket volume
- convert history into DB rows for local persistence

This is the shared historical-data path used by multiple features.

### `backend/app/services/tunnel_service.py`

Manages the `cloudflared` process.

Main jobs:

- check cloudflared availability
- start/stop the process
- capture logs
- extract the assigned public URL

Used by the webhook setup flow.

### `backend/app/services/tradingview_webhook_service.py`

Owns TradingView webhook state and execution behavior.

Main jobs:

- save webhook config for the current session
- generate strategy/line-alert templates
- expose status and logs
- maintain execution enabled/disabled state
- validate incoming webhook payloads
- resolve instruments and place orders
- maintain event history, order history, positions, PnL summaries

If webhook config, order execution, or webhook history looks wrong, inspect here.

### `backend/app/services/scalper_service.py`

Primary REST-side scalper engine.

Main jobs:

- normalize underlying and expiry values
- resolve CE/PE contracts
- fetch underlying and option history
- build the three chart panels returned by `/api/scalper/snapshot`
- place scalper orders
- build delta-neutral pair output
- build expiry heatmap output

This is the main non-live scalper logic file.

### `backend/app/services/scalper_live_service.py`

Primary live scalper websocket engine.

Main jobs:

- seed live session from `scalper_service.snapshot`
- subscribe to Nubra live websocket streams
- decode protobuf payloads
- map live ticks to underlying / CE / PE panels
- aggregate ticks into current candles
- periodically reconcile from REST
- run stale-feed fallback polling

If the scalper chart is freezing, not ticking, or reconciling badly, this is
the first backend file to inspect.

### `backend/app/services/scalper_volume_breakout_service.py`

A scalper-side breakout finder for options/underlyings.

Main jobs:

- fetch history for a specific scalper context
- compute baseline volume metrics
- rank breakout rows
- cache last-good results and baseline stats

This is separate from the main scanner dashboard service.

### `backend/app/services/volume_breakout_service.py`

Main scanner engine for the dashboard.

Main jobs:

- choose and build the scanning universe
- bootstrap top lists / all-NSE path
- sync history into local DB
- compute liquidity ranks
- load and update scanner snapshots
- compute market breakout rows, movers, sector heatmap inputs
- publish scanner events to websocket clients
- serve drilldown and market-status data

If the scanner output is wrong, stale, or empty, this is the key backend file.

### `backend/app/services/volume_quote_live_service.py`

Live quote overlay for selected scanner symbols.

Main jobs:

- open a Nubra live orderbook websocket
- subscribe only to current tracked symbols
- emit snapshots and live quote updates
- restart feed when selected symbols change

Used by the scanner UI to keep rows fresh without rescanning everything.

### `backend/app/services/strategy_catalog.py`

Defines the no-code strategy-building catalog.

Main jobs:

- indicator specs
- operator specs
- operand compatibility rules
- catalog payload returned to frontend

If you want to add or remove a strategy-builder indicator, start here.

### `backend/app/services/strategy_data.py`

Data preparation and indicator computation layer for strategy features.

Main jobs:

- normalize user timestamp inputs
- estimate warmup bars
- fetch preview/backtest/live data
- compute indicator columns via `nubra-talib`
- infer instrument context

This is the data/indicator bridge used by both preview and backtesting.

### `backend/app/services/strategy_eval.py`

Condition parser and evaluator.

Main jobs:

- parse leaf conditions
- parse nested condition groups
- validate RHS compatibility
- evaluate conditions and groups over pandas rows

If strategy logic is evaluating incorrectly, inspect this file.

### `backend/app/services/strategy_backtester.py`

Backtest engine.

Main jobs:

- parse incoming strategy payload
- run per-instrument backtests
- handle exits, stop/target conflict rules, position sizing
- compute trades, equity curves, metrics, and logs

If backtest results are numerically wrong, inspect here.

### `backend/app/services/strategy_live_service.py`

Live strategy runner.

Main jobs:

- start/stop live runtime
- compute next evaluation times on IST boundaries
- fetch current data
- evaluate conditions
- place orders
- track live alerts and open positions

This is the live counterpart to the backtester.

### `backend/app/services/nubra_ws_proto.py`

Fallback protobuf message definitions for decoding Nubra batch websocket
payloads when the external SDK package is not available.

### `backend/app/services/nubra_order_updates.py`

Dynamic protobuf descriptors and decoder for Nubra OMS/order-update messages.

This is specialized infrastructure code used for parsing broker order updates.

### `backend/app/services/__init__.py`

Package marker only.

---

## 7. Backend Tests

### `backend/tests/test_auth_service.py`

Covers:

- MPIN verification client-code path
- active session client-code resolution

### `backend/tests/test_strategy_backend.py`

Covers:

- indicator-column uniqueness
- stop/target conflict resolution
- grouped exit conditions
- live strategy quantity sizing
- live delivery-type behavior

This is currently the most meaningful backend test file.

---

## 8. Frontend Folder Map

## `frontend/package.json`

Frontend package config.

Key dependencies:

- `react`
- `react-dom`
- `lightweight-charts`
- `vite`
- `typescript`

## `frontend/vite.config.ts`

Local dev proxy config.

Important behavior:

- `/api` proxied to backend `http://127.0.0.1:8000`
- `/health` proxied to backend
- `/ws` proxied to backend websocket server

If local API or websocket calls fail in dev, inspect this file.

## `frontend/index.html`

Vite host page only.

## `frontend/frontend.log`, `frontend/frontend.err.log`

Local frontend run logs.

---

## 9. Frontend Core Files

### `frontend/src/main.tsx`

React bootstrap:

- mounts `<App />`
- imports global styles

### `frontend/src/App.tsx`

This is the main frontend shell and the single most important frontend file.

What it currently owns:

- signed-out landing page
- login flow UI
- session persistence in local storage
- top navigation and post-login layout
- dashboard screen
- scalper screen
- webhook screen
- no-code strategy screen
- tunnel/public-IP polling
- many feature-specific local states
- many direct REST fetch calls

Important note:

- This file is large and acts as the frontend orchestration layer.
- When UI behavior changes do not seem to take effect, there is a good chance
  the relevant state or handler is here.

Edit here when:

- adding a new top-level screen
- changing auth/session behavior
- changing navigation/header/dashboard composition
- changing scalper/webhook page-level behavior

### `frontend/src/styles.css`

Global app styling.

What it covers:

- theme tokens
- landing page
- auth screens
- dashboard and shared shell styles
- top-level layout and generic components

Edit here when:

- changing overall app look and theme behavior
- changing dashboard or landing visuals

### `frontend/src/scalper.css`

Scalper-specific layout and styling.

What it covers:

- scalper page containers
- toolbar layout
- screener / terminal styling
- scalper cards and controls

Edit here when:

- scalper page layout looks wrong
- scalper surface styling must change

### `frontend/src/volume-dashboard.css`

Scanner-specific styling.

What it covers:

- scanner cards
- leaders / movers sections
- heatmaps
- tables
- progress strips
- scanner drilldowns

Edit here when:

- scanner layout or styling changes

### `frontend/src/vite-env.d.ts`

Vite TypeScript env typing only.

---

## 10. Frontend Components By File

### `frontend/src/components/VolumeDashboard.tsx`

Main scanner UI and scanner-side orchestration.

What it does:

- starts the scanner via REST
- connects to scanner websocket streams
- merges scanner snapshots and live quotes
- renders leaders, movers, sector heatmap, drilldowns, and summary cards
- owns scanner-specific formatting and helper logic

This file is effectively its own feature app inside the frontend.

### `frontend/src/components/ScalperLiveChart.tsx`

Reusable chart component for the scalper.

What it does:

- creates `lightweight-charts` instances
- draws candles and histogram volume
- applies theme colors
- overlays custom indicator lines and markers

### `frontend/src/components/StrategyBuilder.tsx`

No-code strategy authoring UI.

What it does:

- renders indicator/operator builders
- lets users compose conditions/groups
- searches instruments
- previews chart data
- starts backtests and live strategy runs

### `frontend/src/components/StrategyPreviewChart.tsx`

Chart used by strategy preview/backtest experiences.

### `frontend/src/components/IndicatorBuilder.tsx`

Client-side custom indicator builder for the scalper.

What it does:

- create indicator configs
- choose signal rules
- save/update/delete indicator presets
- feed overlays/signals into scalper charts

### `frontend/src/components/AutomatePanel.tsx`

Automation control panel for scalper auto-trading.

What it does:

- toggle automation
- choose panel and direction
- configure lots and max trade cap
- show trade log and current automation state

### `frontend/src/components/PostLoginFooter.tsx`

Small shared footer for signed-in sections.

### `frontend/src/components/panels/ScannerPanel.tsx`

Older or alternate scanner panel structure.

Current note:

- Based on the current app imports, the primary scanner experience is
  `VolumeDashboard.tsx`, not this file.

### `frontend/src/components/panels/ChartDrilldownPanel.tsx`

Standalone drilldown chart panel for a selected symbol.

### `frontend/src/components/panels/DebugPanel.tsx`

Collapsible debug log display.

### Shared display components

#### `frontend/src/components/shared/ChartHeader.tsx`

Header row for chart metadata and values.

#### `frontend/src/components/shared/ChartStatsTable.tsx`

Stats table below charts.

#### `frontend/src/components/shared/ConfidenceBadge.tsx`

Small badge component for confidence/status style displays.

#### `frontend/src/components/shared/PriceCell.tsx`

Reusable price cell renderer.

#### `frontend/src/components/shared/ScannerTable.tsx`

Reusable table for scanner-style rows.

#### `frontend/src/components/shared/Sparkline.tsx`

Sparkline chart renderer.

#### `frontend/src/components/shared/VolumeRatioBar.tsx`

Small visual bar for volume-ratio displays.

---

## 11. Frontend Hooks

### `frontend/src/hooks/useScalperLive.ts`

Frontend websocket client for `/ws/scalper`.

Main jobs:

- open websocket
- send init payload
- receive `init`, `status`, `candle_update`, and reconcile-like events
- keep local live candle arrays
- seed chart series when panels mount
- reconnect when necessary

If the frontend side of scalper live updates looks wrong, inspect here first.

### `frontend/src/hooks/useVolumeBreakoutWS.ts`

Frontend websocket client for `/ws/volume-breakout`.

Main jobs:

- connect scanner websocket
- send scan init params
- receive scan updates and gap-fill progress
- maintain websocket state and debug logs

### `frontend/src/hooks/useVolumeQuotesWS.ts`

Frontend websocket client for `/ws/volume-quotes`.

Main jobs:

- connect quote websocket
- subscribe to current symbol list
- merge snapshots and per-symbol updates

### `frontend/src/hooks/useAutomation.ts`

Client-side auto-trading decision engine.

Main jobs:

- watch latest computed signals
- dedupe by candle time
- choose BUY/SELL actions
- place scalper orders via backend
- maintain in-memory position/trade-count/log state

### `frontend/src/hooks/useIndicators.ts`

Client-side indicator math + storage hook.

Main jobs:

- manage saved indicators in local storage
- compute overlays/signals from raw candles
- expose presets and compute helpers

---

## 12. Frontend Types And Contexts

### `frontend/src/types/indicators.ts`

Core TS model for:

- indicator definitions
- overlay definitions
- signal points
- OHLCV candle shape
- indicator presets

This is the shared type foundation for `useIndicators`, `IndicatorBuilder`,
`ScalperLiveChart`, and automation.

### `frontend/src/contexts/OrderContext.tsx`

Context for order-panel UI state.

### `frontend/src/contexts/PositionsContext.tsx`

Context for positions state.

### `frontend/src/contexts/ScannerContext.tsx`

Context for scanner data, filters, and selected symbol.

### `frontend/src/contexts/UIContext.tsx`

Context for generic UI state like current view/sidebar/theme.

Important note:

- Based on the current app imports and the current top-level render path,
  these contexts appear to be support code or an older architectural direction.
- The active app shell is currently driven directly by `App.tsx`, not by these
  providers.

That means:

- If you edit one of these contexts and nothing changes in the actual app,
  that is expected unless a component explicitly uses that context.

---

## 13. Assets

### `frontend/src/assets/nubra.png`

Main Nubra brand image used in the app shell/landing.

### `frontend/src/assets/nubra-logo.png`

Additional logo asset.

---

## 14. Main Runtime Flows

### Auth flow

Backend path:

- `main.py` routes call `auth_service.py`

Frontend path:

- `App.tsx` signed-out states and login steps

Flow:

1. phone submitted
2. OTP requested
3. OTP verified
4. MPIN verified
5. session stored in local storage
6. frontend moves into dashboard state

### Dashboard/system flow

Backend path:

- `main.py`
- `tunnel_service.py`
- `volume_breakout_service.py` for market status

Frontend path:

- `App.tsx`
- `styles.css`

Flow:

- dashboard polls public IP
- dashboard polls tunnel status
- dashboard polls market status
- dashboard routes users into Scanner/Webhook/Scalper/No-Code

### Scanner / Volume Breakout flow

Backend path:

- `volume_breakout_service.py`
- `volume_quote_live_service.py`
- local SQLite via `db.py`

Frontend path:

- `VolumeDashboard.tsx`
- `useVolumeBreakoutWS.ts`
- `useVolumeQuotesWS.ts`
- `volume-dashboard.css`

Flow:

1. scanner start request sent
2. backend starts or resumes runtime
3. websocket sends snapshot and progress updates
4. scanner UI renders market leaders/movers/heatmaps
5. quote websocket keeps displayed symbols fresh

### Scalper flow

Backend path:

- `scalper_service.py`
- `scalper_live_service.py`
- `instrument_service.py`
- `market_history_service.py`

Frontend path:

- `App.tsx`
- `useScalperLive.ts`
- `ScalperLiveChart.tsx`
- `IndicatorBuilder.tsx`
- `useIndicators.ts`
- `AutomatePanel.tsx`
- `useAutomation.ts`
- `scalper.css`

Flow:

1. frontend requests snapshot
2. backend resolves option pair and history
3. frontend displays 3 panels: underlying, CE, PE
4. live websocket updates current candles
5. optional indicators and automation act on those candles

### TradingView webhook flow

Backend path:

- `tradingview_webhook_service.py`
- `tunnel_service.py`

Frontend path:

- `App.tsx`

Flow:

1. user configures webhook session/secret
2. tunnel optionally generates a public URL
3. frontend shows webhook templates
4. TradingView or test payload posts into backend
5. backend validates, logs, and optionally places orders

### Strategy builder / backtester flow

Backend path:

- `strategy_catalog.py`
- `strategy_data.py`
- `strategy_eval.py`
- `strategy_backtester.py`
- `strategy_live_service.py`

Frontend path:

- `StrategyBuilder.tsx`
- `StrategyPreviewChart.tsx`

Flow:

1. frontend fetches strategy catalog
2. user builds conditions/groups
3. preview or backtest request sent
4. backend fetches data, computes indicators, evaluates rules
5. frontend renders result charts, trades, and metrics

---

## 15. Where To Edit What

### Change login or session behavior

Edit:

- `backend/app/services/auth_service.py`
- `backend/app/schemas.py`
- `frontend/src/App.tsx`

### Change scanner ranking, filtering, or universe logic

Edit:

- `backend/app/services/volume_breakout_service.py`
- `backend/app/db.py`
- `data/universes/nifty300_symbols.csv`

### Change scanner UI or layout

Edit:

- `frontend/src/components/VolumeDashboard.tsx`
- `frontend/src/volume-dashboard.css`

### Change live scanner quote behavior

Edit:

- `backend/app/services/volume_quote_live_service.py`
- `frontend/src/hooks/useVolumeQuotesWS.ts`

### Change scalper snapshot logic

Edit:

- `backend/app/services/scalper_service.py`

### Change scalper live websocket/tick behavior

Edit:

- `backend/app/services/scalper_live_service.py`
- `frontend/src/hooks/useScalperLive.ts`
- `frontend/src/components/ScalperLiveChart.tsx`

### Change scalper page UI

Edit:

- `frontend/src/App.tsx`
- `frontend/src/scalper.css`

### Change indicator builder or client-side indicator math

Edit:

- `frontend/src/components/IndicatorBuilder.tsx`
- `frontend/src/hooks/useIndicators.ts`
- `frontend/src/types/indicators.ts`

### Change automation behavior

Edit:

- `frontend/src/hooks/useAutomation.ts`
- `frontend/src/components/AutomatePanel.tsx`
- `backend/app/services/scalper_service.py` if order payload/placement changes

### Change TradingView webhook behavior

Edit:

- `backend/app/services/tradingview_webhook_service.py`
- `frontend/src/App.tsx`

### Change no-code strategy logic

Edit:

- `backend/app/services/strategy_catalog.py`
- `backend/app/services/strategy_data.py`
- `backend/app/services/strategy_eval.py`
- `backend/app/services/strategy_backtester.py`
- `frontend/src/components/StrategyBuilder.tsx`

---

## 16. High-Risk / High-Value Files

These are the files where a small change can have a large effect:

- `frontend/src/App.tsx`
- `frontend/src/components/VolumeDashboard.tsx`
- `backend/app/main.py`
- `backend/app/services/scalper_service.py`
- `backend/app/services/scalper_live_service.py`
- `backend/app/services/volume_breakout_service.py`
- `backend/app/services/tradingview_webhook_service.py`
- `backend/app/services/strategy_backtester.py`

If you edit one of these, validate carefully.

---

## 17. Current Architectural Notes

### Frontend is centralized

`App.tsx` is currently a monolithic orchestration file.

Implication:

- Page-level state and handlers are easy to find in one place.
- Large changes can become risky because many concerns are coupled.

### Backend is service-driven

The backend structure is healthier than the frontend structure.

Implication:

- For backend bugs, start in `backend/app/services/*` before touching `main.py`.

### Some frontend support code appears secondary

The `contexts/*` files and some panel components exist, but the active app path
is primarily driven by `App.tsx` plus direct feature components.

Implication:

- Before editing a context, verify the feature actually consumes it.

### Scanner is split cleanly from scalper

Even though both deal with market data, the scanner and scalper are separate
feature stacks with separate backend services and separate frontend UI layers.

Implication:

- A scanner bug is usually not in the scalper files, and vice versa.

---

## 18. Suggested Reading Order For A New Contributor

If you want to understand the repo with minimum confusion, read in this order:

1. `README.md`
2. `backend/app/main.py`
3. `backend/app/schemas.py`
4. `backend/app/services/auth_service.py`
5. `backend/app/services/scalper_service.py`
6. `backend/app/services/scalper_live_service.py`
7. `backend/app/services/volume_breakout_service.py`
8. `backend/app/services/tradingview_webhook_service.py`
9. `frontend/src/App.tsx`
10. `frontend/src/components/VolumeDashboard.tsx`
11. `frontend/src/hooks/useScalperLive.ts`
12. `frontend/src/components/ScalperLiveChart.tsx`
13. `frontend/src/components/StrategyBuilder.tsx`
14. `frontend/src/styles.css`
15. `frontend/src/scalper.css`
16. `frontend/src/volume-dashboard.css`

---

## 19. Quick Summary

If you only remember a few things, remember these:

- Backend routes are in `backend/app/main.py`, but the real feature logic is in
  `backend/app/services/*`.
- Frontend top-level behavior is mostly in `frontend/src/App.tsx`.
- Scanner lives mainly in `VolumeDashboard.tsx` plus `volume_breakout_service.py`.
- Scalper lives mainly in `scalper_service.py`, `scalper_live_service.py`,
  `useScalperLive.ts`, and `ScalperLiveChart.tsx`.
- TradingView webhook behavior is mostly in `tradingview_webhook_service.py`.
- Strategy builder/backtester logic is spread across the `strategy_*` backend
  files plus `StrategyBuilder.tsx`.

