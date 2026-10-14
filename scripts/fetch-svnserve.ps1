param([string]$Destination = (Join-Path $PSScriptRoot '..\.tools\apache-subversion'))
$ErrorActionPreference = 'Stop'
$url = 'https://www.visualsvn.com/files/Apache-Subversion-1.15.0-x64.zip'
$sha256 = '98BB798DD6C70CC875B9BDACD600594351CF88F0A39A831A5055DF061C871BB5'
$zip = Join-Path ([IO.Path]::GetTempPath()) 'apache-subversion.zip'
Invoke-WebRequest -Uri $url -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $sha256) { throw 'El hash del zip no coincide' }
$staging = Join-Path ([IO.Path]::GetTempPath()) 'apache-subversion-x'
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip -DestinationPath $staging
New-Item -ItemType Directory -Force $Destination | Out-Null
Copy-Item (Join-Path $staging 'bin\*') $Destination -Recurse -Force
Remove-Item $zip, $staging -Recurse -Force
Write-Output "svnserve.exe en $((Resolve-Path $Destination).Path)"
