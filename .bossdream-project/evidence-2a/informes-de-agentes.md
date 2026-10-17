# Informes de agentes del QA Increment 2A (archivados)

Transcripcion de las salidas de los agentes de la sesion del 2026-10-16/17. Las salidas son texto de modelo, no registros de herramienta; cada hallazgo se enlaza con la prueba del repositorio que lo trata, que SI se puede comprobar.

## Veredictos del QA Manager (`bossdream-qa-planner`)

| Pasada | Veredicto | Razones literales (resumen) |
|---|---|---|
| 1 | REJECTED | Evidencia de ejecucion no registrada; cargo-mutants de los modulos Rust nuevos sin correr; assertions debiles (symlink/8.3, CSP, nul byte, commands_registry); mocks como unico respaldo (DOMPurify, SystemLauncher, cierre de ventana, protocolo, IPC). |
| 2 | REJECTED | `evidence` del inventario afirmaba 527 pruebas y el unico log completo sumaba 507; pruebas posteriores al log; symlink/8.3 sin respaldo en artefacto; `mocks_riesgosos`/`assertions_debiles` sin actualizar. |
| 3 | ACCEPTED | Sin razones. Residuos aceptados: `protocol.rs on_request` solo por E2E, registro de comandos en `run()` solo por E2E, `sniff.rs:202:17` y `files/mod.rs:38:60` equivalentes, 3 timeouts de `skip_prolog_item`. Condicion: no presentar el endurecimiento del arnes E2E como causa raiz resuelta. Limitacion declarada por el agente: solo lectura, no re-ejecuto nada. |

## Flow-breaker (`bossdream-flow-breaker`)

`VERDICT: blocked`: estado imposible, `fallida` alcanzado desde `lista_limpia` (`documents.ts reload()` -> `failLoad`) sin transicion valida declarada.
Tratado en: `.bossdream-project/test-inventory.json` (flujo `documento-abrir-editar-guardar-cerrar`, transiciones `lista_limpia->fallida` y `conflicto_externo->fallida`), pruebas en `src/stores/documents.test.ts` ("si al recargar un documento sin cambios deja de ser editable (%s)..." y "recargar en conflicto un archivo que ya no es texto pasa la sesión a failed") y correccion `src/stores/documents.ts` (`failLoad` pone `hasConflict: false`).
Observaciones no bloqueantes del agente (sin tratar): `lectura_obsoleta` sin transicion entrante en `apertura-de-copia`; `Expirado` destruye la ventana y pierde cambios sin guardar; `rechazado` es dead_end y a la vez tiene retry; retry TLS declarado "sin prueba".

## Auditor de calidad de pruebas (`bossdream-qa-auditor`) y su tratamiento

| # | Hallazgo (ubicacion) | Tratado en |
|---|---|---|
| 1 | `render.test.ts:13` DOMPurify mockeado (alta) | `src/documents/markdown/render.sanitize.test.ts` (DOMPurify real tras `happyDomPurifyShim.ts`) |
| 2 | `render.test.ts:384` promesa de legitimo sin comprobar | mismo archivo, casos positivos (tabla, listas, imagen) |
| 3 | `xssCorpus.test.ts:34` solo valida datos | renombrado como guardia de datos; `render.sanitize.test.ts` recorre el corpus |
| 4 | `noVHtml.test.ts:4` regex de sumideros incompleta | `noVHtml.test.ts` ampliado |
| 5 | `files.rs:517` cloud_only solo caso negativo | `only_a_file_with_the_offline_attribute_is_listed_as_cloud_only` |
| 6 | `protocol.rs:189` io_status sin 403/500 | `io_failures_map_to_403_for_permissions_and_500_for_the_rest` |
| 7 | `files.rs:267` 8.3 sale en verde sin ejercitar | no se cambio la prueba; evidencia `files-symlink-8dot3-nocapture.log`; deuda T-17/T-27 |
| 8 | `ui_state.rs:285` solo `is_err()` | `names_with_streams_trailing_dots_or_device_names_are_rejected` fija el kind |
| 9 | `sniff.rs:146` condiciones juntas | `a_png/gif/webp_header_that_breaks_one_rule_is_binary`, `an_icon_entry_that_breaks_one_rule_is_binary` |
| 10 | `closing.rs:183` instante anterior al plazo | `a_second_close_while_the_page_decides_never_asks_again` usa `CLOSE_TIMEOUT` |
| 11 | `protocol.rs:243` disyuncion 404/400 | `assert_eq!` con 404 |
| 12 | `text_files.rs:441` Workspace(_) generico | fija `ParentTraversal` |
| 13 | `pdf/loader.ts:41` sin pruebas de error/cancelacion | `src/documents/pdf/loader.test.ts` ampliado |
| 14 | `pdfView.test.ts:96` cota en vez de valor | valor exacto |
| 15 | `limits.test.ts:21` cualquier positivo pasa | valores exactos |
| 16 | `registry.test.ts:160` no prueba lo que dice | proveedor nuevo con puntaje mayor |
| 17 | smoke E2E CSP laxa / `commands_registry.rs` sin assertion | `src/services/csp.test.ts`, `every_tauri_command_defined_in_the_commands_module_is_registered_in_run` |
