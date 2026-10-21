---
id: ref-testing
title: Pruebas
type: reference
status: current
source: both
last_verified: 2026-10-16
symbols: [TestRepo, TestServer, FakeSvn, launchApp, seedFixtures, installIpcGate]
related: [ref-architecture, human-entorno-desarrollo, adr-0005, adr-0008]
---

# Pruebas

Regla de la [constitución](constitution.md): una función SVN no se da por soportada hasta confirmar su comportamiento real con `svn.exe` y dejar una prueba reproducible; no hay mocks permanentes donde se pueda probar con un repositorio real.

## Pirámide

| Nivel | Herramienta | Qué cubre | Cómo se corre |
|---|---|---|---|
| Rust: unitarias e integración | `cargo test` | Reglas de rutas, parsers, runner, operaciones, archivos, protocolo, estado de interfaz, cierre de ventana | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Frontend | Vitest (+ happy-dom) | Stores, servicios, composables, componentes, contratos | `npm test` |
| Mutación frontend | Stryker | Calidad de las pruebas de `src/**/*.ts` | `npx stryker run` |
| Mutación Rust | `cargo-mutants` | Calidad de las pruebas de Rust | En el QA Increment (plan 2A, paso 16.1) y al cerrar cada increment de 2B que añade Rust |
| Ventana real | Vitest + `playwright-core` por CDP | La aplicación compilada, su CSP y sus protocolos | `npm run test:e2e` |

### `cargo test` con repositorios reales

Los helpers viven en `src-tauri/tests/common/mod.rs`:

- `TestRepo::create()` localiza un `svn.exe` con `locate(None)` y crea un repositorio con `svnadmin create` (el `svnadmin.exe` de la misma carpeta) bajo un directorio temporal con `ñ` en el nombre; la URL es `file:///...`. Contra `file://` la autenticación no interviene.
- `TestServer::start` lanza un `svnserve` real en `127.0.0.1` con un puerto libre y un usuario con contraseña, para probar autenticación. El binario sale de `.tools/apache-subversion/svnserve.exe` (se baja con `pwsh scripts/fetch-svnserve.ps1`: VisualSVN, Apache Subversion 1.15.0, con hash SHA-256 verificado; `.tools` está ignorado por git) o de la variable de entorno **`SVNSERVE_BIN`**. Sin él las pruebas de autenticación fallan con un mensaje que indica el script ([ADR 0005](adr/0005-password-por-stdin-sin-salto-de-linea.md)).
- `ScriptServer` (`tls_server.ps1`, `http_auth_server.ps1`, con `pwsh`): servidores mínimos para el certificado no confiable y para la respuesta 401 de HTTP.
- `FakeSvn` compila con `rustc` un `svn.exe` falso (versión, salida y código de salida configurables) para probar el localizador y los errores.
- `install_stalling_hook` instala un `pre-commit.bat` lento para probar cancelación y serialización por copia.

Las pruebas de enlaces crean junctions con `mklink /J`. Las que dependen del entorno (symlink que escapa del root, que necesita privilegio, y el nombre corto 8.3 de `.svn`, que necesita un volumen con 8.3) fallan con un mensaje explícito si el entorno no las permite, en vez de pasar en vacío; con `DAKEDADUCK_ALLOW_SKIPPED_ENV_TESTS=1` se saltan y lo dejan en la salida (`--nocapture`). El valor debe ser exactamente `1`.

| Archivo en `src-tauri/tests/` | Cubre |
|---|---|
| `workspace.rs` | `Workspace::resolve` y `revalidate` ([workspace](workspace.md)) |
| `svn_layer.rs`, `svn_smoke.rs` | Runner, errores, redacción, localizador; humo de `svn info --xml` contra un repo real |
| `svn_read.rs` | Parsers con XML real de `tests/fixtures/` y `info`/`status` contra repo real |
| `svn_operations.rs` | Checkout, update, commit, cleanup, cancelación y candado por copia |
| `app_state.rs` | `AppState`, autenticación real contra `svnserve`, capabilities |
| `wc_status.rs` | `wc_status_map`, caché y generaciones |
| `files.rs`, `text_files.rs`, `sniff.rs` | Listado, sondeo, lectura/escritura de texto, clasificación |
| `archive_list.rs`, `archive_extract.rs`, `archive_support/mod.rs` | Comprimidos: zip, tar (y gz) y 7z fabricados por código (zip-slip, absolutas, unidades, reservados, `.svn`, `:`, enlaces, dispositivos, colisiones por mayúsculas, archivo contra carpeta, ruta larga, bombas por razón y por tamaño, cabecera mentirosa, 50 001 entradas, truncados y ruido) más RAR, cifrados y bombas reales grabadas (`tests/fixtures/archives`, con procedencia); los topes se prueban en su borde exacto con `Limits` inyectados; cancelación a mitad de un archivo con un hilo que espera a que haya bytes escritos; destino ocupado por otra operación |
| `office_sniff.rs`, `media_sniff.rs`, `write_bytes.rs` | Office por contenido (renombrados, truncados y hostiles primero), audio, vídeo y comprimidos por firma, y escritura binaria con las reglas de la de texto; los constructores de ZIP, OLE2 y tar están en `tests/common/containers.rs` |
| `protocol.rs`, `range.rs` | Protocolo `workspace-file` y análisis de `Range` |
| `open_external.rs` | Apertura externa con un lanzador falso |
| `ui_state.rs`, `config_dir.rs` | Estado de interfaz y directorio de configuración |
| `closing.rs` | Máquina de estados del cierre, con reloj simulado |
| `contract.rs`, `commands_registry.rs` | Forma de los payloads y registro de commands |

`contract.rs` y `src/services/contract.test.ts` / `src/stores/project.test.ts` leen el mismo `tests/fixtures/contract.json`, de modo que el contrato de Rust y el de TypeScript se comprueban contra los mismos ejemplos.

### Vitest y happy-dom

`vitest.config.ts` usa entorno `node` por defecto y `happy-dom` para `src/views`, algunos composables (`useFocusTrap`, `useModalIsolation`, `useResizablePanel`, `useSelection`, `useWindowClose`) y todo `src/components` y `src/documents`. La cobertura es V8 sobre `src/**/*.{js,ts}`. Limitación conocida: happy-dom no es un DOM fiable para el saneador (con `ALLOWED_TAGS: ['h1']` deja pasar `script`), por eso el corpus XSS corre en la ventana real y `render.test.ts` simula el saneador ([seguridad](security.md#markdown-lista-de-permitidos-y-único-v-html)). `tests/e2e/real-app/harness.test.ts` e `ipcGate.test.ts` prueban el propio arnés y corren con `npm test`.

### Mutación

Stryker (`stryker.config.json`): ejecutor Vitest, `coverageAnalysis: perTest`, umbrales `high` 80, `low` 60 y **`break` 85** (si la puntuación baja de 85 falla). Excluye `src/main.ts`, `src/documents/monaco/**`, `src/documents/pdf/**` (no se pueden probar sin navegador real) y `src/documents/markdown/xssCorpus.ts`. Es la etapa `mutation` de `pipeline.json`.

`cargo-mutants` no tiene configuración en el repositorio: se corre en el QA Increment y sus salidas se guardan en `.bossdream-project/mutants-rust*`. Necesita `svn`, `svnadmin` y `SVNSERVE_BIN` porque ejecuta toda la suite.

Increment 3 (2B), sobre `media.rs`, `office.rs`, `inspect.rs` y `compressed_tar.rs`: 197 mutantes, 170 muertos, 24 inviables y 1 equivalente (`INPUT_LIMIT_BYTES` con `4 + 1024 * 1024`: flate2 rechaza cabeceras gzip de más de 64 KiB y bzip2/xz no producen salida con tanta entrada, así que ninguna entrada real distingue 1 MiB de 4 MiB). Con `-j 4` cada worker copia `target` (~10 GB): usa `-j 2` y borra `%TEMP%\cargo-mutants-*.tmp` si se corta por falta de disco.

Increment 7 (2B), sobre `src/app/archive/**` con `--lib --test archive_list --test archive_extract`: 277 mutantes; primera pasada 161 muertos, 74 vivos y 42 inviables; tras añadir pruebas, la repetición con `--iterate` mató 67 de los 74. Quedan 7 vivos, todos documentados: `Limited::flush` (`File::flush` no hace nada, equivale a `Ok(())`); tres guardas `is_name_conflict*` forzadas a `true` en `make_directory` y `open_file` (el resto de errores de Workspace no son alcanzables tras `sanitize`, y `create_dir_all` no falla de otra forma con rutas largas porque std usa el prefijo verbatim); `>` por `>=` en el tope de bloque 7z (exige un bloque de exactamente 256 MiB, ~1 min de compresión en debug por un borde que no es contractual); y los brazos `ResourceLimit` y `Cancelled` de `map_error` en RAR (caen en `Corrupt`; provocarlos exige un RAR fabricado a mano y la cancelación llega por `Interrupt`, no por la biblioteca). Cifra final: 228 muertos de 235 viables (97 %). Usa `--in-place` (no admite `-j`) y `--output` fuera del repo.

E2E de comprimidos (`archive.e2e.ts`, 13 pruebas): los archivos se fabrican en `archiveFixtures.ts` (zip con CRC y UTF-8, tar, tar.gz) y se copian los reales de `src-tauri/tests/fixtures/archives` (7z, RAR, cifrado, bomba). La auditoría de accesibilidad vuelca el DOM de la ventana a `%TEMP%\dakedaduck-a11y-snapshots`, se copia a `dist/_a11y`, se sirve con `python -m http.server` y se pasa por el MCP `a11y`.

El fuzz de comprimidos no es una prueba permanente: se hizo con un test temporal dirigido por variables de entorno (`FUZZ_SEED`, `FUZZ_KIND`) que mutaba de 1 a 4 bytes (y a veces truncaba) un archivo válido y ejecutaba listado y extracción, lanzado una vez por proceso para que un aborto se viera como código de salida distinto de cero.

Increment 10 (2B), sobre `svn/locator.rs` y `svn/bundled.rs`: 38 mutantes, 27 muertos, 10 inviables y 1 vivo (`Display` de `SvnVersion`, cerrado con `version_is_displayed_as_dotted_numbers`; segunda pasada sobre `SvnVersion`: 2 muertos, 1 inviable). Corre con `--in-place` (no admite `-j`), prioridad baja y `CARGO_BUILD_JOBS=2`: sin eso la PC se traba.

QA Increment (2B, 2026-10-20), mutación sobre lo que añadió la fase:

| Módulo | Mutantes | Resultado |
|---|---|---|
| `app/archive/*.rs` | 295 | 3 vivos documentados |
| `container.rs`, `compressed_tar.rs`, `inspect.rs`, `media.rs`, `office.rs` y `sniff.rs` hasta la línea 266 | 421 de 505 probados | vivos restantes: todos equivalentes |
| `files/edit.rs` y `zeta_assets.rs` | 74 | 1 vivo equivalente |
| Frontend (Stryker, umbral 85) | n/a | 90,60 % |

- **`qa-run` (modo costoso, 2026-10-20):** de los 103 casos obligatorios del inventario, 99 tienen prueba (Rust, Vitest o Pester) y 4 no: `La lectura de un tarball se limita…` y `write_bytes vuelve a comprobar… después de tomar el candado` y `El temporal se sincroniza (sync_all)…` (no observables desde fuera: equivalentes) y `instalado->maquina-limpia-verificada` (acción del usuario, CA-14). Se escribieron 139 pruebas nuevas (52 de Rust, 75 de Vitest y 12 de Pester) y la ejecución halló tres defectos reales, ya corregidos: el límite de memoria de xz salía como error de E/S y no como límite, la etiqueta de tamaño declarado decía 1 GiB frente a los 4 GiB / 2 GiB reales, y el aviso de la CVE se perdía cuando se ignoraba el paquete incluido. Quedan registradas T-35 a T-37.
- **Pruebas Pester** de los scripts de release (`scripts/tests/*.Tests.ps1`: `bundle-svn.ps1`, `build-release.ps1` y `verify-installer.ps1`, con un `msiexec`, un `npx` y un `ProgramFiles` falsos, sin red salvo un servidor local en loopback): `Invoke-Pester -Path scripts/tests` (Pester 5 o superior).
- **Sin probar:** los 84 mutantes de `sniff.rs` posteriores a la línea 266, porque la PC se reinició a mitad de una corrida de 9 horas (Kernel-Power 41 a la 01:03). Desde entonces las corridas se hacen en tandas de menos de 15 minutos con `--iterate`, `--shard` y prioridad baja.
- **Equivalentes:** `Limited::flush` (`File::flush` no hace nada); `container.rs` 101:42, 135:13, 181 y 240:15 (los tamaños de archivo reales no llegan a los valores donde difieren); `sniff.rs:212` (la BOM decodificada es un carácter válido y no nulo); `compressed_tar.rs` `INPUT_LIMIT_BYTES` (ver arriba); `edit.rs:26` (`|` y `^` coinciden con bits disjuntos).
- **No alcanzables:** `make_directory:153` (guarda de `create_dir_all`; en Windows todo nombre inválido se rechaza antes, en `resolve`) y `check_limits:137` (un bloque 7z de exactamente 256 MiB exigiría fabricar ese archivo).
- **Trampa:** `cargo mutants -- --test x` no corre las pruebas unitarias de `src`; hay que añadir `--lib`, o marca como vivos mutantes que sí se detectan. Un reinicio en mitad de una corrida deja PDB corruptos (`LNK1285`): borrar el `.pdb` y el `.exe` indicados.

Instalador (Increment 9): `scripts/build-release.ps1` genera el instalador en `src-tauri/target-release`; `INSTALLER_PATH=<instalador> npx vitest run --config vitest.e2e.config.ts tests/e2e/real-app/installed.e2e.ts` lo instala con `scripts/e2e/verify-installer.ps1` en un perfil aislado (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `ProgramFiles` y `PATH` vacíos), lanza la aplicación instalada con `start-app.ps1 -ExePath -IsolatedRoot` y la desinstala. La suite completa sobre el release se corre con `E2E_APP_MODE=release` tras `npx tauri build --no-bundle --features e2e-config-dir` con `CARGO_TARGET_DIR=src-tauri/target-e2e`.

### Puertas del pipeline

`pipeline.json` (local, bloqueantes): `build` (`vue-tsc` sobre la aplicación y sobre `tests/e2e`), `rust-check`, `rust-test`, `format` (`npx prettier --check .`), `theme-check`, `unit` (`vitest --coverage`) y `mutation`. Las etapas `e2e` (`npx playwright test`), `integration`, `arch` y `docdrift` están deshabilitadas: los E2E de este proyecto **no** están en el pipeline. `completion.json` exige además el pipeline local, las tareas completas y el veredicto del QA Manager en el QA Increment.

## E2E sobre la ventana real por CDP

[ADR 0008](adr/0008-pruebas-de-ventana-real-por-cdp.md). Se prueba el ejecutable compilado de Tauri, no una página suelta.

| Pieza | Qué hace |
|---|---|
| `scripts/e2e/start-app.ps1` | Con `-Mode debug` o `release` compila si falta (`npx tauri build --debug --no-bundle`, o `--no-bundle --features e2e-config-dir`) con `CARGO_TARGET_DIR=src-tauri/target-e2e`, lanza el ejecutable con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, un perfil de WebView2 temporal y `DAKEDADUCK_CONFIG_DIR`; escribe un archivo de estado con el pid. `-Stop` mata el árbol de procesos y `-CloseWindow` envía `CloseMainWindow`. Se niega a arrancar si el puerto ya responde |
| `scripts/e2e/seed-fixtures.ps1` | Crea un repositorio real con `svnadmin`, un `svnserve` con usuario de prueba, un workspace con una copia de trabajo con todos los estados SVN, una carpeta local, una copia antigua, una copia par, una configuración aislada y archivos de prueba (imágenes, PDF, `.docx`, binarios, Markdown con imágenes y con cargas XSS, un archivo grande); escribe `manifest.json`. `-Stop` detiene su `svnserve` |
| `tests/e2e/real-app/harness.ts` | `launchApp` ejecuta `start-app.ps1`, se conecta con `chromium.connectOverCDP`, instala el registro de `securitypolicyviolation`, registra toda petición a un host que no sea `tauri.localhost`, `ipc.localhost`, `workspace-file.localhost` o `zeta-assets.localhost` (y cualquier respuesta `ERR_BLOCKED_BY_RESPONSE`, anotada con el prefijo `BLOCKED `, en `externalRequests`), falla el arranque si la ventana no está aislada (`crossOriginIsolated`, `SharedArrayBuffer` y memoria compartida) y expone `isolation`, `closeMainWindow`, `capture`, `stop` |
| `tests/e2e/real-app/fixtures.ts` | `seedFixtures` / `stopFixtures` sobre un directorio temporal |
| `scripts/e2e/make-office-fixtures.ps1` | Fabrica con `System.IO.Compression` un docx, xlsx, pptx, odt, ods y odp mínimos y válidos (`-OutDir`). Los doc, xls y ppt no se pueden fabricar sin Office: están commiteados en `tests/fixtures/office/legacy/` con su procedencia (generados con ZetaOffice, prueba circular declarada) |
| `tests/e2e/real-app/office-open.e2e.ts` | Abre en la ventana real los nueve formatos (incluidos doc, xls y ppt de `tests/fixtures/office/legacy/`), comprueba tipo (`data-kind`), aislamiento y que el iframe cabe en el panel de la pestaña, macros avisadas, Abrir y Guardar como vetados, un Ctrl+clic sobre un enlace, que sin abrir Office no se pide nada a `zeta-assets`, que un `.docx` falso cae a la tarjeta, y cero peticiones externas y violaciones de CSP |
| `tests/e2e/real-app/media.e2e.ts`, `mediaFixtures.ts` | Reproduce, pausa con el teclado, busca (con `Range`) y muestra la tarjeta ante una pista corrupta, un AVI y ruido con nombre de mp3; la matriz de formatos se graba en `.bossdream-project/media-matrix.json`. Los archivos se fabrican por código (WAV, MP3 de silencio, FLAC en cuatro tramos, AVI y WAV inválidos) o con `MediaRecorder` dentro del WebView (WebM, MP4, MKV) |
| `tests/e2e/real-app/office-edit.e2e.ts`, `officeDriver.ts` | Edita de verdad: por formato (docx, xlsx, pptx, odt, ods, odp y doc heredado) abre, inserta texto por el gancho de pruebas, guarda, cierra, reabre y lee con un lector independiente (`scripts/e2e/read-office-text.ps1` descomprime con .NET). Además Ctrl+S dentro de ZetaOffice, cambio externo (cancelar, sobrescribir, recargar), copia ocupada (error simulado por la compuerta IPC: el bloqueo real de Rust está en `tests/write_bytes.rs`), solo lectura, cierre de pestaña con cambios, ir al explorador y volver, relevo entre dos documentos Office (cancelar, descartar, guardar y continuar) y 10 ciclos de memoria bajo 2,5 GiB |
| `tests/e2e/real-app/office-ui.e2e.ts` | Redimensiona la ventana real por CDP y exige que el hueco entre el iframe y `getContainerWindow().getPosSize()` sea constante en cada tamaño; despacha 38 comandos y URL vetados por UNO y exige que ninguno abra nada |
| `tests/e2e/real-app/webview-boundary.e2e.ts`, `rawCdp.ts` | Intenta salir del WebView por cada canal (`location`, formulario, `target=_blank`, `window.open`, protocolos propios, descarga) y exige que la ventana no cambie; la descarga se prueba con CDP crudo porque Playwright las fuerza. Validada con mutantes manuales en `webview.rs` |
| Compuerta IPC (`ipcGate.ts`, `ipcGate.page.js`) | Script de contexto que envuelve `fetch` a `http://ipc.localhost/<command>` y `chrome.webview.postMessage`: reglas `pass`, `swallow`, `cancel` por command (`setIpcRule`), respuestas falsas (`setIpcFake`) y registro de llamadas por transporte (`ipcCalls`). Se usa para el cierre de ventana, la apertura externa y la tarjeta de «solo en la nube» |
| Capturas | `app.capture(nombre)` guarda `.bossdream-project/screenshots/<nombre>.png` |

`npm run test:e2e` corre `vitest run --config vitest.e2e.config.ts`: archivos `tests/e2e/real-app/**/*.e2e.ts`, tiempo máximo de 120 s por prueba y un archivo a la vez (`fileParallelism: false`, porque comparten el puerto 9333). Cubren el arranque y la CSP (`smoke`), el protocolo (`protocol`), el cierre y el shell (`shell`, `editor-close`), pestañas (`tabs`), explorador y estado SVN (`explorer`, `status`), lectura y edición (`editor-read`, `editor`), visores (`viewers`), la clasificación por contenido (`classify`), el aislamiento (`isolation`) y la tarjeta de binario (`binary`).

El ejecutable de **release** se compila con `--features e2e-config-dir` solo para la prueba de humo; el instalador distribuido se compila sin esa característica.

### Lo que los E2E no cubren

- Diálogos nativos y el marco de la ventana: se controla la interfaz web, no el sistema ([ADR 0008](adr/0008-pruebas-de-ventana-real-por-cdp.md)). El cierre se prueba con `CloseMainWindow`.
- Lanzar la aplicación predeterminada o un ejecutable: ninguna prueba lo hace a propósito; el clic de «Abrir con la aplicación predeterminada» usa una respuesta simulada que no llega a Rust.
- Necesitan pantalla, por eso no entran al pipeline local; son una puerta explícita del QA Increment.
- PDF: JBIG2 con codificación aritmética, símbolos y texto (solo se probó MMR), JPEG 2000 con datos codificados reales (el fixture decodifica un paquete vacío), JPEG progresivo o CMYK y fuentes CFF/Type1 incrustadas (ver [entorno de desarrollo](human-explanations/entorno-desarrollo.md)).
- Capturas y dibujo de ZetaOffice: el lienzo tarda 2 a 5 s en dibujarse después de `opened`; una captura inmediata sale en blanco (la prueba espera `DRAW_SETTLE_MS` antes de pulsar teclas). No se leen píxeles del lienzo (WebGL).
- Playwright por CDP fuerza el comportamiento de descargas y enmascara el manejador de Rust: las descargas se prueban con `rawCdp.ts`.
- **Diferido (2B):** instalar y probar en una máquina limpia, el instalador NSIS con `tauri build` completo (puerta del QA Increment, CA-23 de la 2A), edición y guardado de Office, audio, vídeo y comprimidos. Ver [roadmap](roadmap.md).

### Trampas conocidas del entorno

Están medidas y explicadas en [entorno de desarrollo](human-explanations/entorno-desarrollo.md#cómo-compilar-arrancar-y-probar-la-ventana-real); aquí solo los títulos:

- Sin `custom-protocol` el ejecutable «de producción» carga `localhost:1420`.
- Los paquetes npm de Tauri deben coincidir con las crates.
- `cargo test` y `cargo check` reconstruyen el ejecutable de `src-tauri/target` sin `custom-protocol`; por eso los E2E usan `src-tauri/target-e2e`.
- Dos ejecuciones simultáneas chocan en el puerto 9333; una prueba que falla antes de `app.stop()` deja el ejecutable vivo (`taskkill /PID <pid> /T /F`).
- Tauri pasa todos los commands a `postMessage` si un solo `fetch` falla, y `page.route` no lo ve: de ahí la compuerta IPC.
- El navegador normaliza `..` antes de enviar la petición; un `?` solo existe como `%3F` en un nombre de NTFS.
- Los workers (Monaco, pdf.js) no están bajo la CSP de la página: una violación dentro de uno no llega al evento del documento.
- happy-dom no sirve para validar el saneador de Markdown.
