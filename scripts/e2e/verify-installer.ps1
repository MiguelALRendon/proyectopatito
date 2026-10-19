param(
    [Parameter(Mandatory)][string]$Root,
    [string]$Installer,
    [switch]$Uninstall
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallDir = Join-Path $Root 'app'
$ExeName = 'dakedaduck-svn.exe'
$InstallTimeoutSeconds = 180
$Isolated = @{
    APPDATA      = Join-Path $Root 'profile\AppData\Roaming'
    LOCALAPPDATA = Join-Path $Root 'profile\AppData\Local'
    USERPROFILE  = Join-Path $Root 'profile'
    ProgramFiles = Join-Path $Root 'programfiles'
    ProgramW6432 = Join-Path $Root 'programfiles'
    PATH         = Join-Path $env:SystemRoot 'System32'
}

foreach ($path in $Isolated.GetEnumerator()) {
    if ($path.Key -ne 'PATH') { New-Item -ItemType Directory -Force $path.Value | Out-Null }
    Set-Item "Env:$($path.Key)" $path.Value
}
${env:ProgramFiles(x86)} = Join-Path $Root 'programfiles-x86'
New-Item -ItemType Directory -Force ${env:ProgramFiles(x86)} | Out-Null

function Wait-Process-Exit([System.Diagnostics.Process]$Process) {
    if (-not $Process.WaitForExit($InstallTimeoutSeconds * 1000)) {
        $Process.Kill($true)
        throw "el proceso $($Process.Id) no termino en $InstallTimeoutSeconds s"
    }
    if ($Process.ExitCode -ne 0) { throw "codigo de salida $($Process.ExitCode)" }
}

if ($Uninstall) {
    $uninstaller = Join-Path $InstallDir 'uninstall.exe'
    $process = Start-Process $uninstaller -ArgumentList '/S' -PassThru
    Wait-Process-Exit $process
    Start-Sleep -Seconds 3
    $orphans = @(Get-Process -Name ($ExeName -replace '\.exe$', '') -ErrorAction SilentlyContinue)
    $left = @(Get-ChildItem $InstallDir -Recurse -File -ErrorAction SilentlyContinue)
    [pscustomobject]@{ Orphans = $orphans.Count; FilesLeft = $left.Count } | ConvertTo-Json -Compress
    return
}

$process = Start-Process $Installer -ArgumentList '/S', "/D=$InstallDir" -PassThru
Wait-Process-Exit $process
$exe = Join-Path $InstallDir $ExeName
if (-not (Test-Path $exe)) { throw "el instalador no dejo $exe" }
$bytes = (Get-ChildItem $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum
[pscustomobject]@{
    Exe          = $exe
    InstalledMiB = [math]::Round($bytes / 1MB, 1)
    ConfigDir    = Join-Path $Isolated.APPDATA 'com.dakedaduck.svn'
} | ConvertTo-Json -Compress
