$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$backendPath = Join-Path $repoRoot "backend"
$frontendPath = Join-Path $repoRoot "frontend"

Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location `"$backendPath`"; py -m uvicorn app.main:app --port 8000"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location `"$frontendPath`"; npm.cmd install; npm.cmd run dev"

Write-Host "Backend and frontend startup launched."
