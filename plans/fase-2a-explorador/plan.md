# Plan — Fase 2A: Explorador

> Producto de `/bossdream-plan`. Referencia: `spec.md` (QUE), `design.md` (COMO, borrador revisado el 2026-10-14). Primer plan de dos de la Fase 2 del roadmap; la 2B (Office con ZetaOffice, audio, vídeo, comprimidos, empaquetado con `svn.exe`) se planea aparte.

## Razon de ser
Convertir el shell mínimo de la Fase 1 en un explorador de archivos con estado SVN, favoritos, vistas, pestañas y editores/visores ligeros, y ejecutar y probar por primera vez la ventana real de Tauri. Hoy el frontend es `OnboardingView` y `ProjectPanel` (escribir una ruta y ver el estado de una copia) y la CSP es `null`.

## Justificacion
Capas `commands → app → svn` y todo destino por `Workspace::resolve` (`CLAUDE.md`, reglas duras); el frontend no recibe `fs` ni shell. Producto = aplicación de Windows autocontenida (decisión del usuario del 2026-10-14). Decisiones y descartes en `design.md` §11.

## Flujo (que / por que)
De adentro hacia afuera y con el riesgo primero: ventana real y arnés de pruebas (I1) → servicio de archivos y su contrato (I2, I3) → protocolo de archivos (I4) → estado SVN (I5) → persistencia de la interfaz (I6) → shell, paneles y cierre (I7) → pestañas (I8) → explorador (I9, I10) → editores y visores (I11 a I14) → documentación (I15) → QA (I16). Cada capa se prueba sobre SVN real y, las de interfaz, sobre la ventana real antes de montar la siguiente.

## Clasificacion
tipo: add-to-flow (extiende `project`, `workspace`, `config`, `commands`, `ProjectPanel`) y new (explorador, pestañas, documentos) · complejidad: large

## Investigacion (research-log)
| Pregunta | Tool/agente | Hallazgo | Como informo el plan |
|---|---|---|---|
| ¿Qué hay reutilizable de DocuMalia? | Explore sobre `C:\Users\spook\Downloads\malia-documalia-master\src` | Existen `TabBar`, `ContextMenu`, `ResizeHandle`, `useResizablePanel`, `TreeItem`, `ExplorerGridView`, `DocumentReader`; no hay favoritos, lista/detalle, multiselección ni persistencia de pestañas; su editor usa CodeMirror y su `TabBar` no tiene arrastre | `design.md` §6 tabla de reutilización; I7 a I10 |
| ¿Existe DocuMalia en la ruta de `propuesta.md`? | Bash | No existe `C:\workspace_miguel`; sí la ruta de `plans/fase-1-fundacion/design.md` | Se usa la ruta real; corrige lo dicho antes |
| ¿Qué estado actual tiene el backend? | Read/Grep de `src-tauri/src`, `package.json`, `tauri.conf.json` | `StatusRequest` solo tiene `target` y `remote`; `AppConfig` solo `workspace_root` y `svn_path`; `InfoEntry` trae `relative_url`, `repository_root`, `working_copy_root`; ventana 800×600 y `csp: null` | I1, I5, I6 |
| ¿Qué fallaría en el contrato y la frontera? | Revisión adversarial (`general-purpose`) sobre `src/services/contract.test.ts` y `boundary.test.ts` | La prueba lee solo `commands/mod.rs`, un `lib.rs` con regex `commands::(\w+),` y solo `import * as gateway from './tauri'` | I2 adapta el gate antes de agregar commands |
| ¿Cómo se sirven archivos grandes en Tauri? | WebSearch + ejemplo `examples/streaming/main.rs` de Tauri | Protocolo propio con `Range` (206/416), firma de `UriSchemeContext` desde v2.0.0-rc.17 | I4 |
| ¿Se pueden fijar COOP/COEP y CSP? | context7 `/websites/tauri_app` | `app.security.csp`, `devCsp` y `headers` en `tauri.conf.json`; `webviewInstallMode` con `offlineInstaller` | I1, I4 |
| ¿Monaco con Vite? | context7 `/microsoft/monaco-editor`; revisión sobre `node_modules/monaco-editor` | `MonacoEnvironment.getWorker` con `?worker`; la 0.57 trae los lenguajes de la lista pero con estructura distinta a la guía | I11 verifica imports |
| ¿Qué pasa con arrastrar en Windows? | Revisión adversarial sobre el esquema de `@tauri-apps/cli` | `dragDropEnabled: false` es necesario para HTML5 drag and drop, pero haría que soltar un archivo del Explorador navegue la ventana y pierda cambios | Se deja el valor por defecto y se reordena con eventos de puntero (I8) |
| ¿`core:window:default` incluye cerrar? | Revisión adversarial sobre `desktop-schema.json` | No incluye `allow-close` ni `allow-destroy` | Cierre interceptado en Rust (I7) |
| ¿Qué versiones de `marked` y `dompurify` hay? | Revisión sobre `node_modules` | `marked` 14.0.0 y `dompurify` 3.4.15 son dependencias exactas de `monaco-editor`; las últimas son `marked` 18.1.1 y `dompurify` 3.4.17 (3.4.16 y 3.4.17 traen correcciones). **Decisión del usuario: fijar las últimas** aunque se dupliquen las copias que trae Monaco | I13 fija `marked` 18.x y `dompurify` ≥ 3.4.17 y verifica el corpus XSS |
| ¿Qué versión de `pdfjs-dist`? | Revisión de paquetes npm | 6.4.299 exige Node ≥ 22.13 (este equipo tiene 23.11.1) y WebView2 reciente (aquí Chrome 155). **Decisión del usuario: fijar 6.4.299** | I13 la fija, declara `engines.node` y la prueba bajo el WebView2 real |
| ¿Qué modo de instalación de WebView2 usa NSIS? | context7 `/websites/tauri_app` | `webviewInstallMode` por defecto es `downloadBootstrapper` (necesita internet solo al instalar; Windows 11 ya trae WebView2); `offlineInstaller` suma ~127 MB. **Decisión del usuario: mantener el valor por defecto en la 2A y decidirlo en la 2B** con la prueba en máquina limpia | I1 lo deja explícito en `tauri.conf.json` |
| ¿Qué pasa con archivos solo en la nube de OneDrive? | Lectura de `design.md` §3 y del escritorio del usuario (bajo OneDrive) | El listado los marca `cloud_only`; abrirlos o consultar el estado puede descargarlos. **Decisión del usuario:** tarjeta «solo en la nube» con el tamaño y botón «Descargar y abrir»; aviso en el panel de la copia si está bajo OneDrive | I9, I10 y I11 |
| ¿Skills aplicables? | `bossdream-document-explorer` ×10 | Solo `test-gen`, `docs-rewrite`, `rules-comentarios` y `theme-first` aplican; lo demás sin skill | `Conexiones` por increment |
| ¿Deuda en lo que se toca? | `tech-debt` + medición | Sin `TODO`; `state.rs` 352 líneas (T-3), `commands/mod.rs` 119, `tauri.ts` 263, `project.ts` 305 (T-8) | Sección «Deuda tecnica» |
| ¿Candidatos a skill nueva? | `tech-debt` sobre los `candidatos_sin_skill` | Servicio de archivos, protocolo, caché de estado, stores, componentes Vue y arnés CDP son piezas de un solo uso, no procesos repetidos | Descartados como falsos positivos: no se crea ninguna skill |

## Impacto cross-flow
| Flujo afectado | Verificado con | ¿Choca? | Mitigacion |
|---|---|---|---|
| `project` store y `ProjectPanel` | Lectura de `src/stores/project.ts` y `src/views/ProjectPanel.vue` | Sí: el formulario de abrir ruta desaparece y el panel pasa a `InfoPanel` | `AppShell` (I7) hospeda `ProjectPanel` sin cambios hasta que I9 lo sustituye por `InfoPanel` alimentado por la raíz de la copia; I9 migra las pruebas |
| `commands/mod.rs` y `lib.rs` | Lectura | Sí: 12 commands planos más ~12 nuevos | Submódulos `commands/files.rs`, `commands/protocol.rs` y gate de contrato adaptado en I2 |
| `config.json` | `src-tauri/src/config/mod.rs` | Sí: se agrega la sección `ui` | `#[serde(default)]` y versión; I6 |
| CSP `null` | `src-tauri/tauri.conf.json` | Sí: Monaco y pdf.js pueden romperse | E2E contra el ejecutable falla con cualquier violación; ajuste mínimo por increment |
| Operaciones de Fase 1 | `OperationManager` | Sí: `fs_write_text` no debe escribir durante update o commit | `WorkingCopyBusy` (I3) |
| Mock de navegador (`tests/e2e/mock-tauri`) | Lectura | Sí: desconocería los commands nuevos | I1 lo retira; el arnés real lo sustituye |

## Deuda tecnica (informativa, NO bloqueante)
Hallazgos de `tech-debt` sobre lo que el plan toca; nada bloquea.
| Ubicacion | Deuda | Impacto | Remediacion | Esfuerzo | ¿Se paga en este plan? |
|---|---|---|---|---|---|
| `src-tauri/tauri.conf.json` | T-10: `csp` null | Alto | CSP real probada contra el ejecutable | medium | Sí (I1, I4, I11, I13) |
| `src/views/ProjectPanel.vue` | T-14: sin estado remoto en la UI | Medio | «Comprobar servidor» con credenciales | low | Sí (I10) |
| `src-tauri/src/app/state.rs` | T-3: `AppState` mezcla responsabilidades (352 líneas) | Medio | Los servicios nuevos viven en módulos propios; `AppState` solo los referencia | low | Parcial: no crece con lógica nueva |
| `src-tauri/src/commands/mod.rs` | 12 commands planos | Medio | Submódulos por dominio | low | Sí (I2) |
| `src/services/tauri.ts` | Archivo único de 263 líneas | Bajo | `filesApi.ts` aparte | low | Sí (I2) |
| `src/stores/project.ts` | T-8: store con tres responsabilidades | Bajo | No se toca más de lo necesario | low | No |
| `src/stores/project.ts` y explorador | Dos caminos de estado (`wc_status` y `wc_status_map`) | Bajo | Unificar al rediseñar el panel | medium | No: se registra como T-15 |
| `tests/e2e/mock-tauri`, `vite.e2e.config.ts` | Mock obsoleto | Bajo | Retirar | low | Sí (I1) |

## Decisiones (opcion elegida vs descartadas)
Ver `design.md` §11 (completo, con alternativas descartadas y razón). Resumen: protocolo propio con `Range` (no asset protocol ni IPC), favoritos y sesión en `config.json` (no `localStorage`), mapa de estados cacheado por copia (no un proceso por fila), CDP sobre el ejecutable de depuración (no `tauri-driver`), cierre de ventana interceptado en Rust (no `onCloseRequested`), Monaco (no CodeMirror), UTF-8 y UTF-16 con la biblioteca estándar (no `encoding_rs`), apertura externa por lista permitida. ADR escritos como propuestos: `docs/adr/0006` protocolo de archivos, `0007` estado de interfaz en `config.json`, `0008` pruebas de ventana real por CDP, `0009` cierre de ventana en Rust; pasan a aceptados cuando se implementan.

## Increments

### Increment 1: Ventana real, arnés E2E y CSP — cubre spec [CA-1, CA-2]
- Justificacion / fuentes: la ventana de Tauri nunca se ejecutó (`docs/TECH_DEBT.md` T-10; `plans/fase-1-fundacion/plan.md` riesgos); todo lo siguiente se verifica sobre ella; `design.md` §8-§9.
- Pasos:
  - [x] 1.1 `src-tauri/tauri.conf.json`: ventana 1280×800 con mínimo 900×600 y `bundle.targets: ["nsis"]` y `bundle.windows.webviewInstallMode` explícito en `downloadBootstrapper` (el modo sin internet se decide en la 2B); `dragDropEnabled` se deja por defecto (desactivarlo haría que soltar un archivo del Explorador navegue la ventana y pierda cambios) — fuente: `src-tauri/tauri.conf.json` (hoy 800×600 y `targets: "all"`) y el esquema de configuración de Tauri; porque: el explorador no cabe en 800×600 y `tauri build` debe ser predecible.
  - [x] 1.2 Directorio de configuración aislable: variable `DAKEDADUCK_CONFIG_DIR` leída solo bajo `cfg(any(debug_assertions, feature = "e2e-config-dir"))` donde `lib.rs::run` construye el `ConfigStore`; la característica de Cargo `e2e-config-dir` habilita la prueba de humo sobre una build de release y el instalador se compila sin ella — fuente: `src-tauri/src/lib.rs`, `src-tauri/src/config/mod.rs`; porque: las pruebas no deben tocar el `config.json` real ni abrir el diálogo nativo, y una variable abierta en release permitiría redirigir `svn_path`.
  - [x] 1.3 `scripts/e2e/seed-fixtures.ps1`: crea con `svnadmin` y `svn` un repositorio y una copia de trabajo de fixtures (texto, md, `.md` binario, png, svg con script, pdf, binario, archivo mayor de 5 MiB, UTF-16, CRLF con BOM, nombres con `#`, `%`, `?`, espacios y `ñ`, `svn:needs-lock`, y archivos modificado, no versionado, faltante, ignorado, bloqueado, en conflicto, reemplazado, externo y de tipo cambiado), un `svnserve` con autenticación (el de `.tools/`) y un Workspace Root temporal, y escribe el `config.json` sembrado; los increments posteriores extienden este script con lo que necesiten — fuente: `src-tauri/tests/common/mod.rs` (helper de repo real); porque: pruebas reproducibles con SVN real.
  - [x] 1.4 `scripts/e2e/start-app.ps1` con modos `dev` y `build`: lanza el ejecutable (`tauri build --debug --no-bundle` por defecto, que usa la CSP real; el modo `release` compila con `--features e2e-config-dir --no-bundle`) con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<puerto>`, `WEBVIEW2_USER_DATA_FOLDER` temporal reutilizable entre relanzamientos y `DAKEDADUCK_CONFIG_DIR`; espera el puerto y detiene con `taskkill /T /F` — fuente: `design.md` §9; supuestos — verificar que WebView2 acepta el puerto desde Tauri y que wry respeta `WEBVIEW2_USER_DATA_FOLDER`.
  - [x] 1.5 Agregar `playwright-core` como devDependency (verificar licencia Apache-2.0), `vitest.e2e.config.ts`, `tests/e2e/tsconfig.json` (el script `build` y la etapa `build` de `pipeline.json` pasan a incluir `vue-tsc -p tests/e2e/tsconfig.json --noEmit`; `tsconfig.node.json` deja de incluir `vite.e2e.config.ts` y suma `vitest.e2e.config.ts`), script `npm run test:e2e`, y `tests/e2e/real-app/harness.ts`: conecta por `connectOverCDP`, registra los listeners (`request`, `console`, `securitypolicyviolation`) y recarga la página para cubrir la primera carga, falla ante peticiones con host fuera de la lista permitida (`tauri.localhost`, `ipc.localhost`, `workspace-file.localhost`, `localhost:1420` solo en `dev`, `blob:`, `data:`) o ante cualquier violación de CSP — fuente: `design.md` §9; porque: CA-2 exige prueba automática.
  - [x] 1.6 CSP y `devCsp` (solo el delta del HMR) en `tauri.conf.json` (paga T-10) — fuente: `design.md` §8 y la [referencia de configuración de Tauri](https://tauri.app/reference/config); porque: seguridad y autocontención.
  - [x] 1.7 `tests/e2e/real-app/smoke.e2e.ts` contra el ejecutable de depuración: (a) primer arranque con directorio de configuración vacío: escribir la carpeta de trabajo en `OnboardingView`, detectar svn, guardar y llegar al panel; (b) arranque con configuración sembrada; (c) cero peticiones externas ni violaciones de CSP — fuente: `src/views/OnboardingView.vue` (tiene inputs de texto); porque: CA-1.
  - [x] 1.8 Retirar `tests/e2e/mock-tauri/`, `vite.e2e.config.ts` y el script `dev:e2e`, y corregir las referencias en `docs/` y `package.json` — fuente: `package.json`; porque: el mock desconocería los commands nuevos y el arnés real lo reemplaza.
  - [x] 1.9 Documentar en `docs/human-explanations/entorno-desarrollo.md` cómo compilar, arrancar y probar la app, con lo medido (puerto, perfil de WebView2, origen de la página) — fuente: `docs/human-explanations/entorno-desarrollo.md`.
  - [x] 1.10 pruebas unitarias — test-gen (resolución del directorio de config: la variable se ignora en release, ruta inválida cae al directorio estándar); solo lógica.
  - [x] 1.11 doc-check — `docs-rewrite`.
- Conexiones: `test-gen` (cita: «adversarial primero, happy path al final»), `docs-rewrite` (modo `--check`), `rules-comentarios` (los `.ps1` también pasan por `comment-check`). Arnés, scripts y CSP sin skill: piezas de un solo uso (`tech-debt`: falso positivo).
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `format`; E2E con `npm run test:e2e` (la etapa `e2e` de `pipeline.json` sigue deshabilitada porque necesita pantalla).
- Criterio de aceptacion: el ejecutable arranca, el arnés lo controla (primer arranque y arranque sembrado), y una petición externa o violación de CSP hace fallar la prueba.
- Verificacion funcional: navegador — ventana real vía CDP: primer arranque, arranque sembrado y ausencia de peticiones externas.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 2: Listado, clasificación y gate de contrato — cubre spec [CA-3, CA-4, CA-9 (detección), CA-13 (clasificación), CA-25 (sondeo sin leer)]
- Justificacion / fuentes: el explorador depende de listar y clasificar de forma segura; el gate de contrato actual falla con el layout planeado (revisión adversarial B3); `design.md` §2, §10.
- Pasos:
  - [x] 2.1 `src-tauri/src/app/sniff.rs`: clasificación por bytes iniciales (`SNIFF_BYTES`): PNG, JPEG, GIF, WEBP, BMP y ICO con campos de cabecera coherentes, PDF, SVG, texto (sin nulos y UTF-8 válido, o BOM UTF-16) o binario; sin constantes mágicas — fuente: `propuesta.md` §40-§41 y `design.md` §7 (falsos positivos de `BM`).
  - [x] 2.2 `src-tauri/src/app/files.rs`: `FileService::list` y `probe` sobre `ScopedPath`; rechaza `.svn` y `_svn` sobre los componentes ya canonicalizados sin distinguir mayúsculas y **no las incluye en el listado** (aunque se pidan ocultos); banderas oculto, solo lectura, enlace, `escapes_workspace` y `cloud_only` (solo metadatos, nunca abre archivos); tope `MAX_LIST_ENTRIES` con `truncated`; `find_wc_root` que sube hasta el Workspace Root — fuente: `src-tauri/src/app/workspace.rs` (`resolve`, `component_keys`) y `design.md` §2 y §4.
  - [x] 2.3 `src-tauri/src/commands/files.rs` (`fs_list`, `fs_probe(path, allow_download)`: un `cloud_only` sin `allow_download` devuelve `kind: cloud` con su tamaño sin leer bytes, CA-25) como `async` con `spawn_blocking`, registro en `src-tauri/src/lib.rs` (con `pub use` en `commands/mod.rs`), DTOs en `app/args.rs` y `CommandErrorKind::NotADirectory` y `ForbiddenPath`; probar en este increment que `generate_handler!` funciona con los re-exports antes de seguir — fuente: `src-tauri/src/commands/mod.rs` (`svn_detect` es el precedente de `spawn_blocking`).
  - [x] 2.4 Adaptar el gate: `src/services/contract.test.ts` lee todos los `commands/*.rs` con `import.meta.glob`, la regex del registro cubre submódulos, recorre también `services/*Api.ts`, mueve a `helpers` los exports que no son commands; `src-tauri/tests/contract.rs` amplía `ALL_KINDS` y `kind_name`; `src/services/boundary.test.ts` sigue exigiendo que solo `tauri.ts` importe `@tauri-apps/*` — fuente: `src/services/contract.test.ts`, `src-tauri/tests/contract.rs`.
  - [x] 2.5 `src/services/filesApi.ts` con los envoltorios de `fs_list` y `fs_probe` y sus tipos — fuente: `design.md` §6.
  - [x] 2.6 Prueba que compara `src-tauri/capabilities/default.json` con la lista esperada (`core:default`, `dialog:allow-open`) — fuente: `src-tauri/tests/app_state.rs` (`the_main_window_capabilities_grant_only_core_default_and_the_folder_dialog`); porque: CA-4.
  - [x] 2.7 pruebas unitarias e integración — test-gen (adversarial primero: `..`, junction y symlink que escapan, `.svn`, `.SVN`, `_svn`, nombre corto 8.3, binario clasificado como texto, firmas falsas `BM`, directorio con más entradas que el tope, ruta que no es directorio, listado que omite `.svn` con ocultos activados, archivo vacío, buffer de 8 KiB que corta un carácter UTF-8, NUL después de los primeros 8 KiB; happy path al final) con filesystem real en `tempfile`.
  - [x] 2.8 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `format`, `unit`.
- Criterio de aceptacion: CA-3 y CA-4 en verde; el gate de contrato pasa con el layout nuevo antes de agregar más commands; ninguna operación acepta una ruta sin `resolve`.
- Verificacion funcional: no aplica: capa Rust y contrato sin UI; la cubren pruebas con filesystem real (la UI las consume desde I9).
- Revision de planeacion: PASO (v2)

### Increment 3: Lectura y escritura de texto — cubre spec [CA-13, CA-15]
- Justificacion / fuentes: abrir y guardar documentos de forma segura; `design.md` §2 (reglas de escritura), revisión adversarial C3, C6.
- Pasos:
  - [x] 3.1 `FileService::read_text`: decodifica UTF-8 (con o sin BOM) y UTF-16 con BOM con la biblioteca estándar; `NotText` si no decodifica; `TooLarge` por encima de `MAX_EDITABLE_BYTES` (5 MiB); devuelve BOM, final de línea dominante, `eol_mixed` y un `version` opaco (longitud y marca de tiempo de 100 ns) — fuente: `design.md` §2; porque: no interpretar binarios como UTF-8 y conservar BOM y EOL.
  - [x] 3.2 `FileService::write_text`: exige archivo existente, regular y sin reparse point; compara `expected_version`; temporal único con `create_new`, `sync_all` y renombrar; responde `FileChanged`, `ReadOnly`, `FileLocked` (renombrado fallido por otro proceso) y `WorkingCopyBusy`: `OperationManager` expone `try_lock_for_write(ruta)`, que toma con `try_lock` el candado de la copia y busca cualquier clave ancestro o descendiente de la ruta (con la raíz de `find_wc_root`), porque el candado se indexa por la ruta del objetivo de la operación (T-7) — fuente: `src-tauri/src/app/operations.rs`; porque: revisión adversarial C6 e I-6.
  - [x] 3.3 `FileService::read_chunk` con tope `HEX_CHUNK` — fuente: `design.md` §2.
  - [x] 3.4 Commands `fs_read_text`, `fs_write_text`, `fs_read_chunk` (binario por respuesta IPC) `async` con `spawn_blocking`, que rechazan con `CloudOnly` un archivo que sigue `cloud_only` (comprobación sin estado, CA-25); nuevos `CommandErrorKind`; contrato compartido y TS en `filesApi.ts` — fuente: `src-tauri/tests/fixtures/contract.json`.
  - [x] 3.5 pruebas unitarias e integración — test-gen (adversarial primero: archivo que cambia entre lectura y escritura, escritura sobre ruta inexistente, sobre carpeta, sobre reparse point, solo lectura, archivo abierto por otro proceso, update en curso, UTF-8 inválido, UTF-16 sin BOM, EOL mixto, BOM conservado, temporal huérfano tras fallo; happy path al final).
  - [x] 3.6 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `format`, `unit`.
- Criterio de aceptacion: CA-13 (texto frente a binario) y CA-15 (escritura atómica, conflicto, copia ocupada, tope) con pruebas en verde.
- Verificacion funcional: no aplica: capa Rust sin UI; verificada con filesystem real (el editor llega en I11 e I12).
- Revision de planeacion: PASO (v2)

### Increment 4: Protocolo `workspace-file` — cubre spec [CA-2, CA-4, CA-17, CA-18, CA-25 (el protocolo rechaza `cloud_only`)]
- Justificacion / fuentes: imágenes y PDF (y en la 2B audio y vídeo) llegan a la ventana sin `fs` ni copias por IPC; `design.md` §3.
- Pasos:
  - [x] 4.1 `src-tauri/src/app/range.rs`: análisis de `Range` (un rango; varios se tratan como no soportados), respuestas 206 y 416, tope `MAX_RESPONSE_BYTES` (206 truncado y 413 para el archivo completo mayor) — fuente: [ejemplo de streaming de Tauri](https://gitverse.ru/githubmirror/tauri/content/dev/examples/streaming/main.rs); porque: lógica pura probable sin Tauri.
  - [x] 4.2 `FileService::open_for_serve(ScopedPath, Option<Range>)` y MIME por `sniff` — fuente: `design.md` §3.
  - [x] 4.3 `src-tauri/src/commands/protocol.rs`: registro de `workspace-file` con `register_asynchronous_uri_scheme_protocol`; quita la barra inicial de `uri.path()`, ruta relativa codificada, `resolve` y `revalidate` por petición; cabeceras `Accept-Ranges`, `Cross-Origin-Resource-Policy: cross-origin` (la 2B aísla la ventana con COEP; sin ella se bloquearía todo recurso del protocolo), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; sandbox`, CORS que refleja `Origin` contra una lista (`http://tauri.localhost` y, solo en depuración, `http://localhost:1420`), `Access-Control-Expose-Headers` y respuesta al `OPTIONS` de preflight con `Access-Control-Allow-Headers: Range` (un rango sufijo `bytes=-N` dispara preflight, según la [especificación de Fetch](https://fetch.spec.whatwg.org/#cors-safelisted-request-header)); 403 fuera del root o en `.svn`, 404 si no existe — fuente: `design.md` §3 y revisión adversarial C11; supuesto — verificar la firma vigente (`UriSchemeContext`). `percent-encoding` pasa de `[dev-dependencies]` a `[dependencies]` porque el handler lo usa en ejecución.
  - [x] 4.4 `filesApi.ts::fileUrl(relativePath)` y ajuste de `img-src` y `connect-src` de la CSP al origen medido — fuente: `design.md` §8.
  - [x] 4.5 `tests/e2e/real-app/protocol.e2e.ts` contra el ejecutable de depuración: una imagen del fixture carga por el protocolo, `Range` responde 206, `..` y `.svn` responden 403, nombres con `#`, `%`, `?`, espacios y `ñ` se sirven bien, y se registra el origen real de la página y del protocolo — fuente: `design.md` §9.
  - [x] 4.6 pruebas unitarias — test-gen (rangos `bytes=0-`, `-N`, `N-M`, fuera de rango, sintaxis inválida, múltiples, tope de respuesta; recorrido de rutas; happy path al final).
  - [x] 4.7 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `format`, `unit`.
- Criterio de aceptacion: CA-4 con el protocolo bajo `resolve` y rangos verificados; origen real documentado; CSP probada contra el ejecutable.
- Verificacion funcional: navegador — ventana real vía CDP: imagen por el protocolo, 206 con `Range`, 403 fuera del root, nombres especiales.
- Revision de planeacion: PASO (v2)

### Increment 5: Estado SVN del explorador — cubre spec [CA-10 (datos)]
- Justificacion / fuentes: cada elemento muestra su estado y las carpetas si contienen cambios sin bloquear la navegación; `design.md` §4; `propuesta.md` §15.
- Pasos:
  - [x] 5.1 `StatusRequest`: agregar `ignored` (`--no-ignore`) y `username` (`--username`, para «Comprobar servidor»), con prueba de construcción de argumentos — fuente: `src-tauri/src/svn/commands.rs` (hoy solo `target` y `remote`); porque: `--non-interactive` devuelve `auth_required` en repositorios privados y hoy `wc_status` no recibe credenciales.
  - [x] 5.2 Parser: leer `@wc-locked`, `<lock>`, `@tree-conflicted`, `@copied` y `@switched` en `parsers.rs::RawWcStatus` y exponerlos en `models.rs`; `StatusItem` ya cubre ignorado, externo, reemplazado y tipo cambiado (`Obstructed`) — fuente: `src-tauri/src/svn/models.rs`, `src-tauri/src/svn/parsers.rs`, `src-tauri/tests/fixtures/`; porque: sin esto «bloqueado» (CA-10) es imposible.
  - [x] 5.3 `src-tauri/src/app/wc_status.rs`: caché por (copia, remoto) con generación, tope `MAX_STATUS_ENTRIES` con `truncated`, `changed_folders` derivado de los ancestros de cada entrada, invalidación explícita; si caduca el tiempo devuelve un error tipado — fuente: `design.md` §4 puntos 2 y 3.
  - [x] 5.4 Command `wc_status_map(wc_root, remote, credentials)` (credenciales por stdin como las demás operaciones) e invalidación al terminar update, commit, cleanup y checkout — fuente: `src-tauri/src/app/state.rs` (finalización de operaciones), `src-tauri/src/commands/mod.rs`.
  - [x] 5.5 TS: tipos en `filesApi.ts` y etiquetas, tono y leyenda en español en `src/utils/svnLabels.ts` (bloqueado, conflicto de árbol, copiado, cambiado de rama; «Obstruido» pasa a «Tipo cambiado») — fuente: `src/utils/svnLabels.ts` (`ITEM_LABELS`); porque: una sola tabla de estados.
  - [x] 5.6 pruebas de integración contra repo real con `svnadmin` — test-gen (modificado, agregado, eliminado, reemplazado, conflicto entre dos copias, no versionado, faltante, ignorado por `svn:ignore`, externo, tipo cambiado, bloqueado con `svn lock`, copiado, remoto con `-u`; happy path al final).
  - [x] 5.7 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `format`, `unit`.
- Criterio de aceptacion: cada estado de §15 producido por svn real y devuelto con su carpeta contenedora; invalidación demostrada.
- Verificacion funcional: no aplica: capa Rust y etiquetas sin UI; verificada con repos reales (la UI llega en I10).
- Revision de planeacion: PASO (v2)

### Increment 6: Estado de interfaz persistente — cubre spec [CA-6, CA-8, CA-11 (persistencia)]
- Justificacion / fuentes: favoritos, sesión de pestañas y vista por carpeta deben sobrevivir al reinicio y validarse; `design.md` §5.
- Pasos:
  - [x] 6.1 `UiState { version, favorites, tabs, active_tab, views }` con rutas relativas al Workspace Root y claves en minúsculas, en `AppConfig` con `#[serde(default)]` y un `deserialize_with` que devuelve el valor por defecto si la sección `ui` tiene forma inválida — fuente: `src-tauri/src/config/mod.rs` (`AppConfig`; `ConfigStore::load` pone en cuarentena todo el archivo si algo no deserializa); porque: un `ui` dañado no debe borrar `workspace_root` ni `svn_path`.
  - [x] 6.2 `src-tauri/src/app/ui_state.rs`: normalización y límites (`MAX_FAVORITES`, `MAX_TABS`, `MAX_VIEWS` con descarte del más antiguo), rechazo de rutas fuera del root, con `..` o en `.svn`; versión desconocida vuelve al valor por defecto — fuente: `design.md` §5.
  - [x] 6.3 Commands `ui_state_get` (cada ruta con `exists`, revalidada contra el root actual) y `ui_state_set`, `async` — fuente: `src-tauri/src/commands/mod.rs`; porque: único camino al `config.json`.
  - [x] 6.4 Contrato compartido y tipos TS en `filesApi.ts` — fuente: `src/services/contract.test.ts`.
  - [x] 6.5 pruebas unitarias e integración — test-gen (JSON corrupto, versión futura, ruta fuera del root, ruta con `..`, límites, favorito inexistente marcado no disponible, cambio de Workspace Root revalida las relativas contra la raíz nueva sin borrarlas, claves que difieren en mayúsculas, `ui` con forma inválida conserva `workspace_root` y `svn_path`; happy path al final).
  - [x] 6.6 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `format`, `unit`.
- Criterio de aceptacion: el estado reabre tras reinicio y nunca persiste una ruta fuera del root.
- Verificacion funcional: no aplica: capa Rust de persistencia sin UI; la cubren pruebas con config real en disco (la UI la usa desde I8 e I10).
- Revision de planeacion: PASO (v2)

### Increment 7: Shell, paneles y cierre de ventana — cubre spec [CA-12 (mecanismo), CA-21, CA-22]
- Justificacion / fuentes: marco de la aplicación sobre el que se montan pestañas, explorador y documentos; `design.md` §6; estudio de DocuMalia.
- Pasos:
  - [x] 7.1 Copiar y adaptar desde DocuMalia `ResizeHandle.vue` y `useResizablePanel.ts` (prefijo `dakedaduck-layout-`) — fuente: `design.md` §6 tabla de reutilización; porque: patrón accesible y probado.
  - [x] 7.2 Tokens de capa (`--z-index-*`) y breakpoints en `src/styles/tokens.css` y `responsive.css` antes de copiar componentes con `z-index` fijo — fuente: `src/styles/tokens.css` (hoy un solo `--z-index-modal`), `CLAUDE.md` (theme-check).
  - [x] 7.3 `components/shell/AppShell.vue`: barra superior con «Mis archivos» y «Marketplace» deshabilitado con aviso, barra lateral y panel inferior redimensionables con tamaños en `localStorage`, zonas para pestañas y contenido; `App.vue` lo monta cuando `workspace.isOnboarded`; hasta I9 la zona de contenido hospeda `ProjectPanel` sin cambios para no perder checkout, update ni commit — fuente: `src/App.vue`.
  - [x] 7.4 Cierre de ventana en Rust: `src-tauri/src/app/closing.rs` y `on_window_event(CloseRequested)` con `prevent_close`, evento `app://close-requested` y command `app_confirm_close`; en el frontend, escucha del evento en `src/services/tauri.ts` y un manejador que por ahora cierra sin pendientes; command `app_frontend_ready` que el frontend invoca al montar (si no llegó, o pasado `CLOSE_TIMEOUT`, Rust cierra directamente) y `app_confirm_close` con `destroy()` o bandera de «confirmado», porque `close()` reentra en `CloseRequested`; el contrato de eventos incluye `app://close-requested` — fuente: `design.md` §6; porque: `core:window:default` no incluye `allow-close`, y así no se amplía ninguna capability (CA-4).
  - [x] 7.5 `vitest.config.ts`: `happy-dom` para `src/components/**`, `src/documents/**` y los composables nuevos (`useResizablePanel`, `useSelection`) — fuente: `vitest.config.ts` (hoy solo `src/views/**` y dos composables); porque: los componentes nuevos fallarían en entorno `node`.
  - [x] 7.6 `tests/e2e/real-app/shell.e2e.ts`: paneles redimensionados que se recuerdan tras relanzar con el mismo perfil de WebView2, «Marketplace» deshabilitado con aviso, y cierre de ventana: el arnés envía `CloseMainWindow` y verifica que la página recibe `app://close-requested` y el proceso sigue vivo hasta confirmar, que cancelar no cierra y que confirmar termina el proceso, y que sin frontend listo cierra directo; además una prueba compara las capabilities con la lista esperada — fuente: `design.md` §9.
  - [x] 7.7 pruebas unitarias — test-gen (`useResizablePanel`: límites, persistencia, teclado; lógica de `closing.rs` por evento sin Tauri; happy path al final).
  - [x] 7.8 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`, `theme-first` (cita: «Todo valor de identidad visual … sale del tema»; reusar token existente antes de crear uno).
- Pipeline del increment: `build`, `format`, `theme-check`, `unit`, `rust-check`, `rust-test`.
- Criterio de aceptacion: CA-21 y CA-22 sobre la ventana real; el evento de cierre llega al frontend, la ventana nunca queda imposible de cerrar y no se agregan permisos.
- Verificacion funcional: navegador — ventana real vía CDP: paneles redimensionados que se recuerdan, Marketplace deshabilitado.
- Revision de planeacion: PASO (v2)

### Increment 8: Pestañas — cubre spec [CA-11, CA-12 (mecanismo)]
- Justificacion / fuentes: documentos y carpetas en pestañas con sesión restaurable; `design.md` §6; DocuMalia `TabBar.vue` y `stores/workspace.ts` (solo el patrón).
- Pasos:
  - [x] 8.1 `components/shell/ContextMenu.vue` + `contextMenuPosition.ts` (de DocuMalia, con separadores y atajos, tokens de capa) y `TabBar.vue` adaptado: reordenar con eventos de puntero, desplazamiento con muchas pestañas, cierre con botón central, ARIA de `tablist` — fuente: `design.md` §6 tabla; revisión adversarial B1.
  - [x] 8.2 `src/stores/tabs.ts`: modelo `{ id, kind, path, title }` donde `path` es la ubicación actual (cada pestaña de carpeta posee su propio estado de explorador, por `tab.id`: historial, selección y vista; entrar en una carpeta navega dentro de la pestaña y la deduplicación solo aplica al abrir desde favoritos, árbol o «abrir en pestaña nueva»; una pestaña `document` muestra un marcador hasta I11), clave de deduplicación en minúsculas, abrir sin duplicar, cerrar, cerrar otras, cerrar a la derecha, reordenar, duplicar, activar, restaurar sesión omitiendo rutas inexistentes con aviso, persistencia con retardo vía `ui_state_set` y vaciado de lo pendiente al evento de cierre — fuente: patrón de pestañas de `stores/workspace.ts` de DocuMalia y `design.md` §5 y §6.
  - [x] 8.3 API de «pestaña sucia» en `tabs` (la suciedad real la reporta `documents` en I12; aquí se prueba con un doble) y consulta del manejador de cierre de I7 a `tabs`; la confirmación con cambios reales se prueba en I12 — fuente: `src/composables/useConfirm.ts`, `src/components/ConfirmDialog.vue`.
  - [x] 8.4 `tests/e2e/real-app/tabs.e2e.ts`: abrir, cerrar, cerrar otras, reordenar arrastrando con ratón real, duplicar y restaurar tras relanzar con el mismo perfil y config — fuente: `design.md` §9; porque: valida `dragDropEnabled: false` y el reorden por puntero.
  - [x] 8.5 pruebas unitarias — test-gen (store de pestañas: duplicados con mayúsculas distintas, cierre y elección de pestaña activa, restauración con rutas inexistentes, reorden; happy path al final).
  - [x] 8.6 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`, `theme-first`.
- Pipeline del increment: `build`, `format`, `theme-check`, `unit`.
- Criterio de aceptacion: CA-11 sobre la ventana real y la API de pestaña sucia probada con un doble.
- Verificacion funcional: navegador — ventana real vía CDP: pestañas, reordenar con el ratón, restaurar tras reinicio.
- Revision de planeacion: PASO (v2)

### Increment 9: Explorador base — cubre spec [CA-5, CA-6 (vistas, filtro, ocultos), CA-7, CA-9, CA-20]
- Justificacion / fuentes: navegar y ver el contenido; `design.md` §4 y §6; `propuesta.md` §9-§10, §14.
- Pasos:
  - [x] 9.1 `src/stores/explorer.ts`: ubicación, historial atrás y adelante, subir, listado, error que conserva la ubicación anterior, selección, orden (carpetas primero), filtro, ocultos desactivados por defecto y vista por carpeta persistida vía `ui_state_set` — fuente: `design.md` §4 y §6.
  - [x] 9.2 `components/explorer/`: `BreadcrumbBar`, `ExplorerToolbar`, `FileGrid` (adaptar `ExplorerGridView.vue` y `treeNavigation.ts` de DocuMalia), `FileList` (lista y detalles con columnas Tipo, Tamaño y Modificado activables; la columna SVN y el orden por estado llegan en I10), `WcHeader` («Working Copy» con repositorio, revisión, raíz y rama de `wc_info` de la raíz; «Carpeta local» si no; con `working_copy_too_old` o `working_copy_locked` muestra `errorGuidance` de `src/utils/svnLabels.ts` en vez de un error genérico) — fuente: `design.md` §4 punto 6 y §6; `propuesta.md` §9-§10, §14.
  - [x] 9.3 `src/composables/useSelection.ts`: selección simple y múltiple, Mayús, Ctrl, flechas, Enter abre, Supr no hace nada, `role=grid` y `aria-multiselectable`, foco visible — fuente: lo que DocuMalia no tiene (informe del estudio); porque: CA-7.
  - [x] 9.4 `InfoPanel`: la raíz de la copia llega desde `fs_list.wc`; `project.open(raíz)` cuando cambia; conserva actualizar, confirmar y cleanup de la Fase 1 (con la copia bloqueada resalta el botón de cleanup); avisa si la copia está bajo una carpeta de OneDrive que consultar el estado puede descargar archivos (CA-25); `CheckoutForm` siempre disponible; `ProjectPanel` pierde el formulario de abrir ruta; migrar `ProjectPanel.test.ts` — fuente: `src/views/ProjectPanel.vue`, `src/stores/project.ts`.
  - [x] 9.5 Abrir una carpeta o un archivo desde el explorador crea o activa la pestaña (`tabs`) — fuente: I8.
  - [x] 9.6 `tests/e2e/real-app/explorer.e2e.ts`: navegar el fixture, cambiar entre cuadrícula, lista y detalles, orden y filtro, selección múltiple con teclado, ruta inexistente conserva la ubicación, la vista se recuerda tras relanzar, `WcHeader` en copia y en carpeta local, una copia de formato antiguo muestra el mensaje de `svn upgrade` (el fixture repite la técnica de `src-tauri/tests/app_state.rs:929-943`: escribir 28 en los bytes 60..64 de `wc.db`; `seed-fixtures.ps1` lo hace con un script de .NET sobre el archivo), acciones del `InfoPanel`. La copia bloqueada no lleva E2E (fabricarla exige un hook que detenga un commit, `src-tauri/tests/svn_operations.rs:677`): su mensaje y el resaltado del botón de cleanup se prueban con un componente y el error simulado — fuente: `design.md` §9.
  - [x] 9.7 Verificación de accesibilidad con el MCP `a11y` (roles de cuadrícula y teclado) — fuente: `CLAUDE.md` global (a11y tras cambios de HTML/ARIA).
  - [x] 9.8 pruebas unitarias y de componentes (happy-dom) — test-gen (historial, orden, filtro, ocultos, selección múltiple, Supr inerte; happy path al final).
  - [x] 9.9 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`, `theme-first`.
- Pipeline del increment: `build`, `format`, `theme-check`, `unit`.
- Criterio de aceptacion: CA-5, CA-6 (vistas, filtro y ocultos; sin árbol, columna SVN ni orden por estado), CA-7, CA-9 (incluidos los mensajes de copia antigua y bloqueada), CA-20 y el aviso de OneDrive de CA-25 sobre la ventana real con SVN real.
- Verificacion funcional: navegador — ventana real vía CDP: navegación, tres vistas, orden y filtro, selección con teclado, cabecera de copia y acciones del panel.
- Revision de planeacion: PASO (v2)

### Increment 10: Árbol, favoritos y distintivos SVN — cubre spec [CA-6 (árbol, columna SVN, orden por estado), CA-8, CA-10 (UI)]
- Justificacion / fuentes: ver el estado de un vistazo y volver rápido a los lugares de trabajo; `design.md` §4; `propuesta.md` §11 y §15.
- Pasos:
  - [x] 10.1 `components/explorer/FileTree.vue` (adaptar `TreeItem.vue`: carga perezosa, flechas, `role=tree`, props en vez de leer el store) — fuente: `design.md` §6 tabla.
  - [x] 10.2 `src/stores/favorites.ts` y `FavoritesSidebar.vue`: agregar con la estrella de la barra, quitar, reordenar con eventos de puntero, renombrar en línea, no disponibles marcados — fuente: `design.md` §5; recorte: sin menú contextual del explorador.
  - [x] 10.3 `SvnStateBadge.vue`, columna SVN y orden por estado, y superposición asíncrona de `wc_status_map` sobre el listado, indicador de carpetas con cambios, aviso si el cálculo falla o caduca — fuente: `design.md` §4.
  - [x] 10.4 Botón «Comprobar servidor» con `remote=true`, reutilizando `CredentialsModal` ante `auth_required` — fuente: `src/components/CredentialsModal.vue`; porque: revisión adversarial C8 y paga T-14.
  - [x] 10.5 Enganches de recarga: `project` llama a `explorer.reload()` (listado y estados, porque update y checkout agregan o quitan archivos) cuando termina update, commit, cleanup o checkout; `documents` (I12) invalida solo los estados tras guardar — fuente: `src/stores/project.ts`; porque: el distintivo debe actualizarse sin refresco por foco.
  - [x] 10.6 `tests/e2e/real-app/status.e2e.ts`: distintivos de cada estado del fixture, carpeta con cambios, favoritos persisten tras relanzar y uno no disponible, árbol perezoso, «Comprobar servidor» contra el `svnserve` con autenticación que arranca `seed-fixtures.ps1` — fuente: `scripts/e2e/seed-fixtures.ps1` (I1), `design.md` §9.
  - [x] 10.7 Verificación de accesibilidad con el MCP `a11y` (árbol, favoritos) — fuente: `CLAUDE.md` global.
  - [x] 10.8 pruebas unitarias y de componentes — test-gen (favoritos: orden, renombrar, no disponibles; superposición de estados; invalidación; happy path al final).
  - [x] 10.9 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`, `theme-first`.
- Pipeline del increment: `build`, `format`, `theme-check`, `unit`.
- Criterio de aceptacion: CA-6 (árbol, columna SVN, orden por estado), CA-8 y CA-10 sobre la ventana real con SVN real.
- Verificacion funcional: navegador — ventana real vía CDP: distintivos, árbol, favoritos que persisten y comprobación del servidor.
- Revision de planeacion: PASO (v2)

### Increment 11: Registro de proveedores, editor de texto (lectura) y tarjeta de binario — cubre spec [CA-2, CA-13, CA-14 (visualización), CA-15 (tope), CA-19 (tarjeta y hexadecimal)]
- Justificacion / fuentes: abrir documentos y tener siempre dónde caer (binario, demasiado grande); `design.md` §7; ADR-0002 (Monaco).
- Pasos:
  - [x] 11.1 `src/documents/registry.ts` y `DocumentHost.vue`: elige proveedor por puntaje a partir de `fs_probe`; sin respuesta o con `TooLarge`, `BinaryCard`; con `kind: cloud` muestra la tarjeta «solo en la nube» (tamaño y botón «Descargar y abrir», que repite `fs_probe` con `allow_download`) — fuente: `design.md` §3 y §7; `propuesta.md` §35 y §42; CA-25.
  - [x] 11.2 `HexViewer.vue` virtualizado (filas de 16 bytes, tramos de `HEX_CHUNK` con `fs_read_chunk`, solo lectura) y `BinaryCard.vue` (tipo, tamaño, MIME) — fuente: `propuesta.md` §41; porque: lo necesitan este increment y el 13 para su caída segura (se movió desde I14 por una dependencia invertida).
  - [x] 11.3 `src/documents/monaco/setup.ts`: `MonacoEnvironment.getWorker` con `?worker`, lenguajes cargados bajo demanda, tema ligado a `useTheme`, fragmento propio para carga diferida — fuente: [guía ESM de Monaco](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md); verificar los imports contra `node_modules/monaco-editor` 0.57 (su estructura difiere de la guía).
  - [x] 11.4 `TextEditor.vue` en modo lectura: búsqueda y reemplazo, minimapa, números de línea, deshacer y rehacer, barra de estado con codificación y fin de línea — fuente: `propuesta.md` §36.
  - [x] 11.5 CSP: primero probar sobre el ejecutable `app.security.dangerousDisableAssetCspModification` para `style-src` (Tauri inyecta nonces y hashes que anulan `'unsafe-inline'`), y dejar la CSP mínima que exigen los workers de Monaco; el E2E sigue sin violaciones — fuente: `design.md` §8.
  - [x] 11.6 Excluir `src/documents/monaco/**` de la mutación en `stryker.config.json` — fuente: `stryker.config.json` (`mutate`); porque: no es probable sin navegador real.
  - [x] 11.7 `tests/e2e/real-app/editor-read.e2e.ts`: abrir un archivo versionado del fixture con resaltado por extensión, un `.md` binario cae a `BinaryCard`, un archivo mayor al tope se ofrece como hexadecimal con lectura por tramos — fuente: `design.md` §9.
  - [x] 11.8 pruebas unitarias — test-gen (puntaje del registro: texto, imagen, pdf, binario, `.md` binario, `TooLarge`; filas del hexadecimal; happy path al final).
  - [x] 11.9 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`, `theme-first`.
- Pipeline del increment: `build`, `format`, `theme-check`, `unit`.
- Criterio de aceptacion: CA-13, CA-14 (visualización), CA-15 (tope), la tarjeta con hexadecimal de CA-19 y la tarjeta «solo en la nube» de CA-25 (E2E con el `kind: cloud` simulado en el componente; la descarga real se prueba a mano en OneDrive), sobre la ventana real sin peticiones externas ni violaciones de CSP.
- Verificacion funcional: navegador — ventana real vía CDP: abrir archivos de varios tipos y ver el proveedor correcto, incluido el hexadecimal.
- Revision de planeacion: PASO (v3)

### Increment 12: Guardado, conflicto y cierre con cambios — cubre spec [CA-12, CA-14, CA-15]
- Justificacion / fuentes: editar sin perder trabajo ni pisar cambios externos; `design.md` §2, §6.
- Pasos:
  - [x] 12.1 `src/stores/documents.ts`: contenido original, `version` de disco, suciedad por pestaña, guardado con `expected_version`, avisa a `tabs` (suciedad) y a `explorer` (invalidar estado) — fuente: `design.md` §2 y §6.
  - [x] 12.2 `TextEditor.vue` editable: Ctrl+S, solo lectura con aviso cuando `ReadOnly`, aviso de final de línea mixto antes de normalizar, diálogo ante `FileChanged` (recargar, sobrescribir, cancelar), mensajes claros para `FileLocked` y `WorkingCopyBusy` — fuente: `src/composables/useConfirm.ts`.
  - [x] 12.3 Cierre de ventana con cambios: el manejador de I7 pide a `documents` el estado pendiente, confirma con `ConfirmDialog` y solo entonces invoca `app_confirm_close`; vacía el `ui_state` pendiente — fuente: `src-tauri/src/app/closing.rs` (I7).
  - [x] 12.4 `tests/e2e/real-app/editor.e2e.ts`: editar y guardar, el distintivo pasa a modificado, cambio externo mientras está abierto muestra el diálogo, CRLF y BOM se conservan, cerrar la pestaña con cambios pide confirmación — fuente: `design.md` §9.
  - [x] 12.5 Cierre de ventana con un documento sucio sobre la ventana real: el arnés envía `CloseMainWindow` (agregado en I7); la página recibe `app://close-requested` y aparece la confirmación, cancelar mantiene el proceso vivo y confirmar lo termina — fuente: `scripts/e2e/`.
  - [x] 12.6 pruebas unitarias — test-gen (store `documents`: guardar, conflicto, suciedad, recarga, solo lectura, EOL mixto; happy path al final).
  - [x] 12.7 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`, `theme-first`.
- Pipeline del increment: `build`, `format`, `theme-check`, `unit`, `rust-check`, `rust-test`.
- Criterio de aceptacion: CA-12, CA-14 y CA-15 sobre la ventana real.
- Verificacion funcional: navegador — ventana real vía CDP: editar, guardar, conflicto externo y confirmación al cerrar pestaña.
- Revision de planeacion: PASO (v2)

### Increment 13: Markdown, imágenes y PDF — cubre spec [CA-16, CA-17, CA-18]
- Justificacion / fuentes: tres de los visores pedidos; `design.md` §7; `propuesta.md` §37, §39, §40.
- Pasos:
  - [x] 13.1 Agregar `marked` 18.x, `dompurify` ≥ 3.4.17 (ambas con versión exacta, aunque Monaco traiga 14.0.0 y 3.4.15: se aceptan las copias duplicadas por las correcciones de seguridad) y `pdfjs-dist` 6.4.299 exacta con `engines.node >= 22.13`; verificar licencias y que el corpus XSS (13.8) pasa con estas versiones — fuente: `node_modules/monaco-editor/package.json`, [documentación de pdf.js](https://github.com/mozilla/pdf.js/blob/master/docs/contents/examples/index.md); decisión del usuario.
  - [x] 13.2 `MarkdownPreview.vue` (idea de `DocumentReader.vue`, no su configuración): `marked` + `DOMPurify` con **lista de permitidos** explícita (`ALLOWED_TAGS` y `ALLOWED_ATTR` mínimos de texto, listas, tablas, código, imágenes y enlaces; `ALLOW_DATA_ATTR: false`; `ALLOWED_URI_REGEXP` sin `data:` ni `javascript:`; sin `style`, `form`, `svg`, `math`), un hook que reescribe las `src` relativas después de sanear, enlaces que no navegan, imágenes relativas reescritas al protocolo, imágenes remotas bloqueadas; prueba que prohíbe `v-html` fuera de este componente — fuente: `design.md` §7; revisión adversarial C4.
  - [x] 13.3 `MarkdownEditor.vue` sobre el editor de I12 con los modos Editor, Vista previa y Dividido (`ResizeHandle` de I7), solo si `probe.kind === 'text'` — fuente: `propuesta.md` §37; `design.md` §7.
  - [x] 13.4 `ImageViewer.vue` (ajustar y 100 %) por el protocolo, SVG como imagen con botón «Ver código» y caída a `BinaryCard` si el `<img>` falla — fuente: `propuesta.md` §40; `design.md` §7.
  - [x] 13.5 `PdfViewer.vue`: worker, cMaps, fuentes estándar y wasm de `pdfjs-dist` empaquetados, lectura por el protocolo con `Range`, paginación y zoom, `maxImageSize` e `isEvalSupported: false`; ajustar `font-src` y, si hace falta, `'wasm-unsafe-eval'` en la CSP — fuente: documentación de pdf.js; supuesto — verificar bajo CSP.
  - [x] 13.6 Excluir `src/documents/pdf/**` de la mutación — fuente: `stryker.config.json`.
  - [x] 13.7 `tests/e2e/real-app/viewers.e2e.ts`: md con imagen relativa y cargas XSS sanitizadas, png y svg con script que no ejecuta, PDF de fixture con número de páginas y zoom — fuente: `design.md` §9.
  - [x] 13.8 pruebas unitarias — test-gen (corpus de cargas XSS contra el saneador —que corre también en la ventana real, porque happy-dom no es un DOM fiable para DOMPurify—, reescritura de URLs, bloqueo de imágenes remotas, intercepción de enlaces; happy path al final).
  - [x] 13.9 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`, `theme-first`.
- Pipeline del increment: `build`, `format`, `theme-check`, `unit`.
- Criterio de aceptacion: CA-16, CA-17 y CA-18 sobre la ventana real sin violaciones de CSP.
- Verificacion funcional: navegador — ventana real vía CDP: Markdown en tres modos, imagen, SVG con script inerte y PDF paginado.
- Revision de planeacion: PASO (v2)

### Increment 14: Apertura externa controlada — cubre spec [CA-19]
- Justificacion / fuentes: último recurso para lo que ningún proveedor abre; `propuesta.md` §41 y §117; `design.md` §7 (apertura externa). La tarjeta y el hexadecimal viven en I11.
- Pasos:
  - [x] 14.1 `fs_open_external` en `src-tauri/src/commands/files.rs` con un `Launcher` inyectable sobre la crate `opener` (verificar licencia): **lista permitida** de extensiones de datos (sin `doc`, `xls`, `ppt`, `rtf`, `csv`, macros, html, svg ni xml), re-sondeo que rechaza la cabecera `MZ`, ruta por `resolve` (que ya rechaza `archivo:flujo`) y error `NotAllowed`; el botón «Abrir con la aplicación predeterminada» en `BinaryCard` — fuente: `design.md` §7; `propuesta.md` §117; porque: una lista de bloqueo siempre olvida alguna extensión.
  - [x] 14.2 pruebas unitarias — test-gen (adversarial primero: `a.pdf.exe`, mayúsculas, espacios y puntos finales, `archivo.txt:flujo`, `.lnk`, `.js`, `.html`, `.svg`, `.xml`, `.docm`, `.doc`, `.csv`, archivo con `MZ` sin extensión, ruta fuera del root; el lanzador falso registra que nunca se invoca; happy path al final).
  - [x] 14.3 `tests/e2e/real-app/binary.e2e.ts`: el botón existe en la tarjeta de un `.docx` del fixture y está ausente o inerte en un archivo no permitido; **ninguna prueba E2E intenta abrir un ejecutable ni lanza la aplicación predeterminada** — fuente: `design.md` §9; revisión adversarial C5.
  - [x] 14.4 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`, `theme-first`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `format`, `theme-check`, `unit`.
- Criterio de aceptacion: CA-19 (botón de último recurso); ningún ejecutable ni script se lanza en ninguna prueba.
- Verificacion funcional: navegador — ventana real vía CDP: el botón solo aparece para formatos permitidos y no se lanza nada.
- Revision de planeacion: PASO (v3)

### Increment 15: Documentación del proyecto — cubre spec [CA-24]
- Justificacion / fuentes: `propuesta.md` §126 pide un conjunto de documentos que solo existe en parte (`docs/ARCHITECTURE.md`, ADR, `TECH_DEBT.md`).
- Pasos:
  - [x] 15.1 `docs/workspace.md`, `docs/security.md`, `docs/svn-integration.md`, `docs/testing.md`, `docs/editors.md` y `docs/roadmap.md` (con las fases 2B a 7) en español, con el formato de `docs/ARCHITECTURE.md` (`source`, `last_verified`, `symbols`) — fuente: `docs/ARCHITECTURE.md`, `propuesta.md` §126-§127.
  - [x] 15.2 Actualizar `docs/ARCHITECTURE.md` con los módulos de la 2A y alinear los ADR 0006 a 0009 (ya escritos en `docs/adr/` como propuestos) con lo que la implementación midió y pasarlos a aceptados — fuente: `design.md` §11.
  - [x] 15.3 `docs/TECH_DEBT.md`: marcar T-10 y T-14 pagadas, agregar T-15 (dos caminos de estado) — fuente: `docs/TECH_DEBT.md`.
  - [x] 15.4 Vaciar `docs/_inbox/notas-iniciales.md` solo si el usuario lo confirma (decisión del usuario, 2026-10-14: no se vacía, se conserva) — fuente: `docs/_inbox/README.md`.
  - [x] 15.5 doc-check — `docs-rewrite`.
- Conexiones: `docs-rewrite` (modo reescritura), `adr-new`.
- Pipeline del increment: `format`.
- Criterio de aceptacion: CA-24; los documentos describen solo lo que existe y marcan lo diferido.
- Verificacion funcional: no aplica: solo documentación.
- Revision de planeacion: PASO (v2)

### Increment 16 (último): QA Increment — cubre spec [CA-1..CA-25]
- Pasos:
  - [x] 16.1 skill `qa-increment` (QA VERDICT: ACCEPTED en la tercera pasada del QA Manager, 2026-10-17; evidencia en `.bossdream-project/qa-increment-evidence.json` y `.bossdream-project/evidence-2a/`; deuda nueva T-26 y T-27; mutantes sin matar: 3 documentados en `evidence-2a/mutantes-justificados.md`): inventario de pruebas, QA Manager, `qa-run` en el modo de `bossdream.json > qa.mode` (`costoso`), Test Critic, re-verificación, mutación de Rust (`cargo-mutants` con `SVNSERVE_BIN`) y de frontend (Stryker).
  - [x] 16.2 Suite E2E completa (`npm run test:e2e`) contra el ejecutable de depuración y contra el de release compilado con `--features e2e-config-dir`, más `tauri build` (sin esa característica) y comprobación de que el instalador NSIS se genera (CA-23). Es una puerta explícita: los E2E no están en `pipeline.json`.
- Conexiones: `qa-increment`, `qa-run`, `bossdream-qa-planner`, `bossdream-qa-auditor`, `flow-test-gen`.
- Pipeline del increment: `test-checks` en verde con veredicto `QA VERDICT: ACCEPTED`.
- Verificacion funcional: no aplica: el QA profundo vive aquí.
