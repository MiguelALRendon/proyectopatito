# Tech Debt Ledger

> Running register of technical debt found by the `tech-debt` skill. **Advisory only — nothing here blocks a build or a plan.** Update `Status` as items are paid down.
>
> Status values: `open` · `in-progress` · `paid` · `wont-fix`. Effort: `low` · `medium` · `high`.

| ID | Location | Category | Impact | Remediation | Effort | Status |
|----|----------|----------|--------|-------------|--------|--------|
| T-1 | `src-tauri/src/svn/runner.rs` collect/supervise | concurrencia | Un hijo de svn (p. ej. ssh de `svn+ssh`) que herede los pipes cuelga la operación hasta `OPERATION_TIMEOUT` y `kill()` no mata el árbol | Esperar `child.wait()` en paralelo y drenar con timeout; Job Object al soportar `svn+ssh` | medium | open |
| T-2 | `src-tauri/src/app/operations.rs` `OperationManager` | SRP | Tres responsabilidades (cancelación, locks por copia, marca de cleanup) y `needs_cleanup` sin consumidor en producción | Separar en tipos propios; exponer o eliminar `needs_cleanup` | low | open |
| T-3 | `src-tauri/src/app/state.rs` `AppState` | SRP | Mezcla config, workspace, caché de svn y orquestación; DTOs de salida en el mismo módulo | Mover DTOs a `app/dto.rs` con `pub use` | low | open |
| T-4 | `src-tauri/src/app/operations.rs` `revision_of` | robustez | Si `svn info` falla tras un checkout/update exitoso, la operación se reporta como error | Devolver `Option<u64>` y tratar el fallo como revisión desconocida | low | open |
| T-5 | `src-tauri/src/app/state.rs` `svn_binary` | concurrencia | La detección de svn puede bloquear un hilo de tokio hasta 5 s por candidato la primera vez | Poblar la caché en `setup` con `spawn_blocking` | low | open |
| T-6 | `src-tauri/src/svn/message_file.rs` | seguridad | Si la app muere a mitad de un commit queda el mensaje en `%TEMP%` | Limpiar `dakedaduck-commit-*.txt` al arrancar | low | open |
| T-7 | `src-tauri/src/app/operations.rs` lock por ruta | concurrencia | Operar sobre una subcarpeta no se serializa contra la raíz de la copia | Resolver la raíz de la copia antes de tomar el lock | medium | open |
| T-8 | `src/stores/project.ts` | SRP | El store mezcla ciclo de vida de operaciones, buffer de progreso y construcción de DTOs | Extraer builders de request a `services/` | low | open |
| T-9 | `src/composables/useFocusTrap.ts` | pruebas | Sin pruebas unitarias (DOM); solo verificado en navegador | Pruebas con jsdom si se añade al proyecto (hecho el 2026-10-14 con happy-dom: `useFocusTrap.test.ts`, `useModalIsolation.test.ts`) | low | paid |
| T-10 | `src-tauri/tauri.conf.json` | seguridad | `csp` es null | Definir CSP restrictiva cuando entre Monaco (Fase 7) | medium | open |
| T-11 | `src-tauri/tests/svn_operations.rs` `operation_waits_while_another_operation_holds_the_working_copy` | pruebas | La serialización por copia se prueba con una espera de 1 s: en una máquina lenta, quitar el lock podría no detectarse | Observar el orden de ejecución con un `svn.exe` falso que registre inicio y fin | low | open |
| T-12 | `src-tauri/tests/common/mod.rs` hook `pre-commit.bat` | pruebas | El `ping` del hook sobrevive hasta 8 s tras matar el commit y puede dejar basura en `%TEMP%` | Hook que espere un archivo de liberación en vez de `ping` | low | open |
| T-13 | `src-tauri/src/app/operations.rs` marca `dirty` | robustez | La marca de cleanup vive solo en memoria: se pierde al reiniciar y un update exitoso sobre una copia marcada no la limpia | Persistir la marca junto a la copia o consultar `svn status` por bloqueos al abrir | low | open |
| T-14 | `src/views/ProjectPanel.vue` | funcionalidad | La UI siempre pide `wc_status` con `remote=false`: el estado contra el servidor (CA-5) existe en el backend pero no es accesible desde el panel | Añadir un control de estado remoto cuando se rediseñe el panel (Fase 2) | low | open |
