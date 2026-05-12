param(
  [switch]$InstallOnly,
  [switch]$ForceFrontendInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$backendVenvDir = Join-Path $backendDir ".venv"
$backendPython = Join-Path $backendVenvDir "Scripts\python.exe"
$backendEnvExample = Join-Path $backendDir ".env.example"
$backendEnvFile = Join-Path $backendDir ".env"
$frontendNodeModules = Join-Path $frontendDir "node_modules"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-PythonCommand() {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    return @{ FilePath = "py"; Arguments = @("-3") }
  }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return @{ FilePath = "python"; Arguments = @() }
  }
  throw "Python 3.11+ was not found. Install Python and re-run setup."
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

Write-Step "Checking prerequisites"

$pythonCommand = Find-PythonCommand
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 20+ and re-run setup."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Install Node.js/npm and re-run setup."
}

Write-Host "Python: $($pythonCommand.FilePath) $($pythonCommand.Arguments -join ' ')"
Write-Host "Node:   $(node --version)"
Write-Host "npm:    $(npm.cmd --version)"

if (-not (Test-Path $backendVenvDir)) {
  Write-Step "Creating backend virtual environment"
  Invoke-External -FilePath $pythonCommand.FilePath -Arguments ($pythonCommand.Arguments + @("-m", "venv", ".venv")) -WorkingDirectory $backendDir
} else {
  Write-Step "Backend virtual environment already exists"
}

Write-Step "Installing backend dependencies"
Invoke-External -FilePath $backendPython -Arguments @("-m", "pip", "install", "--upgrade", "pip") -WorkingDirectory $backendDir
Invoke-External -FilePath $backendPython -Arguments @("-m", "pip", "install", "-r", "requirements.txt") -WorkingDirectory $backendDir

if (-not (Test-Path $backendEnvFile) -and (Test-Path $backendEnvExample)) {
  Write-Step "Creating backend .env from .env.example"
  Copy-Item -LiteralPath $backendEnvExample -Destination $backendEnvFile
} else {
  Write-Step "Backend .env already present"
}

Write-Step "Installing frontend dependencies"
if ((Test-Path $frontendNodeModules) -and -not $ForceFrontendInstall) {
  Write-Host "Frontend node_modules already exists. Skipping reinstall."
  Write-Host "Use .\\setup.ps1 -ForceFrontendInstall if you need a clean frontend reinstall."
} else {
  if (Test-Path (Join-Path $frontendDir "package-lock.json")) {
    Invoke-External -FilePath "npm.cmd" -Arguments @("ci") -WorkingDirectory $frontendDir
  } else {
    Invoke-External -FilePath "npm.cmd" -Arguments @("install") -WorkingDirectory $frontendDir
  }
}

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Note: cloudflared was not found in PATH." -ForegroundColor Yellow
  Write-Host "Webhook/tunnel flows will need cloudflared installed locally."
}

Write-Host ""
Write-Host "NubraOSS setup complete." -ForegroundColor Green
Write-Host "Next step: run .\run.ps1 or double-click 'Run NubraOSS.cmd'."
