param(
  [switch]$NoOpen,
  [switch]$SkipSetup
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$backendLog = Join-Path $backendDir "backend.launch.log"
$backendErrLog = Join-Path $backendDir "backend.launch.err.log"
$frontendLog = Join-Path $frontendDir "frontend.launch.log"
$frontendErrLog = Join-Path $frontendDir "frontend.launch.err.log"
$frontendUrl = "http://127.0.0.1:5173"
$backendHealthUrl = "http://127.0.0.1:8000/health"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-UrlReady([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-UrlReady([string]$Url, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-UrlReady $Url) {
      return $true
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

if (-not $SkipSetup) {
  Write-Step "Running setup"
  & (Join-Path $repoRoot "setup.ps1") -InstallOnly
  if ($LASTEXITCODE -ne 0) {
    throw "Setup failed."
  }
}

if (-not (Test-Path $backendPython)) {
  throw "Backend virtual environment is missing. Run .\setup.ps1 first."
}

$backendReady = Test-UrlReady $backendHealthUrl
$frontendReady = Test-UrlReady $frontendUrl

if (-not $backendReady) {
  Write-Step "Starting backend on 127.0.0.1:8000"
  $backendCommand = "Set-Location '$backendDir'; & '$backendPython' -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $backendLog `
    -RedirectStandardError $backendErrLog | Out-Null
} else {
  Write-Step "Backend already running"
}

if (-not $frontendReady) {
  Write-Step "Starting frontend on 127.0.0.1:5173"
  $frontendCommand = "Set-Location '$frontendDir'; npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort"
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $frontendLog `
    -RedirectStandardError $frontendErrLog | Out-Null
} else {
  Write-Step "Frontend already running"
}

Write-Step "Waiting for services"
$backendReady = Wait-UrlReady $backendHealthUrl 60
$frontendReady = Wait-UrlReady $frontendUrl 60

if (-not $backendReady) {
  throw "Backend did not become ready. Check $backendErrLog"
}
if (-not $frontendReady) {
  throw "Frontend did not become ready. Check $frontendErrLog"
}

Write-Host ""
Write-Host "NubraOSS is running." -ForegroundColor Green
Write-Host "Frontend: $frontendUrl"
Write-Host "Backend:  $backendHealthUrl"

if (-not $NoOpen) {
  Start-Process $frontendUrl | Out-Null
}
