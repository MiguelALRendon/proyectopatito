# Mutantes no matados y contexto de las corridas (QA Increment 2A)

Esto es razonamiento, no salida de herramienta. Cada punto indica si tiene respaldo en un archivo o no.

## Equivalentes y no testeables

| Mutante | Razon | Respaldo verificable |
|---|---|---|
| `src/app/files/mod.rs:38:60` `\|` -> `^` | Las tres constantes combinadas son `0x1000`, `0x4_0000` y `0x40_0000`: bits disjuntos, por lo que `a \| b == a ^ b`. | `src-tauri/src/app/files/mod.rs:33-38` (constantes y `CLOUD_ATTRIBUTES`). |
| `src/app/sniff.rs:202:17` quitar `bytes: body` en `is_text` | Sin el campo, `is_utf16_text` recibe la muestra con el BOM; el BOM se decodifica como U+FEFF, que no es sustituto ni `'\0'` y ocupa una unidad UTF-16, asi que no cambia la paridad, el truncado ni el filtro de `'\0'`. | Solo razonamiento por lectura de `src-tauri/src/app/sniff.rs:194-235`. Un agente reporto ademas una prueba temporal exhaustiva (BOM x longitudes 0-6 x alfabeto de 8 bytes, hash identico) que se elimino despues: **no hay archivo que lo respalde y no debe tomarse como verificado**. |
| `src/commands/protocol.rs:48:5` `on_request` -> `()` | `UriSchemeContext` y `UriSchemeResponder` no se pueden construir fuera de Tauri. `on_request` es un envoltorio fino sobre `handle()`, que tiene 29 pruebas en `src-tauri/tests/protocol.rs`. | `src-tauri/src/commands/protocol.rs:43-55`, registro en `src-tauri/src/lib.rs:19`, y los campos `pub(crate)` en `tauri-2.11.6/src/app.rs:2455-2472` del registro de cargo. Cobertura real: `tests/e2e/real-app/protocol.e2e.ts` (13 pruebas en verde en `evidence-2a/e2e-final.log`). |
| 3 timeouts de `sniff.rs:256:5` `skip_prolog_item` | Razonamiento (sin archivo de respaldo): el mutante devuelve un slice fijo y el bucle no avanza, asi que la prueba se cuelga; cargo-mutants lo clasifica como TIMEOUT. | `.bossdream-project/mutants-rust-2a-sniff-protocol-3.log` (3 lineas TIMEOUT). |

## Contexto de las corridas (sin archivo de respaldo)

- Las corridas 1 y 2 y la primera de `sniff`/`protocol` terminaron porque Claude Code detuvo el proceso por memoria baja del sistema; esto se supo por avisos del propio programa durante la sesion, no queda en los logs. Por eso esos logs no traen resumen final.
- El equivalente `files/mod.rs:38:60` se excluyo con `--exclude-re 'files/mod.rs:38:60'` en las corridas 2 a 4; la linea de comando esta en el historial de la sesion, no en los logs.
- Las pruebas que mataron los vivos de cada corrida se escribieron entre una corrida y la siguiente. La evidencia nominal de que quedaron atrapados esta en las listas de resultados de cargo-mutants (no en los `.log`, que solo dan conteos): `.bossdream-project/mutants-rust-2a-parte3/previously_caught.txt` (files/mod.rs:268:25, range.rs:3:33, range.rs:4:40), `.bossdream-project/mutants-rust-2a-parte3/caught.txt` (range.rs:117:64, ui_state.rs:147:52, :152:9, :173:47 x2) y `.bossdream-project/mutants-rust-2a-sniff-protocol/mutants.out/caught.txt` (lineas 1-2: sniff.rs:4:34 y sniff.rs:346:55). Los conteos de la repeticion estan en `mutants-rust-2a-parte4.log` (17/17) y `mutants-rust-2a-sniff-protocol-3.log` (2 atrapados).

- En la repeticion de `sniff`/`protocol` (`mutants-rust-2a-sniff-protocol-3.log`) se paso tambien `--exclude-re 'protocol.rs:48:5'` (y `sniff.rs:202:17`, que el filtro no excluyo y por eso reaparece como vivo): el mutante `on_request` se excluye por no ser construible fuera de Tauri, ver la tabla de arriba. Sin archivo de respaldo de la linea de comando.
