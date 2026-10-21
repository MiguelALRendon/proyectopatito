BeforeAll {
    $script:Repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
    $script:RuntimeName = 'vcruntime140.dll'

    function Get-Hash([string]$path) { (Get-FileHash $path -Algorithm SHA256).Hash.ToLower() }

    function New-Sandbox([int]$msiExit = 0, [switch]$withoutRuntime, [switch]$withoutDll, [string]$zipUrl = 'http://127.0.0.1:9/slik.zip', [switch]$badCache) {
        $id = [guid]::NewGuid().ToString('N')
        $root = Join-Path ([IO.Path]::GetTempPath()) "bundle-tests-$id"
        $version = "t$id"
        $work = Join-Path ([IO.Path]::GetTempPath()) "svn-bundle-$version"
        foreach ($dir in 'scripts', 'third_party', 'bin', 'tree\bin', 'tree\Licenses', 'pf') { New-Item -ItemType Directory -Force (Join-Path $root $dir) | Out-Null }
        New-Item -ItemType Directory -Force $work | Out-Null
        Copy-Item (Join-Path $script:Repo 'scripts\bundle-svn.ps1') (Join-Path $root 'scripts')

        Set-Content (Join-Path $root 'x.msi') 'msi'
        Compress-Archive (Join-Path $root 'x.msi') (Join-Path $work 'slik.zip')
        $zipHash = Get-Hash (Join-Path $work 'slik.zip')
        if ($badCache) { Set-Content (Join-Path $work 'slik.zip') 'corrupto' }

        Set-Content (Join-Path $root 'tree\bin\svn.exe') 'svn'
        if (-not $withoutDll) { Set-Content (Join-Path $root 'tree\bin\a.dll') 'dll' }
        Set-Content (Join-Path $root 'tree\Licenses\Licencia.txt') 'texto de licencia'

        $runtimeDir = Join-Path $root 'pf\Microsoft Visual Studio\18\Community\VC\Redist\MSVC\14.0\x64\Microsoft.VC143.CRT'
        if (-not $withoutRuntime) {
            New-Item -ItemType Directory -Force $runtimeDir | Out-Null
            Set-Content (Join-Path $runtimeDir $script:RuntimeName) 'runtime'
        }
        $runtimeHash = if ($withoutRuntime) { 'x' } else { Get-Hash (Join-Path $runtimeDir $script:RuntimeName) }

        $lock = [ordered]@{
            name = 'prueba'; version = $version
            zip = [ordered]@{ url = $zipUrl; bytes = 1; sha256 = $zipHash }
            files = @('svn.exe', 'a.dll')
            runtimeVersion = '14.0'
            runtime = @([ordered]@{ name = $script:RuntimeName; sha256 = $runtimeHash })
        }
        $lock | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'third_party\svn.lock.json')

        Set-Content (Join-Path $root 'bin\msiexec.cmd') "@echo off`r`nif not `"%FAKE_MSI_EXIT%`"==`"0`" exit /b %FAKE_MSI_EXIT%`r`nxcopy /e /i /q /y `"%FAKE_MSI_TREE%`" `"%FAKE_ADMIN%\PFiles`" >nul`r`nexit /b 0"
        [pscustomobject]@{ Root = $root; Work = $work; Version = $version; MsiExit = $msiExit; ZipHash = $zipHash }
    }

    function Invoke-Bundle($sandbox, [string]$arguments = '') {
        $root = $sandbox.Root
        $command = "`$env:PATH = '$root\bin;' + `$env:PATH; `$env:ProgramFiles = '$root\pf'; " +
            "`$env:FAKE_MSI_EXIT = '$($sandbox.MsiExit)'; `$env:FAKE_MSI_TREE = '$root\tree'; `$env:FAKE_ADMIN = '$($sandbox.Work)\admin'; " +
            "try { & '$root\scripts\bundle-svn.ps1' $arguments } catch { Write-Output `"ERROR: `$(`$_.Exception.Message)`" }"
        (pwsh -NoProfile -Command $command) -join "`n"
    }
}

Describe 'bundle-svn.ps1' {
    It 'reutiliza el zip en caché cuando su SHA-256 coincide, sin descargar' {
        $sandbox = New-Sandbox
        $output = Invoke-Bundle $sandbox
        $output | Should -Not -Match 'ERROR'
        $output | Should -Match "svn $($sandbox.Version)"
    }

    It 'copia el programa, el runtime y las licencias de SlikSVN a la carpeta del paquete' {
        $sandbox = New-Sandbox
        Invoke-Bundle $sandbox | Out-Null
        $package = Join-Path $sandbox.Root 'src-tauri\resources\svn'
        foreach ($name in 'svn.exe', 'a.dll', $script:RuntimeName) { Test-Path (Join-Path $package $name) | Should -BeTrue }
        Get-Content (Join-Path $package 'licenses\Licencia.txt') | Should -Be 'texto de licencia'
    }

    It 'aborta si msiexec devuelve un código distinto de cero' {
        $sandbox = New-Sandbox -msiExit 3
        Invoke-Bundle $sandbox | Should -Match 'msiexec fallo con codigo 3'
    }

    It 'aborta si falta en el MSI un archivo listado en el lock' {
        $sandbox = New-Sandbox -withoutDll
        Invoke-Bundle $sandbox | Should -Match 'Falta a.dll'
    }

    It 'aborta si no encuentra el redistribuible x64 de Visual C++' {
        $sandbox = New-Sandbox -withoutRuntime
        Invoke-Bundle $sandbox | Should -Match 'No se encontro el redistribuible x64'
    }

    It 'aborta si el SHA-256 de un archivo del runtime no coincide con el lock' {
        $sandbox = New-Sandbox
        $lockPath = Join-Path $sandbox.Root 'third_party\svn.lock.json'
        $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
        $lock.runtime[0].sha256 = '0' * 64
        $lock | ConvertTo-Json -Depth 4 | Set-Content $lockPath
        Invoke-Bundle $sandbox | Should -Match 'El SHA-256 de vcruntime140.dll no coincide'
    }

    It 'con -WriteManifest regenera el manifiesto con nombre, tamaño y SHA-256 de cada archivo' {
        $sandbox = New-Sandbox
        Invoke-Bundle $sandbox '-WriteManifest' | Out-Null
        $manifest = Get-Content (Join-Path $sandbox.Root 'third_party\svn.manifest.json') -Raw | ConvertFrom-Json
        $package = Join-Path $sandbox.Root 'src-tauri\resources\svn'
        $manifest.version | Should -Be $sandbox.Version
        $manifest.files.name | Should -Be @('a.dll', 'svn.exe', $script:RuntimeName)
        foreach ($entry in $manifest.files) {
            $file = Join-Path $package $entry.name
            $entry.bytes | Should -Be (Get-Item $file).Length
            $entry.sha256 | Should -Be (Get-Hash $file)
        }
    }

    It 'rechaza el zip descargado cuyo SHA-256 no coincide con el lock' {
        $served = Join-Path ([IO.Path]::GetTempPath()) "served-$([guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Force $served | Out-Null
        Set-Content (Join-Path $served 'slik.zip') 'no es el zip esperado'
        $port = Get-Random -Minimum 20000 -Maximum 40000
        $server = Start-Process python -ArgumentList '-m', 'http.server', $port, '--bind', '127.0.0.1', '-d', $served -PassThru -WindowStyle Hidden
        try {
            Start-Sleep -Seconds 2
            $sandbox = New-Sandbox -badCache -zipUrl "http://127.0.0.1:$port/slik.zip"
            Invoke-Bundle $sandbox | Should -Match 'El SHA-256 del zip de SlikSVN no coincide'
        } finally {
            Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
        }
    }
}

AfterAll {
    $temp = [IO.Path]::GetTempPath()
    foreach ($pattern in 'bundle-tests-*', 'svn-bundle-t*', 'release-tests-*', 'installer-tests-*', 'served-*') {
        Get-ChildItem $temp -Directory -Filter $pattern -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
}
