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
| Mutación Rust | `cargo-mutants` | Calidad de las pruebas de Rust | En el QA Increment (plan 2A, paso 16.1) |
| Ventana real | Vitest + `playwright-core` por CDP | La aplicación compilada, su CSP y sus protocolos | `npm run test:e2e` |

### `cargo test` con repositorios reales

Los helpers viven en `src-tauri/tests/common/mod.rs`:

- `TestRepo::create()` localiza un `svn.exe` con `locate(None)` y crea un repositorio con `svnadmin create` (el `svnadmin.exe` de la misma carpeta) bajo un directorio temporal con `ñ` en el nombre; la URL es `file:///...`. Contra `file://` la autenticación no interviene.
- `TestServer::start` lanza un `svnserve` real en `127.0.0.1` con un puerto libre y un usuario con contraseña, para probar autenticación. El binario sale de `.tools/apache-subversion/svnserve.exe` (se baja con `pwsh scripts/fetch-svnserve.ps1`: VisualSVN, Apache Subversion 1.15.0, con hash SHA-256 verificado; `.tools` está ignorado por git) o de la variable de entorno **`SVNSERVE_BIN`**. Sin él las pruebas de autenticación fallan con un mensaje que indica el script ([ADR 0005](adr/0005-password-por-stdin-sin-salto-de-linea.md)).
- `ScriptServer` (`tls_server.ps1`, `http_auth_server.ps1`, con `pwsh`): servidores mínimos para el certificado no confiable y para la respuesta 401 de HTTP.
- `FakeSvn` compila con `rustc` un `svn.exe` falso (versión, salida y código de salida configurables) para probar el localizador y los errores.
- `install_stalling_hook` instala un `pre-commit.bat` lento para probar cancelación y serialización por copia.

Las pruebas de enlaces crean junctions con `mklink /J`; los symlinks solo se prueban si el sistema deja crearlos.

| Archivo en `src-tauri/tests/` | Cubre |
|---|---|
| `workspace.rs` | `Workspace::resolve` y `revalidate` ([workspace](workspace.md)) |
| `svn_layer.rs`, `svn_smoke.rs` | Runner, errores, redacción, localizador; humo de `svn info --xml` contra un repo real |
| `svn_read.rs` | Parsers con XML real de `tests/fixtures/` y `info`/`status` contra repo real |
| `svn_operations.rs` | Checkout, update, commit, cleanup, cancelación y candado por copia |
| `app_state.rs` | `AppState`, autenticación real contra `svnserve`, capabilities |
| `wc_status.rs` | `wc_status_map`, caché y generaciones |
| `files.rs`, `text_files.rs`, `sniff.rs` | Listado, sondeo, lectura/escritura de texto, clasificación |
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

### Puertas del pipeline

`pipeline.json` (local, bloqueantes): `build` (`vue-tsc` sobre la aplicación y sobre `tests/e2e`), `rust-check`, `rust-test`, `format` (`npx prettier --check .`), `theme-check`, `unit` (`vitest --coverage`) y `mutation`. Las etapas `e2e` (`npx playwright test`), `integration`, `arch` y `docdrift` están deshabilitadas: los E2E de este proyecto **no** están en el pipeline. `completion.json` exige además el pipeline local, las tareas completas y el veredicto del QA Manager en el QA Increment.

## E2E sobre la ventana real por CDP

[ADR 0008](adr/0008-pruebas-de-ventana-real-por-cdp.md). Se prueba el ejecutable compilado de Tauri, no una página suelta.

| Pieza | Qué hace |
|---|---|
| `scripts/e2e/start-app.ps1` | Con `-Mode debug` o `release` compila si falta (`npx tauri build --debug --no-bundle`, o `--no-bundle --features e2e-config-dir`) con `CARGO_TARGET_DIR=src-tauri/target-e2e`, lanza el ejecutable con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, un perfil de WebView2 temporal y `DAKEDADUCK_CONFIG_DIR`; escribe un archivo de estado con el pid. `-Stop` mata el árbol de procesos y `-CloseWindow` envía `CloseMainWindow`. Se niega a arrancar si el puerto ya responde |
| `scripts/e2e/seed-fixtures.ps1` | Crea un repositorio real con `svnadmin`, un `svnserve` con usuario de prueba, un workspace con una copia de trabajo con todos los estados SVN, una carpeta local, una copia antigua, una copia par, una configuración aislada y archivos de prueba (imágenes, PDF, `.docx`, binarios, Markdown con imágenes y con cargas XSS, un archivo grande); escribe `manifest.json`. `-Stop` detiene su `svnserve` |
| `tests/e2e/real-app/harness.ts` | `launchApp` ejecuta `start-app.ps1`, se conecta con `chromium.connectOverCDP`, instala el registro de `securitypolicyviolation`, registra toda petición a un host que no sea `tauri.localhost`, `ipc.localhost` o `workspace-file.localhost`, y expone `closeMainWindow`, `capture`, `stop` |
| `tests/e2e/real-app/fixtures.ts` | `seedFixtures` / `stopFixtures` sobre un directorio temporal |
| Compuerta IPC (`ipcGate.ts`, `ipcGate.page.js`) | Script de contexto que envuelve `fetch` a `http://ipc.localhost/<command>` y `chrome.webview.postMessage`: reglas `pass`, `swallow`, `cancel` por command (`setIpcRule`), respuestas falsas (`setIpcFake`) y registro de llamadas por transporte (`ipcCalls`). Se usa para el cierre de ventana, la apertura externa y la tarjeta de «solo en la nube» |
| Capturas | `app.capture(nombre)` guarda `.bossdream-project/screenshots/<nombre>.png` |

`npm run test:e2e` corre `vitest run --config vitest.e2e.config.ts`: archivos `tests/e2e/real-app/**/*.e2e.ts`, tiempo máximo de 120 s por prueba y un archivo a la vez (`fileParallelism: false`, porque comparten el puerto 9333). Cubren el arranque y la CSP (`smoke`), el protocolo (`protocol`), el cierre y el shell (`shell`, `editor-close`), pestañas (`tabs`), explorador y estado SVN (`explorer`, `status`), lectura y edición (`editor-read`, `editor`), visores (`viewers`) y la tarjeta de binario (`binary`).

El ejecutable de **release** se compila con `--features e2e-config-dir` solo para la prueba de humo; el instalador distribuido se compila sin esa característica.

### Lo que los E2E no cubren

- Diálogos nativos y el marco de la ventana: se controla la interfaz web, no el sistema ([ADR 0008](adr/0008-pruebas-de-ventana-real-por-cdp.md)). El cierre se prueba con `CloseMainWindow`.
- Lanzar la aplicación predeterminada o un ejecutable: ninguna prueba lo hace a propósito; el clic de «Abrir con la aplicación predeterminada» usa una respuesta simulada que no llega a Rust.
- Necesitan pantalla, por eso no entran al pipeline local; son una puerta explícita del QA Increment.
- PDF: JBIG2 con codificación aritmética, símbolos y texto (solo se probó MMR), JPEG 2000 con datos codificados reales (el fixture decodifica un paquete vacío), JPEG progresivo o CMYK y fuentes CFF/Type1 incrustadas (ver [entorno de desarrollo](human-explanations/entorno-desarrollo.md)).
- **Diferido (2B):** instalar y probar en una máquina limpia, el instalador NSIS con `tauri build` completo (puerta del QA Increment, CA-23 de la 2A), Office, audio, vídeo y comprimidos. Ver [roadmap](roadmap.md).

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
