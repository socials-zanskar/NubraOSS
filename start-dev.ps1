$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPort = 8001
$frontendPort = 5173

function Stop-PortListener {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($processId in $listeners) {
        try {
            Stop-Process -Id $processId -Force -ErrorAction Stop
        } catch {
            Write-Host "Skipping PID $processId on port ${Port}: $($_.Exception.Message)"
        }
    }
}

function Wait-ForBackend {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSeconds = 25
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 700
        }
    }

    return $false
}

Stop-PortListener -Port $backendPort
Stop-PortListener -Port $frontendPort

Start-Process -FilePath "$repoRoot\backend\.venv\Scripts\python.exe" `
    -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$backendPort" `
    -WorkingDirectory "$repoRoot\backend"

if (-not (Wait-ForBackend -Url "http://127.0.0.1:$backendPort/health")) {
    throw "Backend did not become healthy on port $backendPort."
}

$frontendWorkdir = Join-Path $repoRoot 'frontend'
$frontendCommand = "Set-Location -LiteralPath '$frontendWorkdir'; cmd /c npm run dev -- --host 127.0.0.1 --port $frontendPort"
$frontendArgs = '-NoExit', '-Command', $frontendCommand
Start-Process powershell -ArgumentList $frontendArgs

Write-Host "NubraOSS dev servers launched."
Write-Host "Frontend: http://127.0.0.1:$frontendPort"
Write-Host "Backend:  http://127.0.0.1:$backendPort/health"
