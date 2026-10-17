---
status: proposed
date: 2026-10-14
deciders: [usuario]
---

# 0012. `svn.exe` viaja como recurso del instalador y lo lanza Rust

## Context and Problem Statement

Hoy la aplicación exige que el usuario tenga Subversion instalado. El usuario autorizó empaquetar `svn.exe` en el instalador para que una máquina limpia funcione sin instalar nada más. El ADR-0001 prohíbe `tauri-plugin-shell` hacia el frontend.

## Considered Options

- `bundle.resources` con `svn.exe` y solo las DLL que necesita, localizado por Rust y lanzado como hasta ahora.
- `bundle.externalBin` (sidecar de Tauri).
- No empaquetar y seguir pidiendo la ruta.

## Decision Outcome

Elegida: **recurso del instalador** en `resources/svn/`, con el conjunto mínimo de archivos que determina el spike S4, sus textos de licencia y un `svn.lock.json` con el hash de cada archivo. El localizador de Rust prueba: `svn_path` configurado, **svn empaquetado** (verificando el hash de `svn.exe` contra el lock embebido en la aplicación), carpetas conocidas y `PATH`. Descartadas: `externalBin` se lanza con `tauri-plugin-shell`, que el ADR-0001 prohíbe, y además solo copia un ejecutable y no sus DLL; no empaquetar deja la primera ejecución en una máquina limpia sin cliente. **La versión empaquetada debe ser 1.14.4 o superior**: Subversion 1.14.3 y anteriores en Windows son vulnerables a CVE-2024-45720 (inyección de argumentos por la conversión «best fit», CVSS 8.2), de modo que la SlikSVN 1.14.2 de esta máquina no puede distribuirse; el spike S4 elige una compilación redistribuible (candidata: `Apache-Subversion-1.15.0-x64.zip` de VisualSVN), comprueba su licencia, sus DLL y si trae OpenSSL o BerkeleyDB (con obligaciones de licencia activas: oferta de código fuente y reconocimiento de OpenSSL). Si el binario importa `VCRUNTIME140.dll`, las DLL del runtime se copian de `%VCToolsRedistDir%` (términos de Visual Studio) junto a `svn.exe`.

### Consequences

- Positiva: instalar, abrir y hacer un checkout sin instalar Subversion.
- Negativa: el instalador crece (~13 MB) y hay que mantener actualizada la versión empaquetada; el `svn.exe` queda en una carpeta escribible por el usuario (mismo modelo de amenaza que cualquier `svn.exe` del usuario); la verificación de hash de todo el conjunto detecta corrupción o un conjunto incompleto, no defiende de otro proceso del mismo usuario.
- Neutral: el `svn_path` del usuario sigue teniendo prioridad.
