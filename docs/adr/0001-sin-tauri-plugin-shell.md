---
status: accepted
date: 2026-10-12
deciders: [usuario]
---

# 0001. Solo Rust lanza svn.exe; sin tauri-plugin-shell

## Context and Problem Statement

El frontend necesita operaciones SVN. Exponer un shell al frontend abriría inyección de comandos (propuesta §117).

## Considered Options

- `tauri-plugin-shell` expuesto al frontend
- Commands Rust tipados que son los únicos que lanzan `svn.exe`

## Decision Outcome

Elegida: **commands Rust tipados**, porque elimina por diseño la inyección de comandos; el frontend nunca recibe `stdout: string`. Fuente: `plans/fase-1-fundacion/design.md` §1 y `CLAUDE.md` (reglas duras). Todo destino de ruta pasa por `Workspace::resolve` (`ScopedPath`).

### Consequences

- Positiva: superficie de ataque mínima.
- Negativa: cada operación requiere un command tipado propio.
- Neutral: capabilities de Tauri deniegan `fs` al frontend; solo `dialog`.

## More Information

Estado del código al 2026-10-12: solo el scaffold de Tauri (`src-tauri/src/lib.rs`); la regla aún no tiene implementación que verificar.
