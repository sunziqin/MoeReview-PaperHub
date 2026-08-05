$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LineBreak = [Environment]::NewLine
$VideoPath = Join-Path $Root "promo-video\renders\moereview-product-intro.mp4"
Push-Location $Root
try {
  $files = @(git ls-files -co --exclude-standard)
  $blockedPath = $files | Where-Object {
    $_ -match '(^|/)(node_modules|dist|release|\.examforge|\.git)(/|$)' -or
    $_ -match '(^|/)(secrets\.json|\.env($|\.)|.*\.(pem|key|pfx|p12|sqlite|db|log|pdf|mp4))$'
  }
  if ($blockedPath) {
    throw ("Release files contain blocked paths:" + $LineBreak + ($blockedPath -join $LineBreak))
  }

  $secretHits = @()
  foreach ($file in ($files | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })) {
    if ($file -match '\.(png|jpg|jpeg|gif|ico|woff2?|ttf|zip|7z)$') { continue }
    $content = Get-Content -Raw -LiteralPath $file -ErrorAction SilentlyContinue
    if ($content -match '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' -or
        $content -match 'sk-[A-Za-z0-9]{20,}') {
      $secretHits += $file
    }
  }
  if ($secretHits) {
    throw ("Possible secret material found in:" + $LineBreak + ($secretHits -join $LineBreak))
  }
  git diff --check
  if (-not (Test-Path -LiteralPath (Join-Path $Root "desktop\package-lock.json"))) {
    throw "desktop/package-lock.json is missing."
  }
  if (-not (Test-Path -LiteralPath $VideoPath)) {
    Write-Warning "Promotional video is not present; upload it as a Release asset."
  }
  Write-Host "Release content check passed." -ForegroundColor Green
} finally {
  Pop-Location
}
