---
id: ref-architecture
title: Arquitectura
type: reference
status: current
source: both
last_verified: 2026-10-12
symbols: [run, AppState]
related: [concept-decisiones-stack, adr-0001]
---

# Arquitectura

## Vista general

**dakedaduck svn**: cliente SVN de escritorio para Windows (reemplazo funcional de TortoiseSVN) sobre Tauri 2 con frontend Vue 3. Ver [decisiones de stack](concepts/decisiones-stack.md).

## Estado real del código (2026-10-13)

`run()` en `src-tauri/src/lib.rs` registra los commands y el plugin `tauri-plugin-dialog`. Backend:

| Módulo | Contenido | Pruebas |
|---|---|---|
| `src-tauri/src/app/workspace.rs` | `Workspace::new/resolve/revalidate`, `ScopedPath`, `WorkspaceError` | `tests/workspace.rs` |
| `src-tauri/src/app/svn_locator.rs` | `locate`/`locate_in`, `SvnBinary`, `SvnVersion`, versión mínima 1.10 | `tests/svn_layer.rs` |
| `src-tauri/src/svn/runner.rs` | `SvnRunner::run` (sin shell, `--non-interactive`, timeout, cancelación, contraseña solo por stdin, el runner agrega `--password-from-stdin`) | `tests/svn_layer.rs`, `tests/svn_smoke.rs` |
| `src-tauri/src/svn/error.rs` | `SvnError`, `SvnErrorKind` por código `E######`, redacción de contraseñas | `tests/svn_layer.rs` |
| `src-tauri/src/svn/commands.rs` | `InfoRequest`, `StatusRequest` (args de `svn`; `peg_safe` agrega `@` final a las rutas) | `tests/svn_read.rs` |
| `src-tauri/src/svn/models.rs`, `parsers.rs` | `InfoEntry`, `StatusReport`, `StatusItem` y parsers de `svn info/status --xml` (fixtures reales en `tests/fixtures/`) | `tests/svn_read.rs` |
| `src-tauri/src/svn/client.rs` | `SvnClient::info/status` tipados | `tests/svn_read.rs` |
| `src-tauri/src/config/mod.rs` | `ConfigStore`/`AppConfig` (`config.json` en `app_config_dir`, escritura atómica, JSON corrupto a `config.json.bad`, sin secretos) | `tests/app_state.rs` |
| `src-tauri/src/app/state.rs`, `args.rs`, `error.rs` | `AppState` (workspace, svn, config, operaciones largas con sinks de progreso y fin), DTOs de entrada, `CommandError` por `kind` | `tests/app_state.rs` |
| `src-tauri/src/commands/mod.rs` | 11 `#[tauri::command]` finos y eventos `svn://progress`, `svn://done`; capabilities solo `core:default` y `dialog:default` | sin pruebas propias (wrappers) |
| `src/services/tauri.ts` | Único punto de `invoke()`/`listen()`/diálogo; tipos del contrato; `runOperation` con buffer de eventos que llegan antes del id | `src/services/tauri.test.ts` |
| `src/stores/workspace.ts`, `project.ts` | Pinia: onboarding, copia de trabajo activa, operación en curso, progreso acotado; la contraseña nunca se guarda | `src/stores/*.test.ts` |
| `src/views/`, `src/components/`, `src/composables/`, `src/utils/svnLabels.ts` | `OnboardingView`, `ProjectPanel`, modales, composables de tema/preferencias/confirmación/foco, etiquetas en español | `src/**/*.test.ts` (lógica); UI verificada en navegador |
| `vite.e2e.config.ts`, `tests/e2e/mock-tauri/` | Backend Tauri simulado para verificar la UI en navegador (`npm run dev:e2e`, puerto 1430); no entra al build | n/a |
| `src-tauri/src/svn/commands.rs` (operaciones) | `CheckoutRequest`, `UpdateRequest`, `CommitRequest` (mensaje por archivo UTF-8, `-F`), `CleanupRequest`, `Depth` | `tests/svn_operations.rs` |
| `src-tauri/src/svn/progress.rs`, `message_file.rs` | `parse_progress_line`/`last_revision` (texto en inglés, solo UI), archivo temporal del mensaje de commit | `tests/svn_operations.rs` |
| `src-tauri/src/app/operations.rs` | `Operations` (checkout/update/commit/cleanup sobre `ScopedPath`), `OperationManager` (ids, cancelación, lock por copia de trabajo, marca de cleanup) | `tests/svn_operations.rs` |

Los helpers de prueba con repo real (`svnadmin create` + `file:///`) viven en `src-tauri/tests/common/mod.rs`. El lock se indexa por la ruta de la copia de trabajo: operar sobre una subcarpeta no se serializa contra la raíz.  [VERIFIED]

## Diseño objetivo (Fase 1, aprobado, no implementado)

Fuente: `plans/fase-1-fundacion/design.md` §2 y §4. [USER-ASSERTED]

Capas Rust, dependencia unidireccional `commands → app → svn`; `svn` no conoce Tauri.

| Capa | Responsabilidad |
|---|---|
| `commands/` | `#[tauri::command]` finos: validan, delegan, mapean errores |
| `app/` | workspace, `svn_locator`, operaciones (cola por working copy) |
| `svn/` | `SvnClient`: runner, comandos, parsers XML, modelos, errores |
| `config/` | persistencia JSON sin secretos |

Solo el crate `svn` lanza `svn.exe` ([ADR 0001](adr/0001-sin-tauri-plugin-shell.md)).

## Diagramas C4

- Contexto: @docs/architecture/context.mmd

## Puntos de entrada

- `src-tauri/src/lib.rs` — `run()`, registro de commands.
- `src/main.ts` — arranque del frontend.

## Decisiones

ADRs en @docs/adr/.
