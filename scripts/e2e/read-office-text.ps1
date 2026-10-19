param([Parameter(Mandatory)][string]$Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$textEntries = '^(word/document\.xml|content\.xml|xl/sharedStrings\.xml|xl/worksheets/[^/]+\.xml|ppt/slides/[^/]+\.xml)$'
$bytes = [IO.File]::ReadAllBytes($Path)

function Read-ZipText([string]$File) {
    $zip = [IO.Compression.ZipFile]::OpenRead($File)
    try {
        $zip.Entries | Where-Object { $_.FullName -match $textEntries } | ForEach-Object {
            $reader = [IO.StreamReader]::new($_.Open(), [Text.Encoding]::UTF8)
            $xml = $reader.ReadToEnd()
            $reader.Dispose()
            [regex]::Replace($xml, '<[^>]+>', ' ')
        }
    } finally { $zip.Dispose() }
}

$isZip = $bytes.Length -ge 4 -and $bytes[0] -eq 0x50 -and $bytes[1] -eq 0x4B
if ($isZip) {
    (Read-ZipText $Path) -join "`n"
} else {
    [Text.Encoding]::Latin1.GetString($bytes)
    [Text.Encoding]::Unicode.GetString($bytes, 0, $bytes.Length - ($bytes.Length % 2))
    [Text.Encoding]::Unicode.GetString($bytes, 1, ($bytes.Length - 1) - (($bytes.Length - 1) % 2))
}
