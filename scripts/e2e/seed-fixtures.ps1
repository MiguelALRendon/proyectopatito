param(
    [string]$Root = (Join-Path ([IO.Path]::GetTempPath()) 'dakedaduck-e2e'),
    [switch]$Stop
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SvnBinDir = 'C:\Program Files\SlikSvn\bin'
$SvnExe = Join-Path $SvnBinDir 'svn.exe'
$SvnAdminExe = Join-Path $SvnBinDir 'svnadmin.exe'
$SvnServeExe = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\.tools\apache-subversion\svnserve.exe'))
$Loopback = '127.0.0.1'
$TestUser = 'e2e'
$TestPassword = 'e2e-pass'
$SeedMarker = '.dakedaduck-e2e'
$ServerReadyTimeoutSeconds = 15
$ServerPollMilliseconds = 100
$LargeFileBytes = 6MB
$LargeFileLineBytes = 64
$SvnServeConf = "[general]`nanon-access = none`nauth-access = write`npassword-db = passwd`n"
$PngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
$RandomSeed = 42
$BinaryFixtureBytes = 2048
$MultiPagePdf = 'documento-multipagina.pdf'
$MultiPagePdfPages = 5
$SpecialImageName = 'pixel ñ #1.png'
$ExternalOpenDir = 'zona-apertura-externa'
$DosHeaderBytes = 64
$LnkHeaderBytes = 76
$OleSignature = [byte[]](0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)
$MzSignature = [byte[]](0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00)
$LnkSignature = [byte[]](0x4C, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00)
$ContentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
$PackageRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
$DocumentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento de prueba</w:t></w:r></w:p></w:body></w:document>'
$MarkdownWithImage = "# Markdown con imagen`n`n![pixel local](imagen.png)`n`n![pixel con punto](./imagen.png)`n`n![pixel especial](<pixel ñ %231.png>)`n`n[enlace relativo](leeme.txt) y [enlace externo](https://ejemplo.test/ruta)`n`nTexto final con **negritas**.`n"
$MarkdownWithRemote = "# Markdown con imagenes remotas`n`n![remota](http://evil.test/pixel.png)`n`n![remota segura](https://evil.test/pixel.png)`n`n![sin esquema](//evil.test/pixel.png)`n`n![fuera del root](../../../../../fuera.png)`n`nTexto final.`n"
$MarkdownWithXss = "# Cargas peligrosas`n`n<script>window.__xss=1</script>`n`n<img src=x onerror=window.__xss=1>`n`n[pulsa](javascript:window.__xss=1)`n`n<iframe src=`"http://evil.test/x`"></iframe>`n`n<svg onload=window.__xss=1></svg>`n`nTexto seguro.`n"
$ConflictLines = "linea 1`nlinea 2`nlinea 3`n"
$StatusLine = '^(?<flags>[ ADMCIRX!~?][ MC][ L][ +][ S][ KOTB][ C]) (?<path>.+)$'
$LockFlagColumn = 5

$Root = [IO.Path]::GetFullPath($Root)
$Paths = [ordered]@{
    Root = $Root
    Repo = Join-Path $Root 'repo'
    Workspace = Join-Path $Root 'workspace'
    Wc = Join-Path $Root 'workspace\wc'
    LocalFolder = Join-Path $Root 'workspace\local-folder'
    OldWc = Join-Path $Root 'workspace\vieja'
    Peer = Join-Path $Root 'peer-wc'
    ConfigDir = Join-Path $Root 'config'
    ConfigFile = Join-Path $Root 'config\config.json'
    SvnConfigDir = Join-Path $Root 'svn-config'
    Manifest = Join-Path $Root 'manifest.json'
}

$StateFile = [ordered]@{
    modificado = 'modificado.txt'
    agregado = 'agregado.txt'
    eliminado = 'eliminado.txt'
    no_versionado = 'no-versionado.txt'
    faltante = 'faltante.txt'
    ignorado = 'ignorados\ignorado.tmp'
    bloqueado = 'bloqueado.txt'
    conflicto = 'conflicto.txt'
    reemplazado = 'reemplazado.txt'
    externo = 'externos\carpeta-externa'
    tipo_cambiado = 'tipo-cambiado.txt'
}
$StateFlag = @{
    modificado = @(0, 'M')
    agregado = @(0, 'A')
    eliminado = @(0, 'D')
    no_versionado = @(0, '?')
    faltante = @(0, '!')
    ignorado = @(0, 'I')
    bloqueado = @($LockFlagColumn, 'K')
    conflicto = @(0, 'C')
    reemplazado = @(0, 'R')
    externo = @(0, 'X')
    tipo_cambiado = @(0, '~')
}
$IgnoredDir = 'ignorados'
$ExternalsDir = 'externos'
$ExternalSourceDir = 'origen-externo'
$ExternalName = 'carpeta-externa'
$NeedsLockFile = 'requiere-bloqueo.txt'
$NeedsLockValue = 'true'
$OldWcFormat = 28
$WcDbVersionOffset = 60

function Invoke-Svn {
    Push-Location $Paths.Root
    try { $output = & $SvnExe --config-dir $Paths.SvnConfigDir --non-interactive @args 2>&1 | ForEach-Object { "$_" } }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "svn $args fallo: $output" }
    $output
}

function Invoke-SvnQuiet {
    Invoke-Svn @args | Out-Null
}

function Write-Utf8File([string]$Path, [string]$Text, [bool]$WithBom = $false) {
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($WithBom))
}

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    $port
}

function Test-PortOpen([int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try { $client.Connect($Loopback, $Port); $true } catch { $false } finally { $client.Dispose() }
}

function Wait-ServerListening([int]$Port) {
    $deadline = [DateTime]::UtcNow.AddSeconds($ServerReadyTimeoutSeconds)
    while (-not (Test-PortOpen $Port)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw "svnserve no arranco en el puerto $Port" }
        Start-Sleep -Milliseconds $ServerPollMilliseconds
    }
}

function Stop-ServerByPid([int]$ServerPid) {
    $process = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
    if ($null -eq $process -or $process.ProcessName -ne 'svnserve') { return }
    Stop-Process -Id $ServerPid
    Wait-Process -Id $ServerPid -ErrorAction SilentlyContinue
}

function Stop-SeededServer {
    if (-not (Test-Path $Paths.Manifest)) { Write-Output 'Sin manifiesto: nada que detener'; return }
    $manifest = Get-Content $Paths.Manifest -Raw | ConvertFrom-Json
    Stop-ServerByPid $manifest.server_pid
    Write-Output "svnserve detenido (pid $($manifest.server_pid))"
}

function Reset-Root {
    if ([IO.Path]::GetPathRoot($Root) -eq $Root) { throw "Root no puede ser una raiz de unidad: $Root" }
    if (Test-Path $Root) {
        $isEmpty = -not (Get-ChildItem $Root -Force | Select-Object -First 1)
        if (-not $isEmpty -and -not (Test-Path (Join-Path $Root $SeedMarker))) {
            throw "$Root no esta vacio y no fue creado por este script"
        }
        Stop-SeededServer | Out-Null
        Remove-Item $Root -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Root | Out-Null
    New-Item -ItemType File -Path (Join-Path $Root $SeedMarker) | Out-Null
    foreach ($dir in 'Workspace', 'LocalFolder', 'ConfigDir', 'SvnConfigDir') {
        New-Item -ItemType Directory -Path $Paths[$dir] | Out-Null
    }
}

function New-Repository {
    & $SvnAdminExe create $Paths.Repo
    if ($LASTEXITCODE -ne 0) { throw 'svnadmin create fallo' }
    $conf = Join-Path $Paths.Repo 'conf'
    Write-Utf8File (Join-Path $conf 'svnserve.conf') $SvnServeConf
    Write-Utf8File (Join-Path $conf 'passwd') "[users]`n$TestUser = $TestPassword`n"
}

function Start-SvnServe {
    if (-not (Test-Path $SvnServeExe)) { throw "falta $SvnServeExe; ejecuta: pwsh scripts/fetch-svnserve.ps1" }
    $port = Get-FreePort
    $arguments = @('-d', '--foreground', '--listen-host', $Loopback, '--listen-port', $port, '-r', "`"$($Paths.Repo)`"")
    $process = Start-Process -FilePath $SvnServeExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    try { Wait-ServerListening $port } catch { Stop-ServerByPid $process.Id; throw }
    [pscustomobject]@{ Pid = $process.Id; Port = $port; Url = "svn://${Loopback}:$port" }
}

function Assert-ServerAuth($Server) {
    Invoke-SvnQuiet info $Server.Url --username $TestUser --password $TestPassword --no-auth-cache
}

function New-ContentFixtures([string]$Wc) {
    Write-Utf8File (Join-Path $Wc 'texto-plano.txt') "Hola desde un texto plano UTF-8`n"
    Write-Utf8File (Join-Path $Wc 'documento.md') "# Titulo`n`nUn parrafo con **negritas**.`n"
    Write-Utf8File (Join-Path $Wc 'lf.txt') "uno`ndos`ntres`n"
    Write-Utf8File (Join-Path $Wc 'ejemplo.js') "// saludo de prueba`nconst saludo = 'hola';`nfunction sumar(a, b) {`n  return a + b;`n}`n"
    Write-Utf8File (Join-Path $Wc 'utf8-bom-crlf.txt') "uno`r`ndos`r`ntres`r`n" $true
    Write-Utf8File (Join-Path $Wc 'vector-con-script.svg') '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>'
    Write-Utf8File (Join-Path $Wc 'a#b%c d ñ.txt') "nombre con caracteres especiales`n"
    $line = ('x' * ($LargeFileLineBytes - 1)) + "`n"
    Write-Utf8File (Join-Path $Wc 'grande.txt') ($line * [int]($LargeFileBytes / $LargeFileLineBytes))
    $utf16 = [Text.UnicodeEncoding]::new($false, $true)
    [IO.File]::WriteAllBytes((Join-Path $Wc 'utf16le-bom.txt'), $utf16.GetPreamble() + $utf16.GetBytes("texto en UTF-16 LE`r`n"))
}

function New-BinaryFixtures([string]$Wc) {
    $random = [Random]::new($RandomSeed)
    $bytes = [byte[]]::new($BinaryFixtureBytes)
    $random.NextBytes($bytes)
    $bytes[0] = 0
    [IO.File]::WriteAllBytes((Join-Path $Wc 'falso.md'), $bytes)
    $random.NextBytes($bytes)
    [IO.File]::WriteAllBytes((Join-Path $Wc 'datos.bin'), $bytes)
    [IO.File]::WriteAllBytes((Join-Path $Wc 'imagen.png'), [Convert]::FromBase64String($PngBase64))
    [IO.File]::WriteAllBytes((Join-Path $Wc 'documento.pdf'), (New-MinimalPdfBytes))
    [IO.File]::WriteAllBytes((Join-Path $Wc $MultiPagePdf), (New-MinimalPdfBytes $MultiPagePdfPages))
    [IO.File]::WriteAllBytes((Join-Path $Wc $SpecialImageName), [Convert]::FromBase64String($PngBase64))
}

function New-ZipBytes([System.Collections.Specialized.OrderedDictionary]$Entries) {
    $stream = [IO.MemoryStream]::new()
    $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    foreach ($name in $Entries.Keys) {
        $writer = [IO.StreamWriter]::new($zip.CreateEntry($name).Open(), [Text.UTF8Encoding]::new($false))
        $writer.Write($Entries[$name])
        $writer.Dispose()
    }
    $zip.Dispose()
    $stream.ToArray()
}

function New-HeaderBytes([byte[]]$Signature, [int]$Length) {
    $bytes = [byte[]]::new($Length)
    [Array]::Copy($Signature, $bytes, $Signature.Length)
    $bytes
}

function New-ExternalOpenFixtures([string]$Wc) {
    $dir = Join-Path $Wc $ExternalOpenDir
    New-Item -ItemType Directory -Path $dir | Out-Null
    $docx = [ordered]@{ '[Content_Types].xml' = $ContentTypesXml; '_rels/.rels' = $PackageRelsXml; 'word/document.xml' = $DocumentXml }
    $permitted = @{ 'informe.docx' = (New-ZipBytes $docx); 'PAQUETE.ZIP' = (New-ZipBytes ([ordered]@{ 'leeme.txt' = 'datos' })) }
    $macro = New-ZipBytes $docx
    $mz = New-HeaderBytes $MzSignature $DosHeaderBytes
    $withNul = [Text.Encoding]::ASCII.GetBytes("contenido`0binario")
    $refused = @{
        'programa.exe' = $mz; 'factura.pdf.exe' = $mz; 'falso.pdf' = $mz; 'sin-extension' = $mz
        'macro.docm' = $macro; 'binario.js' = $withNul; 'pagina.html' = $withNul; 'lote.bat' = $withNul
        'planilla.csv' = $withNul; 'viejo.doc' = (New-HeaderBytes $OleSignature $DosHeaderBytes)
        'atajo.lnk' = (New-HeaderBytes $LnkSignature $LnkHeaderBytes)
    }
    foreach ($files in $permitted, $refused) {
        foreach ($name in $files.Keys) { [IO.File]::WriteAllBytes((Join-Path $dir $name), $files[$name]) }
    }
}

function New-MarkdownFixtures([string]$Wc) {
    Write-Utf8File (Join-Path $Wc 'markdown-imagen.md') $MarkdownWithImage
    Write-Utf8File (Join-Path $Wc 'markdown-remoto.md') $MarkdownWithRemote
    Write-Utf8File (Join-Path $Wc 'markdown-xss.md') $MarkdownWithXss
}

function New-MinimalPdfBytes([int]$Pages = 1) {
    $firstPageObject = 3
    $fontObject = $firstPageObject + 2 * $Pages
    $kids = (0..($Pages - 1) | ForEach-Object { "$($firstPageObject + 2 * $_) 0 R" }) -join ' '
    $objects = @('<< /Type /Catalog /Pages 2 0 R >>', "<< /Type /Pages /Kids [$kids] /Count $Pages >>")
    foreach ($page in 1..$Pages) {
        $stream = "BT /F1 24 Tf 20 100 Td (Pagina $page de $Pages) Tj ET"
        $contentObject = $firstPageObject + 2 * ($page - 1) + 1
        $objects += "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents $contentObject 0 R /Resources << /Font << /F1 $fontObject 0 R >> >> >>"
        $objects += "<< /Length $($stream.Length) >>`nstream`n$stream`nendstream"
    }
    $objects += '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    $document = "%PDF-1.4`n"
    $entries = foreach ($index in 0..($objects.Count - 1)) {
        $offset = $document.Length
        $document += "$($index + 1) 0 obj`n$($objects[$index])`nendobj`n"
        '{0:D10} 00000 n ' -f $offset
    }
    $xrefOffset = $document.Length
    $size = $objects.Count + 1
    $document += "xref`n0 $size`n0000000000 65535 f `n" + (($entries | ForEach-Object { "$_`n" }) -join '')
    $document += "trailer`n<< /Size $size /Root 1 0 R >>`nstartxref`n$xrefOffset`n%%EOF`n"
    [Text.Encoding]::ASCII.GetBytes($document)
}

function New-StateBaseFixtures([string]$Wc) {
    foreach ($state in 'modificado', 'eliminado', 'faltante', 'bloqueado', 'reemplazado', 'tipo_cambiado') {
        Write-Utf8File (Join-Path $Wc $StateFile[$state]) "base de $state`n"
    }
    Write-Utf8File (Join-Path $Wc $StateFile.conflicto) $ConflictLines
    Write-Utf8File (Join-Path $Wc $NeedsLockFile) "este archivo requiere bloqueo`n"
    New-Item -ItemType Directory -Path (Join-Path $Wc $IgnoredDir), (Join-Path $Wc $ExternalsDir), (Join-Path $Wc $ExternalSourceDir) | Out-Null
    Write-Utf8File (Join-Path $Wc "$IgnoredDir\leeme.txt") "carpeta con svn:ignore`n"
    Write-Utf8File (Join-Path $Wc "$ExternalSourceDir\contenido.txt") "contenido del origen externo`n"
}

function Save-InitialRevision([string]$Wc) {
    Get-ChildItem $Wc -Exclude '.svn' | ForEach-Object { Invoke-SvnQuiet add $_.FullName }
    Invoke-SvnQuiet propset svn:needs-lock $NeedsLockValue (Join-Path $Wc $NeedsLockFile)
    Invoke-SvnQuiet propset svn:ignore '*.tmp' (Join-Path $Wc $IgnoredDir)
    Invoke-SvnQuiet propset svn:externals "^/$ExternalSourceDir $ExternalName" (Join-Path $Wc $ExternalsDir)
    Invoke-SvnQuiet commit $Wc -m 'fixtures iniciales'
}

function Add-ConflictingPeerCommit {
    Invoke-SvnQuiet checkout $Paths.RepoFileUrl $Paths.Peer
    Write-Utf8File (Join-Path $Paths.Peer $StateFile.conflicto) "linea 1`nlinea del par`nlinea 3`n"
    Invoke-SvnQuiet commit $Paths.Peer -m 'cambio conflictivo del par'
}

function Update-WithConflict([string]$Wc) {
    Write-Utf8File (Join-Path $Wc $StateFile.conflicto) "linea 1`nlinea local`nlinea 3`n"
    Invoke-SvnQuiet update $Wc --accept postpone
}

function Set-LocalChanges([string]$Wc) {
    $statePath = { param($state) Join-Path $Wc $StateFile[$state] }
    Invoke-SvnQuiet lock (& $statePath 'bloqueado') -m 'bloqueo de prueba'
    Add-Content (& $statePath 'modificado') 'cambio local'
    Write-Utf8File (& $statePath 'agregado') "archivo nuevo`n"
    Invoke-SvnQuiet add (& $statePath 'agregado')
    Invoke-SvnQuiet rm (& $statePath 'eliminado')
    Write-Utf8File (& $statePath 'no_versionado') "sin versionar`n"
    Remove-Item (& $statePath 'faltante')
    Write-Utf8File (& $statePath 'ignorado') "temporal`n"
    Invoke-SvnQuiet rm (& $statePath 'reemplazado')
    Write-Utf8File (& $statePath 'reemplazado') "contenido de reemplazo`n"
    Invoke-SvnQuiet add (& $statePath 'reemplazado')
    Remove-Item (& $statePath 'tipo_cambiado')
    New-Item -ItemType Directory -Path (& $statePath 'tipo_cambiado') | Out-Null
}

function New-OldFormatCopy {
    Invoke-SvnQuiet checkout $Paths.RepoFileUrl $Paths.OldWc --depth files
    $db = Join-Path $Paths.OldWc '.svn\wc.db'
    $bytes = [IO.File]::ReadAllBytes($db)
    $format = [BitConverter]::GetBytes([int]$OldWcFormat)
    [Array]::Reverse($format)
    # svn guarda el formato del wc.db como entero big-endian en los bytes 60..64
    [Array]::Copy($format, 0, $bytes, $WcDbVersionOffset, $format.Length)
    [IO.File]::WriteAllBytes($db, $bytes)
}

function New-LocalFolder {
    Write-Utf8File (Join-Path $Paths.LocalFolder 'leeme.txt') "carpeta local sin versionar`n"
}

function Get-SvnStatus([string]$Wc) {
    $status = @{}
    foreach ($line in Invoke-Svn status --no-ignore $Wc) {
        if ($line -match $StatusLine) {
            $status[[IO.Path]::GetRelativePath($Wc, $Matches.path)] = $Matches.flags
        }
    }
    $status
}

function Find-StatusFailures([string]$Wc) {
    $status = Get-SvnStatus $Wc
    foreach ($state in $StateFlag.Keys) {
        $column, $code = $StateFlag[$state]
        $flags = $status[$StateFile[$state]]
        if ($null -eq $flags -or $flags.Substring($column, 1) -ne $code) {
            "$state ($($StateFile[$state])): esperado '$code' en columna $column, obtenido '$flags'"
        }
    }
}

function Assert-ExpectedStatus([string]$Wc) {
    $failures = @(Find-StatusFailures $Wc)
    if ($failures.Count -gt 0) { throw "svn status no coincide:`n$($failures -join "`n")" }
}

function Write-Config {
    $config = [ordered]@{ workspace_root = $Paths.Workspace; svn_path = $SvnExe }
    Write-Utf8File $Paths.ConfigFile ($config | ConvertTo-Json)
}

function Write-Manifest($Server) {
    $manifest = [ordered]@{
        root = $Paths.Root
        repo_path = $Paths.Repo
        repo_file_url = $Paths.RepoFileUrl
        repo_svn_url = $Server.Url
        server_port = $Server.Port
        server_pid = $Server.Pid
        user = $TestUser
        password = $TestPassword
        workspace_root = $Paths.Workspace
        wc_path = $Paths.Wc
        local_folder = $Paths.LocalFolder
        old_wc_path = $Paths.OldWc
        peer_wc_path = $Paths.Peer
        config_path = $Paths.ConfigFile
        svn_config_dir = $Paths.SvnConfigDir
        svn_path = $SvnExe
        svnserve_path = $SvnServeExe
        states = $StateFile
    }
    Write-Utf8File $Paths.Manifest ($manifest | ConvertTo-Json -Depth 4)
}

function Initialize-WorkingCopy {
    $wc = $Paths.Wc
    Invoke-SvnQuiet checkout $Paths.RepoFileUrl $wc
    New-ContentFixtures $wc
    New-BinaryFixtures $wc
    New-MarkdownFixtures $wc
    New-ExternalOpenFixtures $wc
    New-StateBaseFixtures $wc
    Save-InitialRevision $wc
    Add-ConflictingPeerCommit
    Update-WithConflict $wc
    Set-LocalChanges $wc
}

function Invoke-Seed {
    Reset-Root
    New-Repository
    $Paths.RepoFileUrl = [Uri]::new($Paths.Repo).AbsoluteUri
    $server = Start-SvnServe
    try {
        Assert-ServerAuth $server
        Initialize-WorkingCopy
        New-OldFormatCopy
        New-LocalFolder
        Write-Config
        Write-Manifest $server
        Assert-ExpectedStatus $Paths.Wc
    }
    catch {
        Stop-ServerByPid $server.Pid
        throw
    }
    Write-Output "Entorno E2E listo en $Root (svnserve pid $($server.Pid), puerto $($server.Port))"
}

if ($Stop) { Stop-SeededServer } else { Invoke-Seed }
