# QA Increment — hallazgos qa-run (modo costoso, origen: bossdream.json > qa.mode)

Casos obligatorios de entrada: 25 (20 reglas + 5 transiciones) según `test-inventory-check.ps1`. Resultado de salida: `status: pass`, 0 pendientes. UI: ninguno de los 25 casos es de UI (todos son de backend Rust, red/archivos o frontera de código), por lo que no se usó Playwright; la UI ya se verificó en el Increment 6. Sin base de datos: dbhub no aplica.

| # | Caso (angulo) | Qué se probó | Hallazgo |
|---|---|---|---|
| 1 | symlink fuera de la raíz (regla) | `resolve` con `symlink_dir` real | Rechaza con OutsideWorkspace. Requiere Modo de desarrollador de Windows |
| 2 | SvnError conserva stdout/timestamp (regla) | `from_process` con Captured | OK |
| 3 | orden de búsqueda de locate (regla) | primero de la lista gana; la ruta manual gana a la lista | OK. El orden PATH→TortoiseSVN→SlikSVN→Apache se extrajo a la función pura `search_dirs` (pública) y se prueba completo |
| 4 | TooOld solo si ningún candidato sirve (regla + transición svn_sin_detectar→svn_demasiado_antiguo) | svn.exe falso 1.9.7 solo / seguido de uno 1.14.2 | OK |
| 5 | UpdateRequest -r/--ignore-externals/--username (regla) | args con todo y sin nada | OK |
| 6 | progress E/R/B, Deleting, Replacing (regla) | 5 líneas | OK |
| 7 | timeout marca cleanup (regla + transiciones en_ejecucion→tiempo_agotado, tiempo_agotado→wc_requiere_cleanup) | update con timeout de 1 ms | OK. Cambio de producción: `Operations::with_timeout` (inyección para pruebas) |
| 8 | cleanup fallido no limpia la marca (regla) | cleanup sobre carpeta que no es WC | OK |
| 9 | fallo svn distinto de cancel/timeout no marca (regla) | update sobre carpeta que no es WC | OK |
| 10-12 | start_checkout/commit/cleanup fuera del workspace (regla) | `..\fuera`, sin lanzar nada | OK |
| 13 | start_update contraseña sin usuario (regla) | rechaza y no filtra la contraseña | OK |
| 14 | comando de WC sin svn utilizable → NoSvn (regla) | config con svn_path inexistente | OK |
| 15 | svn_set_path con fallo de guardado (regla) | config bajo un archivo (no carpeta) | OK: binario adoptado y error informado |
| 16 | operación fallida emite done Err (regla) | checkout de URL inexistente | OK: SvnFailed |
| 17 | cleanup libera copia bloqueada E155004 (regla) | commit con hook pre-commit que se atasca, cancelado a los 2 s | OK: update → WorkingCopyLocked, cleanup lo libera, update posterior pasa. Escenario real, sin simular |
| 18 | XML malformado → ParseFailed (regla) | svn.exe falso con `<info><entry` | OK |
| 19 | capabilities solo core:default y dialog:default (regla) | lee `capabilities/` | OK |
| 20 | solo services/tauri.ts importa @tauri-apps (regla) | glob de `src/**` | OK. Sabotaje con un import en `src/utils`: la prueba falla como debe |
| 21 | copia_modificada→copia_en_conflicto (transición) | dos copias editan la misma línea, update | OK: StatusItem::Conflicted |
| 22 | reintento_con_credenciales→auth_required (transición) | svn.exe falso responde E170001 dos veces con contraseñas distintas | OK. Límite: es un svn falso, no un servidor real (SlikSVN no trae svnserve) |

Pendiente: autenticación contra servidor real (necesita `svnserve.exe`, que no está instalado) y TLS.

Verificación tras los cambios: `cargo test` 160 pruebas en verde (antes 132), `vitest` 82 (antes 80), `cargo clippy -D warnings` limpio.
