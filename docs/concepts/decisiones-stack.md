---
id: concept-decisiones-stack
title: Decisiones de stack y alcance inicial
type: concept
status: current
source: both
last_verified: 2026-10-12
symbols: [dakedaduck-svn, com.dakedaduck.svn]
related: [adr-0001, adr-0002, human-entorno-desarrollo]
---

# Decisiones de stack y alcance inicial

## Producto

- Nombre: **dakedaduck svn**. Paquete `dakedaduck-svn`, identificador `com.dakedaduck.svn`. [VERIFIED: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json:5`]
- "Patito" es solo el nombre de la carpeta (`Proyecto Patito`). [USER-ASSERTED]
- Origen: `propuesta.md` (136 secciones), reemplazo completo de TortoiseSVN. Se reconstruyó a mano tras borrarse por accidente; ante diferencias con el original manda la reconstrucción. [USER-ASSERTED]

## Stack

| Capa | Decisión | Anchor |
|---|---|---|
| Shell | Tauri 2 | VERIFIED: `src-tauri/Cargo.toml` |
| Frontend | Vue 3 + TS + Vite + Pinia | VERIFIED: `package.json` (pinia, vitest) |
| Editor de código | Monaco, preferido sobre CodeMirror aunque DocuMalia usa CodeMirror; carga diferida, Fase 7 | VERIFIED: `package.json` (monaco-editor) |
| Motor SVN | Solo Rust lanza `svn.exe`; sin `tauri-plugin-shell` | USER-ASSERTED, ver [adr-0001](../adr/0001-sin-tauri-plugin-shell.md) |
| Tests | `cargo test` con repo real (`svnadmin` + `file:///`), Vitest, Stryker | VERIFIED: `package.json`, `stryker.config.json` |

## Alcance del primer incremento

Fase 1, vertical mínima: Workspace Root, detección de `svn.exe`, `info`, `status`, `checkout`, `update`, `commit`, con tests contra repo real. Diseño completo: `plans/fase-1-fundacion/design.md`. [USER-ASSERTED]

## Referencia visual

DocuMalia (`C:\Users\spook\Downloads\malia-documalia-master`; Vue 3 + Pinia + Tauri 2 + GSAP, Claymorphism). Se reutilizan `tokens.css`, TabBar, ContextMenu, ResizeHandle, BaseModal, ConfirmDialog, WindowTitleBar y composables de persistencia y paneles. No se trae nada del dominio MaliAPI. [USER-ASSERTED]

## Documentación

Los `docs/*.md` de la propuesta (§126) crecen con cada fase. [USER-ASSERTED]
