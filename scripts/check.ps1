param(
  [int]$Port = 3456
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Write-Ok($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Test-Command($Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  return $null -ne $cmd
}

function Test-PortInUse($Port) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $connections
  } catch {
    return $false
  }
}

$failed = $false

Write-Host "MoeReview environment check" -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host ""

if (Test-Command "node") {
  $nodeVersion = (& node --version)
  Write-Ok "Node.js found: $nodeVersion"
} else {
  Write-Fail "Node.js not found. Install Node.js 18+."
  $failed = $true
}

if (Test-Command "npm") {
  $npmVersion = (& npm --version)
  Write-Ok "npm found: $npmVersion"
} else {
  Write-Fail "npm not found."
  $failed = $true
}

$webNodeModules = Join-Path $Root "web\node_modules"
$serverNodeModules = Join-Path $Root "mcp-server\node_modules"
$webDist = Join-Path $Root "web\dist\index.html"
$hubDist = Join-Path $Root "mcp-server\dist\hub.js"
$adapterDist = Join-Path $Root "mcp-server\dist\index.js"

if (Test-Path $webNodeModules) { Write-Ok "web dependencies installed" } else { Write-Warn "web dependencies missing. Run: npm run setup" }
if (Test-Path $serverNodeModules) { Write-Ok "mcp-server dependencies installed" } else { Write-Warn "mcp-server dependencies missing. Run: npm run setup" }
if (Test-Path $webDist) { Write-Ok "web build exists" } else { Write-Warn "web build missing. Run: npm run build" }
if (Test-Path $hubDist) { Write-Ok "Hub build exists" } else { Write-Warn "Hub build missing. Run: npm run build" }
if (Test-Path $adapterDist) { Write-Ok "MCP Adapter build exists" } else { Write-Warn "MCP Adapter build missing. Run: npm run build" }

if (Test-PortInUse $Port) {
  Write-Warn "Port $Port is already in use. MoeReview Hub may already be running, or another process owns the port."
} else {
  Write-Ok "Port $Port is available"
}

Write-Host ""
if ($failed) {
  Write-Fail "Check failed."
  exit 1
}

Write-Ok "Check completed."
