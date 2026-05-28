# Starts API on port 3001. Run frontends separately (45000, 46000).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot + "\.."

Write-Host "Checking API health..."
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:3001/health" -TimeoutSec 3
  if ($h.database -eq "connected") {
    Write-Host "API already running with database connected."
    exit 0
  }
} catch {
  # not running
}

Write-Host "Starting Nest API (PORT=3001)..."
$env:PORT = "3001"
npm run start:dev
