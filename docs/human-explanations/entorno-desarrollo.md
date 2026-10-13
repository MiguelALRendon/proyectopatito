---
id: human-entorno-desarrollo
title: Entorno de desarrollo en Windows
type: human-explanation
status: current
source: user
last_verified: 2026-10-12
symbols: []
related: [concept-decisiones-stack]
---

# Entorno de desarrollo en Windows

Todo lo siguiente viene del usuario (2026-10-12) y describe su máquina; no está anclado a código.

| Pieza | Estado |
|---|---|
| SlikSVN 1.14.2 | Instalado con winget en `C:\Program Files\SlikSvn\bin` (`svn.exe`, `svnadmin.exe`). **No está en el PATH.** |
| PowerShell 7 | Instalado con winget; los hooks de BossDream usan `pwsh`. Requiere reiniciar la sesión de Claude Code. |
| Rust | El toolchain global era GNU y fallaba (`dlltool`). Se fijó MSVC solo para este proyecto con `rustup override`. |

## Lección: no usar `--force` en generadores de scaffold

`create-tauri-app --force` vació la carpeta y borró `propuesta.md` y `plans/`. Regla dura del proyecto: jamás `--force` en carpetas con trabajo existente (ver `CLAUDE.md`).

## Pendientes conocidos

- No existe stack-pack de Rust: el pipeline lleva las etapas `rust-check` y `rust-test` a mano.
- La etapa `unit` fallará hasta que haya tests.
- Monaco puede necesitar `style.vendorExempt`.
