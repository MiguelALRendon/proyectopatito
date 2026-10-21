BeforeAll {
    $script:Repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')

    function New-Sandbox {
        $root = Join-Path ([IO.Path]::GetTempPath()) "release-tests-$([guid]::NewGuid().ToString('N'))"
        $scripts = Join-Path $root 'scripts'
        New-Item -ItemType Directory -Force $scripts | Out-Null
        Copy-Item (Join-Path $script:Repo 'scripts\build-release.ps1') $scripts
        $log = Join-Path $root 'calls.log'
        foreach ($name in 'fetch-zetaoffice', 'bundle-svn') {
            Set-Content (Join-Path $scripts "$name.ps1") "Add-Content '$log' '$name'"
        }
        $bin = Join-Path $root 'bin'
        New-Item -ItemType Directory -Force $bin | Out-Null
        Set-Content (Join-Path $bin 'npx.cmd') "@echo off`r`necho npx %CARGO_TARGET_DIR%^|%RUSTFLAGS%>>`"$log`"`r`nexit /b 7"
        [pscustomobject]@{ Root = $root; Script = Join-Path $scripts 'build-release.ps1'; Bin = $bin; Log = $log }
    }

    function Invoke-Release($sandbox, [string]$arguments) {
        $command = "`$env:PATH = '$($sandbox.Bin);' + `$env:PATH; " +
            "try { & '$($sandbox.Script)' $arguments } catch { Write-Output `"ERROR: `$(`$_.Exception.Message)`" }; " +
            "Write-Output `"ENV[`$env:CARGO_TARGET_DIR][`$env:RUSTFLAGS]`""
        pwsh -NoProfile -Command $command
    }
}

Describe 'build-release.ps1' {
    It 'falla con el código de tauri build y siempre limpia CARGO_TARGET_DIR y RUSTFLAGS' {
        $sandbox = New-Sandbox
        $output = Invoke-Release $sandbox '-SkipFetch'
        ($output -join "`n") | Should -Match 'tauri build fallo con codigo 7'
        $output | Should -Contain 'ENV[][]'
        (Get-Content $sandbox.Log) | Should -Match 'target-release\|-C target-feature=\+crt-static'
    }

    It 'sin -SkipFetch descarga ZetaOffice y empaqueta svn antes de compilar' {
        $sandbox = New-Sandbox
        Invoke-Release $sandbox '' | Out-Null
        $calls = (Get-Content $sandbox.Log) -replace ' .*', ''
        $calls | Should -Be @('fetch-zetaoffice', 'bundle-svn', 'npx')
    }

    It 'con -SkipFetch no descarga ni empaqueta' {
        $sandbox = New-Sandbox
        Invoke-Release $sandbox '-SkipFetch' | Out-Null
        ((Get-Content $sandbox.Log) -replace ' .*', '') | Should -Be @('npx')
    }
}

Describe 'verify-installer.ps1' {
    It 'falla si el instalador sale con un código distinto de cero' {
        $root = Join-Path ([IO.Path]::GetTempPath()) "installer-tests-$([guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Force $root | Out-Null
        $installer = Join-Path $root 'falso-setup.cmd'
        Set-Content $installer "@echo off`r`nexit /b 5"
        $script = Join-Path $script:Repo 'scripts\e2e\verify-installer.ps1'
        $output = pwsh -NoProfile -Command "try { & '$script' -Root '$root\sandbox' -Installer '$installer' } catch { Write-Output `"ERROR: `$(`$_.Exception.Message)`" }"
        ($output -join "`n") | Should -Match 'codigo de salida 5'
    }
}

AfterAll {
    $temp = [IO.Path]::GetTempPath()
    foreach ($pattern in 'bundle-tests-*', 'svn-bundle-t*', 'release-tests-*', 'installer-tests-*', 'served-*') {
        Get-ChildItem $temp -Directory -Filter $pattern -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
}
