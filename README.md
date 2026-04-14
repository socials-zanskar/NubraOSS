# NubraOSS

Greenfield workspace for building a Nubra-native trading dashboard and tooling stack.

## Current scope

First milestone:

- standalone Nubra login flow
- backend auth contract with explicit staged steps
- frontend screen for environment, phone, OTP, and MPIN

This now follows the REST login sequence in `C:\Nubra\Algo\RESTAPI.py`:

1. `sendphoneotp`
2. `verifyphoneotp`
3. `verifypin`

The backend still returns a simplified success payload for app bootstrapping, but the actual Nubra auth calls are now used.

## Data and indicators

Historical data for the No Code Algo module is also fetched directly from Nubra REST APIs.

Current flow:

1. query Nubra historical data over REST
2. normalize the REST response into OHLCV dataframe shape
3. pass the dataframe into `nubra-talib`
4. add indicator columns and evaluate the signal logic on completed candles only

`nubra-sdk` is not required for the current implementation.

## Structure

- `backend/`: FastAPI service for NubraOSS APIs
- `frontend/`: React + Vite app for NubraOSS UI
- `supabase/`: Postgres/Supabase schema for durable market-data storage

## Volume Breakout data boundary

`NubraOSS` is the app/runtime repo.

It should:

- serve backend endpoints
- render the UI
- read durable market data from Supabase
- later host the live websocket overlay for the dashboard session

It should not own:

- TOTP automation
- background sync jobs
- GitHub Actions market-data refresh logic
- Nubra SDK-based updater flows

Those data-population responsibilities live in the separate `nubra-trade-desk` repo.

This repo assumes the external updater keeps Supabase warm with:

- instrument master
- tracked universe members
- 1-minute OHLCV history

## Run

### Backend

```powershell
cd C:\Nubra\NubraOSS\backend
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

### Frontend

```powershell
cd C:\Nubra\NubraOSS\frontend
cmd /c npm install
cmd /c npm run dev
```

### Local one-command startup

```powershell
cd C:\Nubra\NubraOSS
.\start-dev.ps1
```
