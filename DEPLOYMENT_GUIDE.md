# NubraOSS Deployment Guide

This document explains what you need to know to deploy the current NubraOSS
codebase to a real server.

It is not only a list of commands. It also covers the architectural details
that matter in production, the current limitations of the codebase, and the
safe deployment shape for this repository as it exists today.

This guide is written against the current repository state in:

- [backend](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend)
- [frontend](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend)

For a broader codebase map, also see:

- [CODEBASE_CONTEXT.md](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/CODEBASE_CONTEXT.md)

---

## 1. Executive Summary

If you only read one section, read this one.

The safest current production deployment for this repo is:

1. Build the frontend as static files.
2. Run the backend as a single `uvicorn` process.
3. Put both behind one reverse proxy and one public domain.
4. Serve the frontend at `/`.
5. Proxy `/api`, `/health`, and `/ws` to the backend.
6. Persist the backend `backend/data` folder so SQLite survives restarts.

Recommended shape:

```text
Browser
  -> https://your-domain.com/
  -> Nginx or Caddy
      -> serves frontend/dist
      -> proxies /api to FastAPI on 127.0.0.1:8000
      -> proxies /health to FastAPI on 127.0.0.1:8000
      -> proxies /ws to FastAPI on 127.0.0.1:8000 with WebSocket upgrade
```

The two most important production constraints are:

- The frontend currently assumes same-origin API and WebSocket access.
- The backend should run as a single worker/process, not multiple workers.

Those two points are explained in detail below.

---

## 2. What This App Actually Is In Production

NubraOSS is not just a static dashboard.

It is a mixed system with:

- a static React frontend
- a stateful FastAPI backend
- live WebSocket features
- background in-process runtimes
- local SQLite persistence
- optional Cloudflare tunnel integration

Important feature groups:

- Auth and session bootstrap
- Volume breakout scanner
- Live scanner quotes
- TradingView webhook receiver/executor
- Scalper snapshot + live candles
- Strategy builder, backtester, and live strategy runner

This means deployment is not the same as deploying a pure frontend app or a
simple stateless REST API.

---

## 3. Current Production Reality Of The Codebase

Before deploying, you should know what the current code does and does not do.

### 3.1 The frontend expects same-origin API routing

This codebase currently uses:

- `fetch('/api/...')`
- WebSockets built from `window.location.host`

Examples:

- [frontend/src/App.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/App.tsx:406)
- [frontend/src/components/VolumeDashboard.tsx](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/components/VolumeDashboard.tsx:11)
- [frontend/src/hooks/useScalperLive.ts](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/hooks/useScalperLive.ts:90)
- [frontend/src/hooks/useVolumeBreakoutWS.ts](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/hooks/useVolumeBreakoutWS.ts:88)
- [frontend/src/hooks/useVolumeQuotesWS.ts](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/src/hooks/useVolumeQuotesWS.ts:25)

What this means:

- The frontend is easiest to deploy behind the same public domain as the backend.
- If you split frontend and backend across different domains, the app will need
  code changes or an env-driven API base URL strategy.

Recommended:

- `https://your-domain.com/` serves the frontend
- `https://your-domain.com/api/...` proxies to backend
- `wss://your-domain.com/ws/...` proxies to backend

### 3.2 The backend is stateful and should run as one worker

A lot of backend services keep state in memory:

- auth flows
- instrument cache
- trading webhook config and history
- strategy live runtime
- scanner runtime
- tunnel process state

These services are class instances held in process memory in files like:

- [auth_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/auth_service.py)
- [volume_breakout_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/volume_breakout_service.py)
- [tradingview_webhook_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/tradingview_webhook_service.py)
- [strategy_live_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/strategy_live_service.py)
- [tunnel_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/tunnel_service.py)

What this means:

- Do not run this backend with multiple independent workers unless you first
  redesign the state model.
- Do not horizontally scale it blindly behind a load balancer.
- A single `uvicorn` worker is the safe deployment mode.

Safe:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Unsafe right now:

- multiple `gunicorn` workers without shared state redesign
- multiple backend replicas behind round-robin load balancing

### 3.3 Some state is persistent, some is not

Persisted locally in SQLite:

- instruments
- dashboard universes
- scanner OHLCV data
- scanner snapshots
- liquidity ranks
- sync runs

Stored only in memory today:

- current auth flow map
- current webhook config/log/history
- current live strategy runtime
- current tunnel runtime state
- some caches and live in-process sessions

What this means:

- Restarting the backend will clear some feature state.
- Scanner cached data survives if `backend/data` is persistent.
- Webhook config/history does not survive a restart in the current code.
- Live strategy runtime does not survive a restart in the current code.

### 3.4 The backend does not currently serve the built frontend

There is a `serve_frontend` setting in config, but in the current codebase
there is no active static-file mount in [backend/app/main.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/main.py).

What this means:

- Build the frontend separately.
- Serve frontend files from Nginx/Caddy or another static host layer.

### 3.5 WebSocket proxy support is mandatory

This app uses:

- `/ws/scalper`
- `/ws/volume-breakout`
- `/ws/volume-quotes`

Your reverse proxy must support WebSocket upgrade headers.

If WebSockets are not proxied correctly:

- scalper will not tick live
- scanner live updates will fail
- volume quotes will not refresh

### 3.6 `cloudflared` is optional, but there is a UI caveat

The app includes tunnel controls for webhook exposure via:

- `/api/system/tunnel/start`
- `/api/system/tunnel/stop`
- `/api/system/tunnel/status`

Implementation:

- [backend/app/services/tunnel_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/tunnel_service.py)

If you deploy on a normal public HTTPS domain, you do not strictly need
`cloudflared` to receive TradingView webhooks.

However, the current webhook status UI builds the displayed webhook URL from
the tunnel service state. That means:

- if you do not run the tunnel, the webhook endpoint still exists
- but the UI may not auto-display your public URL

Actual public webhook path will still be:

```text
https://your-domain.com/api/webhooks/tradingview
```

### 3.7 Live volume quotes use repo-local protobuf decoding

Relevant files:

- [backend/app/main.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/main.py:531)
- [backend/app/services/volume_quote_live_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/volume_quote_live_service.py:43)

What this means:

- The live volume quote and scalper websocket paths no longer depend on `nubra_python_sdk`.
- Protobuf decoding is handled by repo-local message definitions, so there is no
  separate Nubra SDK installation requirement on the server.

### 3.8 Supabase schema exists, but current runtime is SQLite-first

This repo includes:

- [supabase/schema.sql](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/supabase/schema.sql)

And backend config includes Supabase/Postgres env settings:

- [backend/.env.example](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/.env.example)

But the active runtime code in this repo is currently built around SQLite and
local persistence via [backend/app/db.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/db.py).

What this means:

- You do not need Supabase just to deploy the current app.
- You do need writable local storage for the SQLite DB.

---

## 4. Recommended Deployment Topology

### Recommended: one Linux VM or VPS

Recommended stack:

- Ubuntu 22.04 or 24.04
- Python 3.12
- Node.js 20+
- Nginx
- systemd

Topology:

```text
Public Internet
  -> Nginx on 80/443
      -> serves frontend static files from frontend/dist
      -> proxies /api to uvicorn on 127.0.0.1:8000
      -> proxies /health to uvicorn on 127.0.0.1:8000
      -> proxies /ws to uvicorn on 127.0.0.1:8000
  -> FastAPI backend on 127.0.0.1:8000
  -> Local writable storage at backend/data
```

This matches the codebase assumptions with the fewest surprises.

### Acceptable alternatives

- One Docker container for backend + one for Nginx/static frontend
- Caddy instead of Nginx
- Windows Server deployment if you know what you are doing

### Not recommended without code changes

- Frontend hosted on one domain and backend on another
- Multiple backend replicas
- Serverless split deployment for features that depend on long-lived state or
  WebSockets

---

## 5. Server Requirements

Minimum practical server for a low-traffic deployment:

- 2 vCPU
- 4 GB RAM
- 20+ GB disk
- outbound internet access to Nubra APIs and websockets

Recommended:

- 4 vCPU
- 8 GB RAM
- SSD-backed disk

You also need:

- public DNS name
- HTTPS termination
- persistent storage for `backend/data`

---

## 6. Software Requirements

### Backend

- Python 3.12 recommended
- virtualenv support
- `pip`

Dependencies from:

- [backend/requirements.txt](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/requirements.txt)

### Frontend

- Node.js 20+ recommended
- npm

Dependencies from:

- [frontend/package.json](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/frontend/package.json)

### Optional

- `cloudflared` if you want the in-app tunnel controls to work

For local laptop usage of the repo:

- install `cloudflared` if you want the in-app webhook / tunnel controls to work locally

---

## 7. Environment Variables

Current backend example env file:

- [backend/.env.example](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/.env.example)

### Important variables

#### `CORS_ORIGINS`

Default local-dev style value:

```env
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Production note:

- If you deploy same-origin, CORS matters less.
- If you use a different frontend origin, add it here.

Example:

```env
CORS_ORIGINS=https://your-domain.com
```

#### `CLOUDFLARED_PATH`

Path to `cloudflared`.

Example:

```env
CLOUDFLARED_PATH=/usr/local/bin/cloudflared
```

#### `CLOUDFLARE_TUNNEL_TARGET_URL`

The backend URL that `cloudflared` should expose.

Example:

```env
CLOUDFLARE_TUNNEL_TARGET_URL=http://127.0.0.1:8000
```

#### `SUPABASE_DB_*`

Present for future/externalized Postgres use, but not required for the current
SQLite-first deployment path.

### Example production `.env`

Create:

- `backend/.env`

Example:

```env
CORS_ORIGINS=https://your-domain.com
CLOUDFLARED_PATH=/usr/local/bin/cloudflared
CLOUDFLARE_TUNNEL_TARGET_URL=http://127.0.0.1:8000

SUPABASE_DB_URL=
SUPABASE_DB_HOST=
SUPABASE_DB_PORT=5432
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=postgres
SUPABASE_DB_PASSWORD=
```

---

## 8. Persistent Storage Requirements

You must persist:

- `backend/data/`

Why:

- SQLite DB lives there
- scanner snapshots and cached history live there

Do not treat that folder as disposable if you want scanner data continuity.

Recommended:

- keep the entire `backend/data` directory on persistent disk
- back up the SQLite DB file regularly if it matters operationally

Files you care about:

- `backend/data/nubraoss.sqlite3`

---

## 9. Build And Run Commands

## Backend install

From the repo root:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## Backend run

```bash
cd backend
source .venv/bin/activate
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Important:

- keep it to one worker/process

## Frontend install and build

```bash
cd frontend
npm install
npm run build
```

Build output:

- `frontend/dist`

---

## 10. Reverse Proxy Setup

The frontend should be served as static files, and the backend should be
path-proxied under the same public host.

### Nginx example

Below is a deployment example, not something already present in the repo.

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    root /opt/nubraoss/frontend/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

### Why this works with the current frontend

Because the frontend currently uses:

- relative REST calls to `/api/...`
- websocket URLs based on `window.location.host`

So the browser automatically talks back to the same public domain.

---

## 11. Process Supervision

Use a process manager so the backend comes back after restart/crash.

### systemd service example

Create:

- `/etc/systemd/system/nubraoss-backend.service`

Example:

```ini
[Unit]
Description=NubraOSS FastAPI backend
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/opt/nubraoss/backend
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/nubraoss/backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nubraoss-backend
sudo systemctl start nubraoss-backend
sudo systemctl status nubraoss-backend
```

### Important note on worker count

Do not add multiple backend workers here unless you first redesign the in-memory
state model.

---

## 12. Optional Cloudflared Support

If you want the UI button that starts/stops tunnel access to work, install
`cloudflared` on the server and ensure `CLOUDFLARED_PATH` points to it.

Check manually:

```bash
cloudflared --version
```

Current integration lives in:

- [backend/app/services/tunnel_service.py](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/app/services/tunnel_service.py)

If you do not install `cloudflared`:

- the app can still run
- webhook endpoint can still be public if your main site is public
- but in-app tunnel controls will fail

---

## 13. Local protobuf support for live websocket features

The live websocket features now use protobuf definitions shipped inside this
repo.

Current behavior:

- scalper live uses repo-local protobuf decoding
- volume quotes use repo-local protobuf decoding

If you need those features in production:

- verify the backend process can reach Nubra websocket endpoints
- verify protobuf decoding works through the repo-local message definitions

---

## 14. Step-By-Step Linux Deployment

This is the recommended end-to-end deployment path for a single VPS/VM.

### Step 1: Provision the server

Prepare:

- Ubuntu 22.04 or 24.04
- public DNS pointing to the server
- ports 80 and 443 open

Install basics:

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3-pip nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Step 2: Clone the repo

Example:

```bash
sudo mkdir -p /opt/nubraoss
sudo chown $USER:$USER /opt/nubraoss
git clone <your-repo-url> /opt/nubraoss
cd /opt/nubraoss
```

### Step 3: Set up backend

```bash
cd /opt/nubraoss/backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` for production values.

### Step 4: Build frontend

```bash
cd /opt/nubraoss/frontend
npm install
npm run build
```

### Step 5: Create backend service

Use the `systemd` example above.

### Step 6: Configure Nginx

Use the Nginx example above and point `root` to:

- `/opt/nubraoss/frontend/dist`

### Step 7: Enable TLS

Use Certbot or your preferred TLS provisioning method.

Example:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Step 8: Start and verify

```bash
sudo systemctl start nubraoss-backend
sudo systemctl enable nubraoss-backend
sudo nginx -t
sudo systemctl restart nginx
```

### Step 9: Verify health

Check:

```bash
curl http://127.0.0.1:8000/health
curl https://your-domain.com/health
```

Expected:

```json
{"status":"ok"}
```

---

## 15. Production Verification Checklist

After deployment, verify each layer.

### Backend checks

- `/health` returns `{"status":"ok"}`
- backend can reach Nubra PROD/UAT endpoints
- backend logs show clean startup
- `backend/data/nubraoss.sqlite3` exists and is writable

### Frontend checks

- landing page loads over HTTPS
- login flow works
- no console errors for `/api` fetches
- no console errors for websocket connections

### Scanner checks

- `/api/system/market-status` works
- scanner can start
- `/ws/volume-breakout` connects
- live updates arrive

### Scalper checks

- snapshot loads
- `/ws/scalper` connects
- candles update or reconcile properly

### Webhook checks

- webhook configure screen loads
- if using cloudflared, tunnel can start
- test TradingView payload can be sent

### Optional live quote checks

- `/ws/volume-quotes` connects
- selected scanner symbols receive quote updates

---

## 16. Known Production Limitations

These are not necessarily blockers, but they are real.

### 16.1 Multi-worker deployment is not safe by default

As described above, the backend is stateful in memory.

### 16.2 Some feature state is lost on restart

Examples:

- webhook config/history
- live strategy runtime
- tunnel state
- auth in-progress flows

### 16.3 Public webhook URL is tunnel-centric in the UI

If you host publicly without using the internal tunnel flow:

- webhook endpoint still works
- UI may not auto-show your public URL

### 16.4 Frontend/backend split hosting needs code changes

Because API and websocket endpoints are currently same-origin assumptions.

### 16.5 There is no production Docker setup in the repo today

You can create one, but it is not provided in this repository right now.

### 16.6 There is no backend static serving path wired up today

Use Nginx/Caddy/static hosting for the frontend build.

---

## 17. Release Procedure

When updating production, use this order:

1. Pull new code to the server.
2. Reinstall backend dependencies if they changed.
3. Rebuild frontend.
4. Restart backend service.
5. Reload Nginx if config changed.
6. Run verification checks.

Example:

```bash
cd /opt/nubraoss
git pull

cd backend
source .venv/bin/activate
pip install -r requirements.txt

cd ../frontend
npm install
npm run build

sudo systemctl restart nubraoss-backend
sudo systemctl reload nginx
```

Because some in-memory runtime state is reset on restart, plan production
restarts carefully if you are actively using:

- live strategies
- webhook execution state
- tunnel sessions

---

## 18. Rollback Strategy

Keep a rollback path simple.

Recommended:

- deploy from versioned Git commits/tags
- keep previous frontend build until new one is verified
- do not delete `backend/data`

Simple rollback:

1. checkout previous known-good commit
2. rebuild frontend
3. restart backend

Note:

- restarting backend still clears in-memory runtime state

---

## 19. Security Notes

### HTTPS

Use HTTPS in production. This app uses auth/session tokens and live trading
actions, so plain HTTP is not acceptable on a public deployment.

### Backend binding

Bind the backend to:

- `127.0.0.1:8000`

and expose it through Nginx/Caddy rather than directly.

### Firewall

Expose:

- `80`
- `443`

Do not expose:

- backend raw port `8000` publicly unless you have a specific reason

### Secrets

Do not commit:

- real `.env`
- webhook secrets
- broker/session tokens

### CORS

If you deploy same-origin, keep CORS tight. Do not leave permissive origins you
do not need.

---

## 20. Troubleshooting

### Frontend loads but API calls fail

Check:

- Nginx `/api` proxy
- backend process running
- browser network tab
- CORS if using separate origins

### Frontend loads but live features do not work

Check:

- `/ws` proxy upgrade headers
- proxy timeouts
- browser console websocket errors
- backend websocket logs

### Scanner works but quotes do not

Check:

- outbound websocket access to Nubra
- `/ws/volume-quotes`
- backend startup/import logs

### Scalper snapshot works but live candles freeze

Check:

- `/ws/scalper` connectivity
- backend outbound access to Nubra websocket
- reverse proxy websocket handling

### Webhook page works but URL is blank

Likely cause:

- you are not using the internal tunnel flow

Remember:

- your actual public webhook path is still likely
  `https://your-domain.com/api/webhooks/tradingview`

### Data disappears after restart

Likely cause:

- feature state was in memory only

Persistent:

- SQLite scanner/cache data

Not persistent today:

- webhook config/history
- live strategy runtime
- tunnel state

---

## 21. If You Want To Improve Deployability Later

These are the most valuable future changes if you want easier production
deployment.

### High-value improvements

1. Add env-driven frontend API and WS base URLs.
2. Persist webhook config/history to SQLite or Postgres.
3. Persist live strategy job definitions.
4. Add first-class Docker and docker-compose setup.
5. Add backend static frontend serving or a documented built-in production mode.
6. Replace in-memory shared state with durable/shared state where appropriate.
7. Add a configured public base URL env var so webhook UI can display a public
   URL without requiring `cloudflared`.
8. Add production readiness docs for Linux and Docker as part of the repo.

### Most important architectural improvement

If you only do one deployability improvement, do this:

- move critical runtime/config state out of in-memory singleton services and
  into durable storage

That one change unlocks safer restarts, safer scaling, and cleaner ops.

---

## 22. Quick Deployment Cheat Sheet

### Recommended production pattern

- frontend static build
- backend single uvicorn process
- Nginx same-origin reverse proxy
- persistent `backend/data`
- HTTPS

### Commands

Backend:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run build
```

### Proxy paths

- `/` -> `frontend/dist`
- `/api` -> backend
- `/health` -> backend
- `/ws` -> backend with websocket upgrade

### Do not forget

- same-origin deployment
- single backend worker
- persistent `backend/data`
- websocket proxy support
- HTTPS

