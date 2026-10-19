param([string]$Destination = (Join-Path $PSScriptRoot '..\src-tauri\resources\zetaoffice'))
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
$lock = Get-Content (Join-Path $root 'third_party\zetaoffice.lock.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force $Destination | Out-Null

function Test-Matches($path, $entry) {
  if (-not (Test-Path $path)) { return $false }
  if ((Get-Item $path).Length -ne $entry.bytes) { return $false }
  return (Get-FileHash $path -Algorithm SHA256).Hash -eq $entry.sha256.ToUpper()
}

function Save-Entry($entry) {
  $target = Join-Path $Destination $entry.name
  if (Test-Matches $target $entry) { return }
  $staging = "$target.part"
  if ($entry.source -eq 'cdn') {
    Invoke-WebRequest -Uri ($lock.baseUrl + $entry.name) -OutFile $staging
  } else {
    $installed = Join-Path $root 'node_modules\zetajs\source\zeta.js'
    if (-not (Test-Path $installed)) { throw 'Falta node_modules\zetajs: corre npm install' }
    Copy-Item $installed $staging -Force
  }
  if (-not (Test-Matches $staging $entry)) {
    Remove-Item $staging -Force
    throw "El tamano o el SHA-256 de $($entry.name) no coincide con third_party/zetaoffice.lock.json"
  }
  Move-Item $staging $target -Force
}

foreach ($entry in $lock.files) { Save-Entry $entry }
Write-Output "ZetaOffice verificado en $((Resolve-Path $Destination).Path)"
