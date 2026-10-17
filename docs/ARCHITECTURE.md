---
id: ref-architecture
title: Arquitectura
type: reference
status: current
source: both
last_verified: 2026-10-16
symbols: [run, AppState]
related: [concept-decisiones-stack, adr-0001, ref-workspace, ref-security, ref-svn-integration, ref-testing, ref-editors, ref-roadmap]
---

# Arquitectura

## Vista general

**dakedaduck svn**: cliente SVN de escritorio para Windows (reemplazo funcional de TortoiseSVN) sobre Tauri 2 con frontend Vue 3. Ver [decisiones de stack](concepts/decisiones-stack.md).

## Estado real del código (2026-10-16)

`run()` en `src-tauri/src/lib.rs` registra los commands y el plugin `tauri-plugin-dialog`. Backend:

| Módulo | Contenido | Pruebas |
|---|---|---|
| `src-tauri/src/app/workspace.rs` | `Workspace::new/resolve/revalidate`, `ScopedPath`, `WorkspaceError` (rechaza `..`, dispositivos, nombres reservados, nombres con punto/espacio final o `:`, symlinks y junctions que escapan, destinos bajo un archivo) | `tests/workspace.rs` |
| `src-tauri/src/app/svn_locator.rs` | `locate`/`locate_in`, `SvnBinary`, `SvnVersion`, versión mínima 1.10 | `tests/svn_layer.rs` |
| `src-tauri/src/svn/runner.rs` | `SvnRunner::run` (sin shell, `--non-interactive`, timeout, cancelación, contraseña solo por stdin, el runner agrega `--password-from-stdin`) | `tests/svn_layer.rs`, `tests/svn_smoke.rs` |
| `src-tauri/src/svn/error.rs` | `SvnError`, `SvnErrorKind` por código `E######`, redacción de contraseñas | `tests/svn_layer.rs` |
| `src-tauri/src/svn/commands.rs` | `InfoRequest`, `StatusRequest` (args de `svn`; `peg_safe` agrega `@` final a las rutas) | `tests/svn_read.rs` |
| `src-tauri/src/svn/models.rs`, `parsers.rs` | `InfoEntry`, `StatusReport`, `StatusItem` y parsers de `svn info/status --xml` (fixtures reales en `tests/fixtures/`) | `tests/svn_read.rs` |
| `src-tauri/src/svn/client.rs` | `SvnClient::info/status` tipados | `tests/svn_read.rs` |
| `src-tauri/src/config/mod.rs` | `ConfigStore`/`AppConfig` (`config.json` en `app_config_dir`, escritura atómica, JSON corrupto a `config.json.bad`, sin secretos); `resolve_config_dir` acepta `DAKEDADUCK_CONFIG_DIR` (ruta absoluta) solo con `debug_assertions` o la característica `e2e-config-dir` | `tests/app_state.rs`, `tests/config_dir.rs` |
| `src-tauri/src/app/state.rs`, `args.rs`, `error.rs` | `AppState` (workspace, svn, config, operaciones largas con sinks de progreso y fin, caché de estado, lanzador inyectable y `file_service`), DTOs de entrada, `CommandError` por `kind` | `tests/app_state.rs` |
| `src-tauri/src/commands/mod.rs` | 13 `#[tauri::command]` finos de workspace y SVN (`workspace_get/set`, `svn_detect`, `svn_set_path`, `wc_info`, `wc_status`, `wc_status_map`, `svn_checkout`, `wc_update`, `wc_commit`, `wc_cleanup`, `op_cancel`, `wc_needs_cleanup`) y eventos `svn://progress`, `svn://done`; reexporta los de `files`, `ui` y `window`, de modo que `run()` registra 26 en total; capabilities solo `core:default` y `dialog:allow-open` | `tests/contract.rs` (forma de los payloads), `tests/commands_registry.rs` y `tests/app_state.rs` |
| `src-tauri/src/commands/files.rs` | `fs_list`, `fs_probe`, `fs_read_text`, `fs_write_text` (un solo `req: WriteTextArgs`), `fs_read_chunk` (respuesta binaria), `fs_can_open_external` y `fs_open_external`; todos `async` con `spawn_blocking`; los de varias palabras en sus parámetros llevan `rename_all = "snake_case"` porque Tauri convierte por defecto a camelCase | `tests/commands_registry.rs`, `tests/contract.rs` |
| `src-tauri/src/app/files/` | `mod.rs`: `FileService::list/probe` solo sobre `ScopedPath`, nunca lista ni abre `.svn`/`_svn` (`ForbiddenPath`), banderas oculto/solo lectura/enlace/`escapes_workspace`/`cloud_only`, tope de entradas con `truncated`, raíz de la copia; `text.rs`: UTF-8/UTF-16, BOM, EOL; `edit.rs`: `read_text` (tope 5 MiB, `NotText` ante NUL o bytes inválidos, versión opaca (longitud + marca de 100 ns + FNV-1a de 64 bits del contenido)), `write_text` (archivo regular existente, `expected_version`, temporal único `*.dd-tmp` (oculto en el listado, con reintento si el nombre existe) + `sync_all` + renombrar; UTF-16 siempre con BOM, `ReadOnly`, `FileLocked`, `WorkingCopyBusy` por `OperationManager::try_lock_for_write`), `read_chunk` (64 KiB); un `cloud_only` se rechaza (`CloudOnly`); `version.rs`: la versión opaca; `external.rs`: apertura externa de último recurso con un `Launcher` inyectable (`SystemLauncher` sobre la crate `opener`), lista permitida `OPENABLE_EXTENSIONS` de 33 extensiones de datos, rechazo de la cabecera `MZ` y `NotAllowed` | `tests/files.rs`, `tests/text_files.rs`, `tests/open_external.rs` |
| `src-tauri/src/commands/protocol.rs`, `src-tauri/src/app/range.rs`, `src-tauri/src/app/files/serve.rs` | Protocolo propio `workspace-file` (`http://workspace-file.localhost/<ruta relativa codificada>`) registrado con `register_asynchronous_uri_scheme_protocol`: `resolve` y `revalidate` por petición, 403 fuera del root o en `.svn`/`_svn`, 404 si no existe, `Range` (206/416, tope de 32 MiB por respuesta, 413 para el archivo completo mayor), CORS con lista de orígenes (nunca `*`), preflight y `Cross-Origin-Resource-Policy: cross-origin`; la lógica vive en `handle`, probable sin Tauri | `tests/protocol.rs`, `tests/range.rs`, `tests/e2e/real-app/protocol.e2e.ts` |
| `src-tauri/src/app/wc_status.rs`, `src-tauri/src/svn/{commands,models,parsers}.rs` | `wc_status_map(req)`: un `svn status --xml` recursivo por copia, cacheado por (copia, remoto) con generación (un `store` con generación vieja se descarta), solo lo que no es normal, `changed_folders` (ancestros de lo no ignorado), tope `MAX_STATUS_ENTRIES` con `truncated`, rutas relativas al Workspace Root; la caché se invalida al terminar update, commit, cleanup y checkout; `StatusRequest` gana `ignored` y `username` (contraseña por stdin); el parser lee `wc-locked`, `tree-conflicted`, `copied`, `switched` y `lock` | `tests/wc_status.rs`, `tests/svn_read.rs` |
| `src-tauri/src/config/ui.rs`, `src-tauri/src/app/ui_state.rs`, `src-tauri/src/commands/ui.rs` | Estado de interfaz persistente en la sección `ui` de `config.json` (favoritos, pestañas, pestaña activa, vista por carpeta) con rutas relativas al Workspace Root y claves en minúsculas; una sección `ui` con forma inválida se lee como valor por defecto y conserva `workspace_root` y `svn_path`; límites (`MAX_FAVORITES` 200, `MAX_TABS` 64, `MAX_VIEWS` 500 con descarte del más antiguo); `ui_state_get` (cada ruta con `exists`, revalidada contra el root actual) y `ui_state_set`; rechaza rutas fuera del root, con `..`, `.svn`/`_svn` | `tests/ui_state.rs`, `tests/contract.rs` |
| `src-tauri/src/app/closing.rs`, `src-tauri/src/commands/window.rs`, `src/composables/useWindowClose.ts` | Cierre de ventana interceptado en Rust (`CloseRequested` con `prevent_close`, evento `app://close-requested`, commands `app_frontend_ready`, `app_hold_close`, `app_cancel_close`, `app_confirm_close` con `destroy()`); si el frontend no está listo o vence `CLOSE_TIMEOUT` (5 s) sin respuesta, Rust cierra directo; una solicitud sostenida (diálogo abierto) se mantiene mientras la página reenvíe `app_hold_close` cada `HOLD_PING_MS` (2 s) y Rust la cierra directo si pasan `HOLD_KEEPALIVE_TIMEOUT` (6 s) sin latido; el frontend registra guards con `registerCloseGuard` y, si uno lanza, pregunta «Cerrar de todos modos» en vez de autorizar el cierre; no se amplían capabilities | `tests/closing.rs`, `src/composables/useWindowClose.test.ts`, `tests/e2e/real-app/shell.e2e.ts` |
| `src/components/shell/`, `src/composables/useResizablePanel.ts`, `src/styles/shell.css` | `AppShell` (barra superior con «Mis archivos» y «Marketplace» deshabilitado con aviso, barra lateral y panel inferior redimensionables con tamaños en `localStorage` bajo `dakedaduck-layout-`), `ResizeHandle` (`role=separator`, flechas, Home/End) y tokens de capa `--z-index-*` | `src/components/shell/*.test.ts`, `tests/e2e/real-app/shell.e2e.ts` |
| `src/stores/tabs.ts`, `src/components/shell/{TabBar,ContextMenu,TabContent}.vue`, `src/composables/{useTabDrag,useTabsSession}.ts` | Pestañas: modelo `{id, kind, path, title}` con clave de deduplicación en minúsculas, abrir sin duplicar, cerrar/otras/a la derecha, duplicar, reordenar con eventos de puntero, API de pestaña sucia con confirmación, restauración de sesión (omite rutas inexistentes con aviso) y persistencia con retardo por `ui_state_set` con vaciado al cerrar la ventana; diseño visual tomado de DocuMalia | `src/stores/tabs.test.ts`, `src/components/shell/*.test.ts`, `tests/e2e/real-app/tabs.e2e.ts` |
| `src/stores/explorer.ts`, `src/components/explorer/`, `src/composables/useSelection.ts`, `src/components/shell/InfoPanel.vue` | Explorador por pestaña de carpeta: ubicación, historial, listado (`fs_list`), error que conserva la ubicación, selección, orden, filtro, ocultos y vista (cuadrícula, lista, detalles) por carpeta persistida por `tabs` (capa única de mezcla del `UiState`); `WcHeader` (repositorio, revisión, raíz y rama; mensajes de copia antigua o bloqueada con `errorGuidance`), selección con teclado (Supr inerte) y `InfoPanel` con acciones de la Fase 1 y aviso de OneDrive; los iconos Solar duotone de DocuMalia (CC BY 4.0, 480 Design) están incrustados en `src/utils/iconPaths.ts` con su atribución | `src/stores/explorer.test.ts`, `src/components/explorer/*.test.ts`, `tests/e2e/real-app/explorer.e2e.ts` |
| `src/components/explorer/{FileTree,FavoritesSidebar,ExplorerSidebar,SvnStateBadge,StatusNotice}.vue`, `src/stores/favorites.ts`, `src/utils/{svnBadges,statusIndex}.ts` | Árbol de carpetas con carga perezosa (`role=tree`), favoritos (estrella, reordenar con puntero, renombrar en línea, no disponibles) persistidos por la API de favoritos de `tabs`, distintivos de estado SVN (forma + color + texto), columna SVN y orden por estado, superposición asíncrona de `wc_status_map` sobre el listado con avisos (`truncated`, error, caducidad) y «Comprobar servidor» (`remote=true`, `CredentialsModal` ante `auth_required`, la contraseña no se guarda); `project` recarga listado y estados al terminar update, commit, cleanup o checkout | `src/stores/{favorites,explorer}.test.ts`, `src/components/explorer/*.test.ts`, `tests/e2e/real-app/status.e2e.ts` |
| `src/documents/{registry,providers,hex,useHexChunks,limits}.ts`, `src/documents/monaco/`, `src/components/documents/{DocumentHost,TextEditor,HexViewer,BinaryCard,CloudOnlyCard}.vue` | Registro de proveedores por puntaje a partir de `fs_probe` (texto ≤ 5 MiB con puntaje 10, binario con puntaje 1; un `.md` binario nunca se interpreta como texto), `DocumentHost` con tarjetas de binario (con el botón «Abrir con la aplicación predeterminada», `OpenExternalButton`) y de «solo en la nube» (sin leer antes de «Descargar y abrir»), visor hexadecimal virtualizado (filas de 16 bytes, tramos de 64 KiB), editor Monaco de solo lectura con carga diferida en su propio fragmento (workers por `?worker`, tema leído de los tokens, sin red) y barra de estado con codificación, BOM y fin de línea; CSP con `worker-src 'self'` sin `'unsafe-eval'` | `src/documents/*.test.ts`, `src/components/documents/*.test.ts`, `tests/e2e/real-app/editor-read.e2e.ts` |
| `src/stores/documents.ts`, `src/components/documents/{TextEditor,EditorNotices}.vue`, `src/components/ChoiceDialog.vue`, `src/composables/useChoice.ts`, `src/documents/dialogs.ts` | Edición y guardado: estado por pestaña de documento (original, versión de disco, texto actual, suciedad, solo lectura, conflicto), guardado con `expected_version` (Ctrl+S o botón), diálogos de tres opciones para conflicto (`FileChanged`: Cancelar, Recargar, Sobrescribir), final de línea mixto y cierre de ventana con cambios (Cancelar, Cerrar sin guardar, Guardar y cerrar); conserva BOM, codificación y EOL; ningún error toca el texto del usuario; `tabs` marca la pestaña sucia y `explorer.refreshStatus` invalida los distintivos | `src/stores/documents.test.ts`, `src/components/documents/TextEditor.test.ts`, `tests/e2e/real-app/{editor,editor-close}.e2e.ts` |
| `src/documents/markdown/`, `src/documents/pdf/`, `src/components/documents/{MarkdownPreview,MarkdownEditor,ImageViewer,PdfViewer}.vue` | Visores: Markdown con `marked` 18.1.1 y DOMPurify 3.4.17 como **lista de permitidos** (único `v-html` del proyecto, con prueba que lo vigila; imágenes relativas reescritas al protocolo tras sanear, remotas bloqueadas, enlaces inertes) y modos Editor/Vista previa/Dividido; imágenes png/jpg/gif/webp/bmp/svg/ico por el protocolo (SVG siempre como `<img>`, nunca inline) con caída a `BinaryCard`; PDF con `pdfjs-dist` 6.4.299 empaquetado en `dist/assets/pdfjs/` (worker propio, cMaps, fuentes y wasm sin CDN), lectura por rangos de hasta 4 MiB y paginación y zoom accesibles; el corpus XSS corre también en la ventana real | `src/documents/markdown/*.test.ts`, `src/components/documents/*.test.ts`, `tests/e2e/real-app/viewers.e2e.ts` |
| `src-tauri/src/app/sniff.rs` | `classify` por los primeros 8 KiB (`SNIFF_BYTES`): PNG, JPEG, GIF, WEBP, BMP, ICO con cabecera coherente, PDF, SVG, texto UTF-8/UTF-16 o binario | `tests/sniff.rs` |
| `src/services/filesApi.ts` | Tipos del contrato de archivos y de `UiState`, envoltorios tipados sobre `call` de `tauri.ts` (`fsList`, `fsProbe`, `fsReadText`, `fsWriteText`, `fsReadChunk`, `fsCanOpenExternal`, `fsOpenExternal`, `wcStatusMap`, `uiStateGet`, `uiStateSet`) y `fileUrl`, que arma la URL del protocolo `workspace-file` | `src/services/filesApi.test.ts`, `contract.test.ts` |
| `src/services/tauri.ts` | Único punto de `invoke()`/`listen()`/diálogo; tipos del contrato; `runOperation` con buffer de eventos que llegan antes del id | `src/services/tauri.test.ts` |
| `src/stores/workspace.ts`, `project.ts` | Pinia: onboarding, copia de trabajo activa, operación en curso, progreso acotado; la contraseña nunca se guarda | `src/stores/*.test.ts` |
| `src/views/`, `src/components/`, `src/composables/`, `src/utils/svnLabels.ts` | `OnboardingView`, `ProjectPanel`, modales, composables de tema/preferencias/confirmación/foco, etiquetas en español | `src/**/*.test.ts` (lógica); UI verificada en la ventana real por CDP (`tests/e2e/real-app/`) |
| `tests/e2e/real-app/`, `scripts/e2e/` | Arnés E2E sobre la ventana real de Tauri por CDP (`npm run test:e2e`): lanza el ejecutable de depuración con `start-app.ps1`, siembra SVN real con `seed-fixtures.ps1` y falla ante peticiones externas o violaciones de CSP; no entra al build | n/a |
| `src-tauri/src/svn/commands.rs` (operaciones) | `CheckoutRequest`, `UpdateRequest`, `CommitRequest` (mensaje por archivo UTF-8, `-F`), `CleanupRequest`, `Depth` | `tests/svn_operations.rs` |
| `src-tauri/src/svn/progress.rs`, `message_file.rs` | `parse_progress_line`/`last_revision` (texto en inglés, solo UI), archivo temporal del mensaje de commit | `tests/svn_operations.rs` |
| `src-tauri/src/app/operations.rs` | `Operations` (checkout/update/commit/cleanup sobre `ScopedPath`), `OperationManager` (ids, cancelación, lock por copia de trabajo, marca de cleanup) | `tests/svn_operations.rs` |

Los helpers de prueba con repo real (`svnadmin create` + `file:///`) viven en `src-tauri/tests/common/mod.rs`. El lock se indexa por la ruta de la copia de trabajo: operar sobre una subcarpeta no se serializa contra la raíz.  [VERIFIED]

## Capas (Fase 1, implementado)

Fuente: `plans/fase-1-fundacion/design.md` §2 y §4 [USER-ASSERTED]; la separación se cumple en el código: `svn/` no importa `app/`, `commands/` ni `tauri`, y `app/` y `config/` tampoco usan `tauri` [VERIFIED: `grep` sobre `src-tauri/src`].

Capas Rust, dependencia unidireccional `commands → app → svn`.

| Capa | Responsabilidad | Hoy |
|---|---|---|
| `commands/` | `#[tauri::command]` finos: validan, delegan, mapean errores | `mod.rs`, `files.rs`, `ui.rs`, `window.rs` y el protocolo `workspace-file` (`protocol.rs`) |
| `app/` | workspace, `svn_locator`, operaciones (cola por working copy) | además `files/`, `wc_status.rs`, `ui_state.rs`, `closing.rs`, `range.rs`, `sniff.rs` y `state.rs` |
| `svn/` | `SvnClient`: runner, comandos, parsers XML, modelos, errores | `client.rs`, `runner.rs`, `commands.rs`, `parsers.rs`, `models.rs`, `error.rs`, `progress.rs`, `message_file.rs` |
| `config/` | persistencia JSON sin secretos | `mod.rs` (`ConfigStore`) y `ui.rs` (`UiState`) |

Solo el módulo `svn` lanza `svn.exe` ([ADR 0001](adr/0001-sin-tauri-plugin-shell.md)).

## Documentos de referencia

| Documento | Contenido |
|---|---|
| [workspace.md](workspace.md) | Workspace Root, `resolve`/`revalidate`, reglas de rutas, nube, estado de interfaz relativo al root |
| [security.md](security.md) | Fronteras, capabilities, CSP, protocolo, credenciales, saneador Markdown, límites, deuda de seguridad |
| [svn-integration.md](svn-integration.md) | Runner, localizador, parsers, `wc_status_map`, operaciones, errores |
| [testing.md](testing.md) | Pirámide de pruebas y E2E sobre la ventana real |
| [editors.md](editors.md) | Registro de proveedores, visores y límites |
| [roadmap.md](roadmap.md) | Fases hechas y diferidas |
| [TECH_DEBT.md](TECH_DEBT.md) | Registro de deuda técnica |

## Diagramas C4

- Contexto: @docs/architecture/context.mmd

## Puntos de entrada

- `src-tauri/src/main.rs` — ejecutable; solo llama a `run()`.
- `src-tauri/src/lib.rs` — `run()`: plugin de diálogo, protocolo `workspace-file`, `ClosingState`, `on_window_event`, `setup` (directorio de configuración y `AppState`) y registro de los 26 commands.
- `src/main.ts` — arranque del frontend: estilos, `registerBuiltinProviders()` y montaje de `App.vue` con Pinia.
- `src/App.vue` — componente raíz: onboarding o shell, cierre de ventana y sesión de pestañas.
- `src/services/tauri.ts` — único punto de `invoke()`/`listen()`/diálogo del frontend.

## Decisiones

ADRs en @docs/adr/.
