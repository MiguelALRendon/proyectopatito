param(
    [ValidateSet('debug', 'release', 'dev')][string]$Mode = 'debug',
    [string]$ConfigDir,
    [string]$UserDataDir,
    [string]$StateFile = (Join-Path ([IO.Path]::GetTempPath()) 'dakedaduck-app-state.json'),
    [int]$Port = 9333,
    [int]$TimeoutSeconds = 60,
    [switch]$Build,
    [switch]$Stop,
    [switch]$CloseWindow
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$exeName = 'dakedaduck-svn.exe'
$exeByMode = @{ debug = 'debug'; release = 'release'; dev = 'debug' }
$targetDirByMode = @{ debug = 'target-e2e'; release = 'target-e2e'; dev = 'target' }
$e2eTargetDir = Join-Path $repo 'src-tauri\target-e2e'
$exe = Join-Path $repo "src-tauri\$($targetDirByMode[$Mode])\$($exeByMode[$Mode])\$exeName"
$pollMilliseconds = 250

function Stop-AppTree([int]$ProcessId) {
    taskkill /PID $ProcessId /T /F | Out-Null
}

function Invoke-TauriBuild {
    Push-Location $repo
    try {
        $buildArgs = switch ($Mode) {
            'debug' { @('--debug', '--no-bundle') }
            'release' { @('--no-bundle', '--features', 'e2e-config-dir') }
        }
        $env:CARGO_TARGET_DIR = $e2eTargetDir
        npx tauri build @buildArgs
        if ($LASTEXITCODE -ne 0) { throw "tauri build fallo con codigo $LASTEXITCODE" }
    } finally {
        Pop-Location
        Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    }
}

function Test-DebugPort([int]$DebugPort) {
    try {
        $null = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/version" -TimeoutSec 2
        return $true
    } catch { return $false }
}

function Wait-DebugPort([int]$DebugPort, [datetime]$Deadline) {
    while ((Get-Date) -lt $Deadline) {
        if (Test-DebugPort $DebugPort) { return }
        Start-Sleep -Milliseconds $pollMilliseconds
    }
    throw "WebView2 no abrio el puerto de depuracion $DebugPort a tiempo"
}

function Start-DevApp {
    Push-Location $repo
    try {
        return Start-Process pwsh -ArgumentList '-NoProfile', '-Command', 'npm run tauri -- dev' -PassThru -WindowStyle Hidden
    } finally { Pop-Location }
}

if ($Stop) {
    if (Test-Path $StateFile) {
        $state = Get-Content $StateFile -Raw | ConvertFrom-Json
        Stop-AppTree $state.pid
        Remove-Item $StateFile -Force
    }
    return
}

if ($CloseWindow) {
    $state = Get-Content $StateFile -Raw | ConvertFrom-Json
    $running = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    try { if ($running) { $null = $running.CloseMainWindow() } } catch { return }
    return
}

if (Test-DebugPort $Port) { throw "el puerto de depuracion $Port ya responde: hay una instancia previa; detenla con -Stop" }
if ($Mode -ne 'dev' -and ($Build -or -not (Test-Path $exe))) { $null = Invoke-TauriBuild }
if (-not $UserDataDir) { $UserDataDir = Join-Path ([IO.Path]::GetTempPath()) 'dakedaduck-webview2-profile' }
New-Item -ItemType Directory -Force $UserDataDir | Out-Null

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
$env:WEBVIEW2_USER_DATA_FOLDER = $UserDataDir
if ($ConfigDir) { $env:DAKEDADUCK_CONFIG_DIR = $ConfigDir }

$process = if ($Mode -eq 'dev') { Start-DevApp } else { Start-Process $exe -PassThru }
try {
    Wait-DebugPort $Port (Get-Date).AddSeconds($TimeoutSeconds)
} catch {
    Stop-AppTree $process.Id
    throw
}
$state = @{ pid = $process.Id; port = $Port; mode = $Mode; userDataDir = $UserDataDir; exe = $exe }
$state | ConvertTo-Json | Set-Content $StateFile -Encoding utf8
$state | ConvertTo-Json -Compress
