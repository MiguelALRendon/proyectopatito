param(
    [string]$Destination = (Join-Path $PSScriptRoot '..\src-tauri\resources\svn'),
    [switch]$WriteManifest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Join-Path $PSScriptRoot '..'
$lockPath = Join-Path $root 'third_party\svn.lock.json'
$manifestPath = Join-Path $root 'third_party\svn.manifest.json'
$lock = Get-Content $lockPath -Raw | ConvertFrom-Json
$work = Join-Path ([IO.Path]::GetTempPath()) "svn-bundle-$($lock.version)"
$msiTimeoutSeconds = 300

function Get-Sha256($path) { (Get-FileHash $path -Algorithm SHA256).Hash.ToLower() }

function Save-Zip {
    New-Item -ItemType Directory -Force $work | Out-Null
    $zip = Join-Path $work 'slik.zip'
    $isCached = (Test-Path $zip) -and ((Get-Sha256 $zip) -eq $lock.zip.sha256)
    if (-not $isCached) { Invoke-WebRequest -Uri $lock.zip.url -OutFile $zip }
    if ((Get-Sha256 $zip) -ne $lock.zip.sha256) { throw 'El SHA-256 del zip de SlikSVN no coincide con third_party/svn.lock.json' }
    return $zip
}

function Expand-Msi($zip) {
    $unzipped = Join-Path $work 'zip'
    $admin = Join-Path $work 'admin'
    Remove-Item $unzipped, $admin -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip -DestinationPath $unzipped
    $msi = Get-ChildItem $unzipped -Filter *.msi | Select-Object -First 1
    New-Item -ItemType Directory -Force $admin | Out-Null
    $process = Start-Process msiexec -ArgumentList '/a', "`"$($msi.FullName)`"", '/qn', "TARGETDIR=`"$admin`"" -PassThru
    if (-not $process.WaitForExit($msiTimeoutSeconds * 1000)) { $process.Kill(); throw 'msiexec no termino' }
    if ($process.ExitCode -ne 0) { throw "msiexec fallo con codigo $($process.ExitCode)" }
    return Join-Path $admin 'PFiles'
}

function Find-RuntimeDir {
    $visualStudio = Join-Path ${env:ProgramFiles} 'Microsoft Visual Studio'
    $dirs = Get-ChildItem $visualStudio -Recurse -Directory -Filter 'Microsoft.VC*.CRT' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*\Redist\MSVC\*\x64\*' }
    $dir = $dirs | Sort-Object FullName | Select-Object -Last 1
    if (-not $dir) { throw 'No se encontro el redistribuible x64 de Visual C++ (Redist\MSVC\...\x64\Microsoft.VC*.CRT)' }
    return $dir.FullName
}

function Copy-Verified($from, $to, $name, $expected) {
    $source = Join-Path $from $name
    if (-not (Test-Path $source)) { throw "Falta $name en $from" }
    Copy-Item $source (Join-Path $to $name) -Force
    if ($expected -and (Get-Sha256 (Join-Path $to $name)) -ne $expected) { throw "El SHA-256 de $name no coincide con third_party/svn.lock.json" }
}

$program = Expand-Msi (Save-Zip)
$runtime = Find-RuntimeDir
Remove-Item $Destination -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Destination, (Join-Path $Destination 'licenses') | Out-Null

foreach ($name in $lock.files) { Copy-Verified (Join-Path $program 'bin') $Destination $name $null }
foreach ($entry in $lock.runtime) { Copy-Verified $runtime $Destination $entry.name $entry.sha256 }
Copy-Item (Join-Path $program 'Licenses\*') (Join-Path $Destination 'licenses') -Recurse -Force

if ($WriteManifest) {
    $files = Get-ChildItem $Destination -File | Sort-Object Name | ForEach-Object {
        [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = Get-Sha256 $_.FullName }
    }
    $manifest = [ordered]@{ version = $lock.version; runtime = $lock.runtimeVersion; files = $files }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content $manifestPath -Encoding utf8
}

$bytes = (Get-ChildItem $Destination -Recurse -File | Measure-Object Length -Sum).Sum
Write-Output "svn $($lock.version) en $((Resolve-Path $Destination).Path): $([math]::Round($bytes / 1MB, 1)) MiB"
