$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd `"$repoRoot\backend`"; .\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd `"$repoRoot\frontend`"; npm run dev -- --host 127.0.0.1"

Write-Host "Backend and frontend dev servers launched."
