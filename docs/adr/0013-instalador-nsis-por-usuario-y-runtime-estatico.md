---
status: proposed
date: 2026-10-18
deciders: [usuario]
---

# 0013. Instalador NSIS por usuario, runtime de C estático y WebView2 por descarga

## Context and Problem Statement

El producto solo se había ejecutado desde la carpeta de desarrollo. Una máquina limpia con Windows 11 puede no tener el runtime de Visual C++ y puede no tener WebView2 actualizado, y el instalador no debe pedir administrador.

## Considered Options

- NSIS por usuario, `-C target-feature=+crt-static` y `webviewInstallMode: downloadBootstrapper`.
- Lo mismo con `offlineInstaller` (el instalador crece ~127 MiB).
- Instalación por máquina (pide administrador) o MSI.

## Decision Outcome

Elegida la primera, de forma **provisional** hasta tener la evidencia de una máquina limpia (acción del usuario; el 2026-10-21 el usuario la aplazó a una fase posterior de distribución, así que el ADR sigue en `proposed`): `bundle.windows.nsis.installMode = currentUser`, compilación de release con `RUSTFLAGS=-C target-feature=+crt-static` desde `scripts/build-release.ps1` y `downloadBootstrapper` (necesita internet al instalar solo si WebView2 falta, y Windows 11 lo trae).

Medido el 2026-10-18 en esta máquina: el ejecutable de release importa solo DLL del sistema (`dumpbin /dependents`: sin `VCRUNTIME140.dll` ni `VCRUNTIME140_1.dll`; el de depuración sí), pesa 10,6 MiB y el instalador 59,8 MiB (55,4 MiB sin el svn incluido); instalado ocupa 260,9 MiB (casi todo `zetaoffice`). La compilación de release con LTO tardó 8,6 minutos. Instalación silenciosa en un perfil aislado (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `ProgramFiles` y `PATH` vacíos), apertura de texto, PDF, docx, audio, vídeo y zip, checkout y commit con el svn incluido contra un repositorio `file:///` (sin Subversion en `PATH` ni en `ProgramFiles`), la ruta configurada que gana, el archivo alterado que se ignora y la desinstalación sin procesos ni archivos sobrantes: 9 de 9 en `installed.e2e.ts`.

El `.cargo/config.toml` con el indicador no se añadió: cambiaría la huella de todas las compilaciones de desarrollo y pruebas (los `target` pesan ~27 GiB) y obligaría a recompilarlas; el indicador vive en el script de release.

### Consequences

- Positiva: sin administrador, sin runtime de Visual C++ y sin dependencia de `PATH`.
- Negativa: el instalador no está firmado (SmartScreen avisará); la decisión de `webviewInstallMode` sigue abierta hasta la máquina limpia; quien compile sin el script obtiene un ejecutable que sí importa `VCRUNTIME140.dll`.
- Neutral: el aislamiento de la verificación parcial no es una máquina limpia (comparte el WebView2 y el registro de esta máquina).

## More Information

[plans/fase-2b-documentos](../../plans/fase-2b-documentos/plan.md) Increments 9 y 10; [instalador de Windows de Tauri](https://v2.tauri.app/es/distribute/windows-installer/). Trampa hallada: con `USERPROFILE` aislado, el shell resuelve `AppData\Roaming` desde ese perfil y la aplicación aborta en el arranque si no existe (`unknown path`), por lo que `verify-installer.ps1` crea `profile\AppData\{Roaming,Local}`.
