$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Desktop = Join-Path $Root "desktop"
$Release = Join-Path $Root "release"
$PortableRoot = Join-Path $Release "MoeReview-portable"
$ElectronDist = Join-Path $Desktop "node_modules\electron\dist"
$WebDist = Join-Path $Root "web\dist"
$HubDist = Join-Path $Root "mcp-server\dist"
$HubModules = Join-Path $Root "mcp-server\node_modules"

if (-not (Test-Path -LiteralPath (Join-Path $ElectronDist "electron.exe"))) { throw "Electron runtime is missing." }
if (-not (Test-Path -LiteralPath (Join-Path $WebDist "index.html"))) { throw "Web build is missing." }
if (-not (Test-Path -LiteralPath (Join-Path $HubDist "hub.js"))) { throw "Hub build is missing." }

New-Item -ItemType Directory -Force $Release | Out-Null
if (Test-Path -LiteralPath $PortableRoot) {
  $resolvedRoot = [IO.Path]::GetFullPath($Root)
  $resolvedPortable = [IO.Path]::GetFullPath($PortableRoot)
  if (-not $resolvedPortable.StartsWith($resolvedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a portable path outside the workspace."
  }
  Remove-Item -LiteralPath $PortableRoot -Recurse -Force
}

New-Item -ItemType Directory -Force (Join-Path $PortableRoot "resources\app") | Out-Null
Copy-Item -Path (Join-Path $ElectronDist "*") -Destination $PortableRoot -Recurse -Force
Move-Item -LiteralPath (Join-Path $PortableRoot "electron.exe") -Destination (Join-Path $PortableRoot "MoeReview.exe") -Force
Copy-Item -LiteralPath (Join-Path $Desktop "main.cjs") -Destination (Join-Path $PortableRoot "resources\app\main.cjs") -Force
Copy-Item -LiteralPath (Join-Path $Desktop "package.json") -Destination (Join-Path $PortableRoot "resources\app\package.json") -Force
New-Item -ItemType Directory -Force (Join-Path $PortableRoot "resources\web"), (Join-Path $PortableRoot "resources\mcp-server") | Out-Null
Copy-Item -LiteralPath $WebDist -Destination (Join-Path $PortableRoot "resources\web\dist") -Recurse -Force
Copy-Item -LiteralPath $HubDist -Destination (Join-Path $PortableRoot "resources\mcp-server\dist") -Recurse -Force
Copy-Item -LiteralPath $HubModules -Destination (Join-Path $PortableRoot "resources\mcp-server\node_modules") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "mcp-server\package.json") -Destination (Join-Path $PortableRoot "resources\mcp-server\package.json") -Force

$zipPath = Join-Path $Release "MoeReview-0.1.0-portable.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $PortableRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Portable app: $PortableRoot" -ForegroundColor Green
Write-Host "Portable zip: $zipPath" -ForegroundColor Green
