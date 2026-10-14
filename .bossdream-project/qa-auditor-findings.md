# Hallazgos del bossdream-qa-auditor (2026-10-14) y su resolución

El auditor reportó 0 críticos, 6 mayores y 10 menores. Estado tras la remediación:

| Hallazgo | Sev. | Resolución |
|---|---|---|
| `operations_time_out_after_one_hour_by_default` comparaba la constante con su literal | mayor | Reescrita: afirma `Operations::new(..).timeout() == OPERATION_TIMEOUT` y `with_timeout` (nuevo getter `timeout()`) |
| contract.test no verificaba los argumentos de `invoke` | mayor | Ahora compara, por comando, las claves pasadas a `invoke` con los parámetros declarados en `commands/mod.rs`; sabotaje `{ request: req }` falla |
| contract.test comparaba el fixture contra una lista escrita a mano | mayor | `ui_requests` en el fixture: Rust las deserializa y `project.test.ts` exige que el store llame a los wrappers con exactamente esos objetos |
| Cancelar: solo la rama afirmativa; botón deshabilitado sin id; confirmación pendiente | mayor | 3 pruebas nuevas en `ProjectPanel.test.ts`; sabotaje de `if (isConfirmed)` falla |
| OnboardingView mostraba éxito aunque la detección fallara (bug de producto) | mayor | Corregido en `workspace.ts` (`detection`) y `SvnVersionNotice.vue` (muestra el error); 4 pruebas nuevas; sabotaje falla |
| Pruebas de kill no comprobaban que el proceso muriera | mayor | El script escribe un marcador a los 3 s; la prueba espera 5 s y exige que no exista. Sabotaje (sin `kill` ni `kill_on_drop`) falla ambas |
| `try_recv().is_err()` no detectaba un lanzamiento | menor | `assert_never_launched` exige `Disconnected` |
| `assert_auth_required` con secreto que nunca se envió | menor | Separado: `auth_error` y la comprobación de fuga solo en la prueba de contraseña equivocada |
| Contraseña retenida en la clausura de reintento | menor | `retry` guarda la petición con `NO_CREDENTIALS` (no observable por prueba; renombrada la prueba a lo que sí verifica) |
| `state_with_workspace(&sandbox())` borraba el TempDir | menor | Sandbox vivo en las 10 pruebas |
| Sleeps de 2 s y 300 ms como sincronización | menor | El hook escribe `started.flag` y la prueba espera el archivo; el sleep de la cola se eliminó |
| Prueba de sonda colgada con cota de 10 s | menor | Cota de 8 s (`PROBE_DEADLINE`) |
| Conflicto sin evento de progreso `Conflicted` real | menor | La prueba captura el progreso y exige `Item{Conflicted}` |
| Paridad de `ProgressAction` y `Depth` | menor | `item_actions` y `depths` en el fixture, `ITEM_ACTIONS`/`CHECKOUT_DEPTHS` exportadas |
| `Io(_)` sin mirar el kind y nombres de Windows sin cubrir | menor | Se exige `NotADirectory`; nuevos rechazos para punto/espacio final, `:` y `C:foo` (bug real: aceptaba `x.`, `x ` y `a.txt:flujo`) |
| Boundary solo buscaba `@tauri-apps/` | menor | También `__TAURI` e `invoke(` |
| Salida de svn localizada | menor | `LANGUAGE=en` forzado en el runner + prueba |
| `operation_waits_while_another_operation_holds...` basada en tiempo | menor | Abierto: T-11 en `docs/TECH_DEBT.md` |
| Credenciales de prueba en el auth cache de svn | menor | Aceptado por ADR 0003 (decisión del usuario: se delega en el auth cache); el SVN de esta máquina es entorno de pruebas libre |
