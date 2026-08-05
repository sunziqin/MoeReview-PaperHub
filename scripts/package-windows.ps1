$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
  npm.cmd --prefix web run build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit code $LASTEXITCODE." }
  npm.cmd --prefix mcp-server run build
  if ($LASTEXITCODE -ne 0) { throw "Hub build failed with exit code $LASTEXITCODE." }
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-portable.ps1
  if ($LASTEXITCODE -ne 0) { throw "Portable assembly failed with exit code $LASTEXITCODE." }
  Push-Location desktop
  try {
    .\node_modules\.bin\electron-builder.cmd --prepackaged ..\release\MoeReview-portable --win nsis portable --x64 --publish never
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}
