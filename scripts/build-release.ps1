param([switch]$SkipFetch)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$targetDir = Join-Path $repo 'src-tauri\target-release'
$started = Get-Date

if (-not $SkipFetch) {
    & (Join-Path $PSScriptRoot 'fetch-zetaoffice.ps1')
    & (Join-Path $PSScriptRoot 'bundle-svn.ps1')
}

Push-Location $repo
try {
    $env:CARGO_TARGET_DIR = $targetDir
    $env:RUSTFLAGS = '-C target-feature=+crt-static'
    npx tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build fallo con codigo $LASTEXITCODE" }
} finally {
    Pop-Location
    Remove-Item Env:CARGO_TARGET_DIR, Env:RUSTFLAGS -ErrorAction SilentlyContinue
}

$exe = Join-Path $targetDir 'release\dakedaduck-svn.exe'
$installer = Get-ChildItem (Join-Path $targetDir 'release\bundle\nsis') -Filter '*.exe' | Select-Object -First 1
[pscustomobject]@{
    Minutes        = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
    ExeMiB         = [math]::Round((Get-Item $exe).Length / 1MB, 1)
    InstallerMiB   = [math]::Round($installer.Length / 1MB, 1)
    Installer      = $installer.FullName
} | Format-List
