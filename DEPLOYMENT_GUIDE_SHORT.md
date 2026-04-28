# NubraOSS Deployment Guide Short

This is the short version of the deployment guide.

Full version:

- [DEPLOYMENT_GUIDE.md](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/DEPLOYMENT_GUIDE.md)

---

## Recommended Production Shape

Deploy it like this:

1. Build the frontend to static files.
2. Run the backend as one `uvicorn` process.
3. Put both behind one domain and one reverse proxy.
4. Serve frontend at `/`.
5. Proxy `/api`, `/health`, and `/ws` to the backend.
6. Persist `backend/data`.

Recommended topology:

```text
Browser
  -> https://your-domain.com
  -> Nginx/Caddy
      -> frontend/dist at /
      -> backend at /api
      -> backend at /health
      -> backend websockets at /ws
```

---

## Important Things To Know

### 1. Use same-origin hosting

The frontend currently calls:

- `/api/...`
- `/ws/...`

So the easiest and safest deployment is:

- frontend and backend under the same domain

Example:

- `https://your-domain.com/`
- `https://your-domain.com/api/...`
- `wss://your-domain.com/ws/...`

### 2. Run only one backend process

Do not run multiple backend workers right now.

Why:

- several backend services store runtime state in memory
- auth flow state, scanner runtime, webhook config/history, live strategy state,
  and tunnel state are not designed for multi-worker deployment

Safe:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 3. Persist `backend/data`

This folder contains the SQLite DB used for scanner/cache data.

Important file:

- `backend/data/nubraoss.sqlite3`

If you lose this folder, scanner/cache data is lost.

### 4. WebSocket proxy support is required

These features depend on websockets:

- scalper live
- scanner live updates
- live volume quotes

Your reverse proxy must support WebSocket upgrades for `/ws/...`.

### 5. Some state resets on backend restart

Not everything is persisted yet.

Examples that can reset:

- webhook config/history
- live strategy runtime
- tunnel state
- in-progress auth flow state

---

## Minimum Server Setup

Recommended:

- Ubuntu 22.04 or 24.04
- Python 3.12
- Node.js 20+
- Nginx
- 2 vCPU minimum
- 4 GB RAM minimum

---

## Install Commands

## Backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

## Frontend

```bash
cd frontend
npm install
npm run build
```

Frontend build output:

- `frontend/dist`

---

## Backend Run Command

```bash
cd backend
source .venv/bin/activate
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Keep it as one process.

---

## Important Env Values

From:

- [backend/.env.example](/C:/Projects/NubraOSS-harsh/NubraOSS-harsh/backend/.env.example)

Typical production `.env`:

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

Notes:

- Supabase/Postgres is not required for the current SQLite-first deployment.
- `cloudflared` is optional unless you want the in-app tunnel controls.
- for local laptop usage of the repo, install `cloudflared` first if you want the in-app webhook / tunnel flow

---

## Nginx Example

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

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
    }
}
```

---

## systemd Example

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

---

## Quick Deploy Flow

1. Clone repo to server.
2. Set up backend virtualenv and install requirements.
3. Create `backend/.env`.
4. Build frontend with `npm run build`.
5. Run backend through `systemd`.
6. Serve `frontend/dist` with Nginx.
7. Proxy `/api`, `/health`, and `/ws` to backend.
8. Enable HTTPS.
9. Verify `/health`, login, scanner, scalper, and websockets.

---

## Quick Checks After Deploy

Check these:

- `https://your-domain.com/` loads
- `https://your-domain.com/health` returns `{"status":"ok"}`
- login works
- scanner starts and updates
- scalper snapshot loads
- `/ws/scalper` connects
- `/ws/volume-breakout` connects

If live quotes are needed, also verify:

- `/ws/volume-quotes`
- direct websocket/protobuf decoding is working on the server

---

## Biggest Gotchas

Do not forget these:

- same-origin deployment is the safe path
- backend should run as one worker/process
- `backend/data` must persist
- `/ws` proxy must support websocket upgrade
- HTTPS should be enabled

