# Veredictos del QA Increment/Testing (Fase 1)

Resumen del orquestador. Las salidas crudas de las rondas finales (QA Manager y flow-breaker ronda 6 y 7, verificador) están en `.bossdream-project/agent-outputs/`. Registro de las salidas de los agentes `bossdream-qa-planner` y `bossdream-flow-breaker`, ronda por ronda. Insumos de la ronda final: `test-inventory.json` (validador `pass`) y `test-checks-10.json`.

## QA Manager (`bossdream-qa-planner`)

| Ronda | Veredicto | Razones literales (resumen) | Remediación |
|---|---|---|---|
| 1 | REJECTED | 6 mutantes vivos en frontend; evidencia insuficiente | Pruebas nuevas en project/workspace/svnLabels |
| 2 | REJECTED | Mutantes `wasCancelled`/`progressLines` en resetFeedback y en la detección de `workspace.ts`; nombres de evento `svn://progress`/`svn://done` sin compararse con Rust; Stryker `thresholds.break = 0` | `feedback reset` en project.test.ts, `contract.test.ts`, `break: 85` |
| 3 | REJECTED | `mocks_riesgosos`, `assertions_debiles` y `evidence` del inventario obsoletos y contradictorios (188/127 frente a 192/157) | Inventario reescrito |
| 4 | REJECTED | Referencias archivo:línea desplazadas; entrada de `retry` que no coincidía con el código | Referencias de línea eliminadas del inventario |
| 5 | REJECTED | Residuos de referencias numéricas (`svn_layer.rs-428`, `app_state.rs, 748, 758`) y la entrada de `retry` seguía | Residuos y entrada eliminados |
| 6 | ACCEPTED | `QA VERDICT: ACCEPTED` (sin razones); luego el verificador de cierre refutó CA-14 y se remedió | Ver verificador adversarial |
| 7 | **ACCEPTED** | `QA VERDICT: ACCEPTED` (sin razones), tras el mapeo de E215004/E215001 | — |

## Flow-breaker (`bossdream-flow-breaker`)

| Ronda | Veredicto | Razón literal (resumen) | Remediación |
|---|---|---|---|
| 1 | blocked | Primer bloqueo del flow-breaker sobre el flujo checkout/cancelación/cleanup | Remediado junto con la 1ª ronda del QA Manager |
| 2 | blocked | Cleanup fallido ordinario escondía el botón; `svn_detect` con `svn_path` roto no recuperaba; `open()` sin guarda durante una operación | `wc_needs_cleanup` tras cualquier fallo, fallback a `locate(None)`, `open()` ignorado en operación |
| 3 | blocked | `open()` concurrente deja `path` de una copia con `info`/`status` de otra (`project.ts` open/refresh; `ProjectPanel.vue` botón Abrir) | `isReading`/`isLocked`, try/finally, botones deshabilitados, `retry` nulo al completar, `keepWorkingClient` |
| 4 | blocked | Refresh posterior a una operación exitosa sin guarda: Abrir habilitado y `refresh()` sin comprobar la copia | `whileReading(afterOk)` y descarte de lecturas de otra ruta |
| 5 | blocked | `refresh()` manual tardío sobrescribe `info`/`status` tras el `afterOk` de `submit()` | Contador `latestRead`: solo la última lectura iniciada escribe; el snapshot restaura `cleanupTarget` |
| 6 | pass | `VERDICT: pass`. Verificó `refresh()` con `ticket = ++latestRead` y descarte en éxito y error, las pruebas de concurrencia de `project.test.ts` (second open, locked store tras operación, refresh de otra copia, error de refresh de otra copia, refresh manual tardío), bloqueo de Refrescar/Abrir/acciones con `isLocked` y ausencia de estado incorrecto persistente alcanzable desde la UI. Notas no bloqueantes: texto duplicado de una transición inválida (corregido), reabrir la misma copia limpia la oferta de Cleanup (transitorio), un refresh manual previo a una operación fallida puede sustituir su error (transitorio). | — |
| 7 | **pass** | `VERDICT: pass` tras el mapeo de E215004/E215001 y el Cleanup ante `working_copy_locked` en `refresh()`; sin estados imposibles nuevos. | — |

## Verificador adversarial de cierre (`bossdream-endless-verifier`)

| Pasada | Veredicto | Razón | Remediación |
|---|---|---|---|
| 1 | REFUTADO | CA-14: la autenticación http/https no se reconocía (svn 1.14.2 emite E170013 + E215004, solo se mapeaba E170001). Menores: capability `dialog:default` demasiado amplia, directorio basura `src-tauri/x@` versionado, `refresh()` sin oferta de Cleanup, estado remoto fuera de la UI. | `error.rs` mapea E215004 y E215001; servidor HTTP real de prueba y 3 pruebas `http_server_*` (fallan sin el mapeo); `dialog:allow-open`; `x@` eliminado; Cleanup en `refresh()`; T-14 registrada |
| 2 | **pass** | Salida literal en `.bossdream-project/agent-outputs/endless-verifier-final.txt` | — |

## Justificación de `regression_safety: skipped`

`test-checks.ps1` solo detecta Stryker (frontend) y la etapa informa que no hay herramienta de mutación para `src-tauri/tests`. La mutación se ejecutó aparte, con evidencia en disco:

- Frontend: Stryker, conteos en `.bossdream-project/stryker-summary.json` (≈91 %), `thresholds.break = 85` (`stryker.config.json`). El vivo agregado en la última ronda (`--latestRead` en `refresh`) es equivalente: un contador decreciente también da un ticket único por lectura.
- Rust: `cargo-mutants` sobre `src/app/{workspace,operations,state,svn_locator}.rs` y `src/svn/{runner,error,progress}.rs`: 272 mutantes, 171 atrapados, 96 inviables y 5 vivos (`.bossdream-project/mutants-rust/mutants.out`). Los 5 se cerraron con pruebas nuevas y la re-ejecución sobre `progress.rs` y `error.rs` dio 51 atrapados, 11 inviables y 0 vivos (`.bossdream-project/mutants-rust-recheck/mutants.out`).

## Estados `requires-agent` de `test-checks-10.json`

`quality_approval` y `flow_correctness.flow_breaker` salen `requires-agent` por diseño del script: el juicio semántico lo emiten los dos agentes de este documento, no el script determinista.


## QA Increment Fase 2A (2026-10-16/17)

- QA Manager: REJECTED (pasada 1), REJECTED (pasada 2), ACCEPTED (pasada 3). Informes en `evidence-2a/informes-de-agentes.md`.
- Flow-breaker: blocked por `lista_limpia->fallida`; corregido un bug real (`hasConflict` en sesion fallida).
- Auditor de pruebas: 17 hallazgos, todos tratados con pruebas nuevas.
- Mutacion Rust: sin vivos nombrados salvo `files/mod.rs:38:60` y `sniff.rs:202:17` (equivalentes) y `protocol.rs:48:5` (solo E2E). Stryker 90,74 %.
- Cifras: cargo 528, vitest 1637, E2E 142/142 en la corrida final (3 corridas previas con fallos PDF de causa no verificada, T-26).
- Auditor de evidencia: 9 pasadas; las 9 bloquearon por afirmaciones sin respaldo en archivo que se fueron corrigiendo; la ultima pidio solo cambios de redaccion, aplicados sin una decima auditoria.

# Veredictos del QA Increment/Testing (Fase 2B)

## Estado: BLOQUEADO (2026-10-20)

El Test Checks determinista (`scripts/test-checks.ps1`) no deja pasar `flow_correctness` y por eso no se invocó al QA Manager (`bossdream-qa-planner`), como indica el skill. `code_correctness` y `contract_correctness` pasan; `regression_safety` queda `skipped` porque el script solo detecta Stryker (frontend) y la mutación de Rust se corrió aparte (ver `docs/testing.md`).

| Caso abierto | Por qué sigue sin prueba | Qué lo cierra |
|---|---|---|
| La lectura de un tarball se limita a 4 MiB de entrada y el decodificador xz a 64 MiB | No es observable: una entrada de tar se reconoce con sus primeros 512 bytes | Decisión del usuario: tratarla como regla exenta |
| `write_bytes` vuelve a comprobar que el destino es escribible tras tomar el candado | Haría falta intercalar otro proceso entre las dos comprobaciones | Decisión del usuario: regla exenta |
| El temporal se sincroniza a disco (`sync_all`) antes del renombrado | Solo cambia la durabilidad ante un corte de energía | Decisión del usuario: regla exenta |
| Transición `instalado->maquina-limpia-verificada` | Requiere la máquina o VM limpia con Windows 11 (CA-14) | Evidencia real del usuario según `scripts/e2e/clean-machine-checklist.md` |

Detalle de lo que sí se cerró (99 de 103 casos, 139 pruebas nuevas y tres defectos corregidos) en `.bossdream-project/qa-costly-findings.md`.

**Auditoría de la evidencia (`bossdream-evidence-auditor`):** `VERDICT: pass`. Las cuatro razones citan archivos reales que las respaldan; la auditoría no desbloquea el gate.

## Segunda ronda de la Fase 2B (2026-10-20, tras `qa-run` y las exenciones del usuario)

| Agente | Veredicto | Razón literal (resumen) |
|---|---|---|
| QA Manager (`bossdream-qa-planner`) | **REJECTED** | `Missing flow transition: instalado->maquina-limpia-verificada`; `Evidence insufficient` por `mocks_riesgosos[]` (27) y `assertions_debiles[]` (45) sin cerrar |
| Auditor de pruebas (`bossdream-qa-auditor`) | pass | 20 hallazgos (5 medios), ver `agent-outputs/test-auditor-2b.md` y T-42 |
| Flow-breaker (`bossdream-flow-breaker`) | blocked | `guardando->cerrado` no determinista (T-38); rollback de extracción que ignora borrados parciales (T-39); cierre durante la carga de Office (T-40); búsqueda sin duración y `release()` al cambiar de ruta (T-41). Descartado: 413 en `host.js` (los scripts pesan menos de 1 MB) |

El QA Manager responde expresamente que, aun resueltas las listas, el veredicto no puede ser ACCEPTED sin la prueba en máquina limpia.
