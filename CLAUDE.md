# Instrucciones del agente

Este proyecto usa el framework **BossDream**. El flujo detallado y las reglas viven en skills; aqui solo lo esencial.

## Contexto

Core Tenets en @docs/constitution.md. Mapa del sistema en @docs/ARCHITECTURE.md.

## Required Cycle

Tarea no trivial (>1 archivo o >15 lineas netas, decision de arquitectura, ambiguedad, o algo nuevo) → invocar la skill `bossdream` antes de tocar nada. "Done" = gates del `completion.json` en verde con evidencia mostrada, no la palabra "listo" (lo verifica el Stop hook).

## Comentarios

Tolerancia cero. Regla en @.claude/rules/comentarios.md, aplicada de forma determinista por el hook `comment-check`.

## Stack

- **Producto:** dakedaduck svn, cliente SVN de escritorio para Windows (reemplazo funcional de TortoiseSVN). Semilla: propuesta.md. Diseño: plans/fase-1-fundacion/design.md.
- **Backend nativo:** Rust (Tauri 2, toolchain MSVC fijado con rustup override). Capas commands → app → svn; solo Rust lanza svn.exe (SlikSVN 1.14 en C:\Program Files\SlikSvn\bin).
- **Frontend:** Vue 3 (<script setup>) + TypeScript + Vite + Pinia; Monaco para código (carga diferida). Referencia visual: DocuMalia (Claymorphism).
- **Tests:** cargo test (integración con repo real vía svnadmin + file:///), Vitest + Stryker en frontend.
- **Reglas duras:** nunca tauri-plugin-shell hacia el frontend; todo destino pasa por Workspace::resolve (ScopedPath); jamás --force en generadores de scaffold.
- **Entorno SVN de pruebas libre:** la instalación de SVN de esta máquina (SlikSVN, `svnserve` de `.tools/`, auth cache y config de svn del usuario) se instaló solo para este proyecto y no hay repositorios reales ni otro uso. Se puede tocar, romper y llenar de repos/credenciales de prueba sin cuidado especial para encontrar bugs. Autorización del usuario, 2026-10-14; vale solo para SVN en esta máquina.
