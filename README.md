# NubraOSS

Greenfield workspace for building a Nubra-native trading dashboard and tooling stack.

## Current scope

First milestone:

- standalone Nubra login flow
- backend auth contract with explicit staged steps
- frontend screen for environment, phone, device ID, OTP, and MPIN

This now follows the REST login sequence in `C:\Nubra\Algo\RESTAPI.py`:

1. `sendphoneotp`
2. `sendphoneotp` again with `skip_totp=True`
3. `verifyphoneotp`
4. `verifypin`

The backend still returns a simplified success payload for app bootstrapping, but the actual Nubra auth calls are now used.

## Structure

- `backend/`: FastAPI service for NubraOSS APIs
- `frontend/`: React + Vite app for NubraOSS UI

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
