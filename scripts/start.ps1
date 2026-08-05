param(
  [int]$Port = 3456,
  [switch]$NoOpen,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$HubUrl = "http://localhost:$Port"

function Write-Step($Message) {
  Write-Host "[MoeReview] $Message" -ForegroundColor Cyan
}

function Write-Ok($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Test-PortInUse($Port) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $connections
  } catch {
    return $false
  }
}

function Ensure-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required but was not found in PATH."
  }
}

function Ensure-Dependencies($ProjectPath, $Label) {
  $nodeModules = Join-Path $ProjectPath "node_modules"
  if (Test-Path $nodeModules) {
    Write-Ok "$Label dependencies found"
    return
  }

  Write-Step "Installing $Label dependencies"
  Push-Location $ProjectPath
  try {
    npm install
  } finally {
    Pop-Location
  }
}

Write-Step "Starting MoeReview"
Write-Host "Root: $Root"
Write-Host "Hub:  $HubUrl"
Write-Host ""

Ensure-Command "node"
Ensure-Command "npm"

if (Test-PortInUse $Port) {
  Write-Warn "Port $Port is already in use."
  Write-Warn "MoeReview will not kill the existing process. Stop it manually or use: scripts/start.ps1 -Port <another-port>"
  exit 1
}

$WebPath = Join-Path $Root "web"
$ServerPath = Join-Path $Root "mcp-server"

Ensure-Dependencies $WebPath "web"
Ensure-Dependencies $ServerPath "mcp-server"

if (-not $SkipBuild) {
  Write-Step "Building web"
  Push-Location $WebPath
  try {
    npm run build
  } finally {
    Pop-Location
  }

  Write-Step "Building mcp-server"
  Push-Location $ServerPath
  try {
    npm run build
  } finally {
    Pop-Location
  }
} else {
  Write-Warn "Skipping build because -SkipBuild was provided"
}

if (-not $NoOpen) {
  Write-Step "Opening browser"
  Start-Process $HubUrl | Out-Null
}

Write-Step "Launching Hub. Press Ctrl+C to stop."
Push-Location $ServerPath
try {
  $env:MOEREVIEW_HUB_PORT = [string]$Port
  npm run hub
} finally {
  Pop-Location
}
