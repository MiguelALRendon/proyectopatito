# Diseño — Fase 2A: Explorador

Estado: BORRADOR para revisión del usuario (2026-10-14), ya corregido tras una revisión adversarial. Spec: `spec.md`. Base: `plans/fase-1-fundacion/design.md`.
Referencia visual: DocuMalia, `C:\Users\spook\Downloads\malia-documalia-master` (la ruta de `propuesta.md` §128 está desactualizada).

## 0. Alcance y principios

Primer plan de dos dentro de la Fase 2 del roadmap (§127). La 2A entrega explorador, vistas, favoritos, estado SVN, pestañas, ventana real probada y los proveedores ligeros (texto y código, Markdown, imágenes, PDF, binario con hexadecimal). La 2B (Office con ZetaOffice, audio, vídeo, comprimidos, empaquetado con `svn.exe` e instalación en máquina limpia) se planea aparte.

Principios no negociables, heredados y nuevos:

1. **Aplicación de Windows autocontenida.** Todo recurso viaja en el instalador; nada se carga de la red; una prueba lo exige (CA-2). El producto es la ventana de Tauri sobre WebView2, no una página web.
2. **Toda ruta pasa por `Workspace::resolve`** y los servicios solo aceptan `ScopedPath` (regla dura del proyecto). El servicio de archivos y el protocolo de archivos no son excepción.
3. **El frontend no tiene `fs` ni shell**; solo commands tipados y el protocolo propio. Las capabilities no se amplían y una prueba lo vigila.
4. **Nunca se interpreta un binario como UTF-8** (§41) y **nunca se ejecuta un archivo** del usuario (§117).
5. **No se finge funcionalidad** (§112): lo diferido aparece deshabilitado con aviso.
6. **Nada bloquea la interfaz**: todo command de archivos es asíncrono y corre en un hilo de bloqueo (como `svn_detect` en `src-tauri/src/commands/mod.rs`), porque OneDrive y las unidades de red pueden tardar.

## 1. Mapa de lo que se construye

```
Rust (src-tauri/src)                          Frontend (src)
├─ app/files.rs        FileService            ├─ services/tauri.ts        núcleo: invoke, errores, eventos
├─ app/sniff.rs        clasificación          ├─ services/filesApi.ts     commands de archivos y de estado de UI
├─ app/range.rs        cabecera Range         ├─ stores/tabs, explorer, favorites, documents
├─ app/wc_status.rs    mapa de estados        ├─ documents/registry.ts    proveedores
├─ app/ui_state.rs     favoritos y sesión     ├─ components/shell, explorer, documents
├─ app/closing.rs      cierre de ventana      └─ composables (useResizablePanel, useSelection…)
├─ commands/files.rs   commands finos
├─ commands/protocol.rs  workspace-file://
└─ config/mod.rs       + sección `ui`
```

Capas Rust sin cambio: `commands → app → svn`. En la capa `svn` cambian `StatusRequest` (opciones `ignored` y `username`), `models.rs` y `parsers.rs` (ver §4).

## 2. Servicio de archivos (Rust)

`FileService` recibe `ScopedPath`. Todos los commands son `async` con `spawn_blocking`.

| Command | Entrada | Salida | Notas |
|---|---|---|---|
| `fs_list` | `path` | `DirListing { path, entries[], truncated, wc: Option<WcLocation> }` | `entries`: nombre, tipo, tamaño, modificado, oculto, solo lectura, enlace, `escapes_workspace`, `cloud_only`. Tope `MAX_LIST_ENTRIES` (20 000); `truncated` avisa. No abre archivos: solo metadatos. `.svn` y `_svn` nunca se listan, ni siquiera con ocultos activados. |
| `fs_probe` | `path`, `allow_download` | `FileProbe { kind, mime, len, extension }` | `kind`: `text`, `image`, `pdf`, `binary`, `cloud`. Lee los primeros `SNIFF_BYTES` (8 KiB). Un archivo `cloud_only` sin `allow_download` devuelve `kind: cloud` con su tamaño y **no lee ni un byte**; la tarjeta «solo en la nube» pide «Descargar y abrir», que repite la llamada con `allow_download: true` y entonces Windows lo descarga. `fs_read_text`, `fs_read_chunk` y el protocolo rechazan con `CloudOnly` un archivo que sigue siendo `cloud_only` (comprobación sin estado: tras descargarlo el atributo cambia). |
| `fs_read_text` | `path` | `TextDocument { content, encoding, has_bom, eol, eol_mixed, version, len }` | Error `NotText` si no decodifica, `TooLarge` por encima de `MAX_EDITABLE_BYTES` (5 MiB): entonces el frontend ofrece binario con hexadecimal. |
| `fs_write_text` | `req: WriteTextArgs { path, content, encoding, has_bom, eol, expected_version }` (un solo struct, por la regla de 3 parámetros) | `{ version }` | Solo sobre un archivo existente, regular y que no sea reparse point. Errores: `FileChanged`, `ReadOnly`, `FileLocked`, `WorkingCopyBusy`. |
| `fs_read_chunk` | `path, offset, len` | bytes (respuesta IPC binaria) | Solo para el visor hexadecimal; `len` ≤ `HEX_CHUNK` (64 KiB). |
| `fs_open_external` | `path` | `()` | Último recurso (§41). Lista **permitida** de formatos; ver §7. |
| `app_confirm_close` | — | `()` | Cierra la ventana tras la confirmación del usuario (con `destroy()` o una bandera de «confirmado»); ver §6. |
| `app_frontend_ready` | — | `()` | El frontend lo invoca al montar; sin él, o pasado `CLOSE_TIMEOUT`, Rust cierra la ventana directamente. |

Reglas de seguridad propias de esta fase:

- **`.svn` y `_svn`**: se comprueban sobre los componentes del `ScopedPath` **ya canonicalizado** (así los nombres cortos 8.3 quedan expandidos), sin distinguir mayúsculas, en todo `fs_*` y en el protocolo. Editar `wc.db` corrompería la copia. Precedente: `component_keys` en `src-tauri/src/app/workspace.rs`.
- `revalidate` justo antes de escribir y de abrir (TOCTOU), como en Fase 1.
- Enlaces: los reparse points se marcan en el listado; si el destino canónico sale del Workspace Root la entrada se muestra con aviso y no es navegable. Los marcadores de OneDrive (archivo solo en la nube) no se confunden con enlaces: se marcan `cloud_only` (atributos `FILE_ATTRIBUTE_RECALL_ON_OPEN` y `RECALL_ON_DATA_ACCESS`) y el listado nunca los abre (supuesto — verificar en la máquina del usuario, cuyo escritorio está bajo OneDrive). Riesgo conocido: `svn status` lee el árbol y puede hidratar archivos en la nube de una copia bajo OneDrive; no se evita, se avisa en el `InfoPanel` cuando la copia está bajo una carpeta de OneDrive y se mide en la prueba manual.
- Codificaciones: se editan UTF-8 (con o sin BOM) y UTF-16 con BOM, codificando y decodificando con la biblioteca estándar (`String::from_utf16`, `encode_utf16`); cualquier otra cosa se trata como binario. Se conserva el BOM y el final de línea dominante; si el final de línea es mixto se avisa antes de normalizarlo (`eol_mixed`) para no ensuciar los diffs de SVN.
- **Versión del archivo**: `version` es un token opaco con longitud y marca de tiempo completa (100 ns de NTFS); `expected_version` distinto devuelve `FileChanged`. No se usa un entero de milisegundos.
- **Escritura**: temporal único (`create_new`) junto al destino, `sync_all`, renombrar sobre el original. Si el archivo está abierto por otro proceso el renombrado falla con `FileLocked`. Antes de escribir toma con `try_lock` el candado de la copia: como el `OperationManager` de `src-tauri/src/app/operations.rs` indexa el candado por la ruta del objetivo de la operación (T-7), la consulta busca cualquier candado cuya clave sea ancestro o descendiente de la ruta, usando la raíz que da `find_wc_root`; si hay uno ocupado responde `WorkingCopyBusy`. Un archivo de solo lectura (por ejemplo `svn:needs-lock`) responde `ReadOnly`; no se fuerza. Techo conocido: el temporal aparece un instante como no versionado.
- Nuevos `CommandErrorKind`: `NotText`, `TooLarge`, `FileChanged`, `ReadOnly`, `FileLocked`, `WorkingCopyBusy`, `NotADirectory`, `ForbiddenPath` (`.svn`, `_svn`) y `NotAllowed` (apertura externa fuera de la lista permitida).

## 3. Protocolo de archivos `workspace-file`

Un esquema propio registrado desde Rust sirve imágenes y PDF (y en la 2B audio y vídeo) con soporte de `Range` (206 y 416), sin copiar el archivo al frontend. Patrón del [ejemplo de streaming de Tauri](https://gitverse.ru/githubmirror/tauri/content/dev/examples/streaming/main.rs).

- La ruta viaja relativa al Workspace Root y codificada en la URL; el handler quita la barra inicial de `uri.path()` (con `Path::join` en Windows una ruta que empieza por `/` apunta a la raíz de la unidad y `resolve` la rechazaría siempre) y aplica `resolve` y `revalidate` en cada petición.
- Tope `MAX_RESPONSE_BYTES` (32 MiB) por respuesta: un rango mayor devuelve 206 truncado; una petición completa de un archivo mayor devuelve 413.
- Cabeceras: `Accept-Ranges`, `Cross-Origin-Resource-Policy: cross-origin` (la Fase 2B aísla la ventana con COEP `require-corp` y sin esta cabecera el navegador bloquearía todo recurso del protocolo; es inofensiva aquí porque el protocolo solo existe dentro de la aplicación y sigue pasando por `resolve`), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; sandbox` (un SVG abierto directamente no ejecuta scripts), y CORS que refleja `Origin` contra una lista (`http://tauri.localhost` y, solo en depuración, `http://localhost:1420`; nunca `*`) más `Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length` y respuesta al `OPTIONS` de preflight con `Access-Control-Allow-Headers: Range`, porque pdf.js pide con `Range` desde otro origen y un rango sufijo dispara preflight.
- Errores: 403 fuera del root o dentro de `.svn`, 404 si no existe.
- El analizador de `Range` vive en `app/range.rs` y se prueba sin Tauri.

Supuestos — verificar en I1 e I4: en Windows la URL tiene la forma `http://workspace-file.localhost/<ruta>` y el origen de la página es `http://tauri.localhost`.

## 4. Estado SVN en el explorador

1. `fs_list` devuelve el listado de inmediato y, si la carpeta está dentro de una copia de trabajo (se busca `.svn` subiendo hasta el Workspace Root), `wc: { root, is_root }`. Límite documentado: una copia cuya raíz esté por encima del Workspace Root no se detecta.
2. El frontend pide `wc_status_map(root, remote, credentials)`: un `svn status --xml --no-ignore` de la copia (recursivo), cacheado por (copia, remoto). Devuelve solo lo que no está «normal» más `changed_folders`, con un tope `MAX_STATUS_ENTRIES` y un aviso `truncated` (un `--no-ignore` recursivo en una copia con `node_modules` u `obj` puede devolver cientos de miles de entradas). No bloquea la navegación: el listado aparece primero y los distintivos llegan después. Si caduca el tiempo (`RunOptions` por defecto, 120 s) o falla, la interfaz muestra «no se pudo calcular el estado» y conserva el listado.
3. Invalidación: botón actualizar; al terminar update, commit, cleanup o checkout (el store `project` avisa al `explorer`); después de guardar un archivo (el store `documents` avisa al `explorer`). La caché de Rust se invalida en los mismos puntos. No hay refresco por foco.
4. `remote=true` (botón «Comprobar servidor») agrega `-u`. Como `--non-interactive` devuelve `auth_required` en repositorios privados, el command acepta credenciales (`StatusRequest` gana `username` y la contraseña va por stdin, igual que las demás operaciones) y la interfaz reutiliza `CredentialsModal`.
5. Parser: `models.rs::StatusItem` ya tiene `Ignored`, `External`, `Replaced` y `Obstructed` (tipo cambiado) y `src/utils/svnLabels.ts` los etiqueta. **Falta** leer `@wc-locked`, `<lock>`, `@tree-conflicted`, `@copied` y `@switched` en `parsers.rs::RawWcStatus`: sin eso «bloqueado» (CA-10) es imposible.
6. Copias de formato antiguo o bloqueadas: si `wc_info` o `wc_status_map` devuelven `WorkingCopyTooOld` (E155036) o `WorkingCopyLocked` (E155004), `WcHeader` y `InfoPanel` muestran el texto de `errorGuidance` (`src/utils/svnLabels.ts`, ya probado en la Fase 1: «ejecuta svn upgrade con otro cliente» y «Cleanup») en vez de un error genérico, con el botón de cleanup del `InfoPanel` para la copia bloqueada; el listado sigue visible.
7. `WcHeader`: usa `wc_info` de la **raíz** de la copia (para una subcarpeta no versionada, `wc_info` de la carpeta falla). La rama sale de `relative_url`: si empieza por `^/trunk`, `^/branches/<n>` o `^/tags/<n>` se muestra así; con otra disposición se muestra la URL relativa tal cual.

Techo conocido: en copias enormes el estado recursivo puede tardar; se mitiga con el cálculo en segundo plano y la caché.

## 5. Estado de la interfaz que persiste

| Dato | Dónde | Por qué |
|---|---|---|
| Favoritos, sesión de pestañas, vista por carpeta (modo, columnas, orden) | `config.json` (sección `ui`, Rust) | Son datos del usuario: se validan contra el Workspace Root, la escritura es atómica y el JSON corrupto va a `config.json.bad` (ya existe en `ConfigStore`). |
| Tamaños de paneles, tema | `localStorage` (`usePersistedPreference`) | Preferencias volátiles; perderlas no daña nada y el arrastre de paneles no debe escribir a disco. |

`UiState` guarda rutas **relativas al Workspace Root**, con campo `version`, y se deserializa de forma tolerante: una sección `ui` con forma inválida vuelve al valor por defecto y nunca arrastra `workspace_root` ni `svn_path` a la cuarentena de `config.json.bad`; y claves en minúsculas para no duplicar vistas por diferencias de mayúsculas. Al cargar, cada ruta se revalida contra la raíz **actual**: las que no existen o salieron de ella se marcan no disponibles y no se borran (si el usuario vuelve a la raíz anterior reaparecen). Escritura con retardo desde el frontend vía `ui_state_set`; el cierre de ventana (§6) vacía lo pendiente.

## 6. Frontend y cierre de ventana

Estructura nueva:

- `components/shell/`: `AppShell` (barra superior con «Mis archivos» y «Marketplace» deshabilitado, barra lateral, zona de pestañas, panel inferior), `TabBar`, `ContextMenu` (solo el de pestañas), `ResizeHandle`, `InfoPanel`.
- `components/explorer/`: `BreadcrumbBar`, `ExplorerToolbar` (atrás, adelante, arriba, actualizar, vista, ocultos, filtro, estrella de favorito, comprobar servidor), `FileGrid`, `FileList` (lista y detalles), `FileTree` (carga perezosa; `role=tree`), `FavoritesSidebar`, `SvnStateBadge`, `WcHeader`.
- `components/documents/`: `DocumentHost` (elige proveedor), `TextEditor` (Monaco), `MarkdownEditor`, `MarkdownPreview`, `ImageViewer`, `PdfViewer`, `HexViewer`, `BinaryCard`.
- Stores Pinia: `tabs`, `explorer`, `favorites`, `documents`. La clave de deduplicación de pestañas es la ruta canónica en minúsculas.
- Servicios: `services/tauri.ts` sigue siendo el único módulo que importa `@tauri-apps/*`; `services/filesApi.ts` lo usa. Las pruebas de contrato y frontera se adaptan (ver §10).

Modelo de pestaña: `{ id, kind: 'folder' | 'document', path, title }`, donde `path` es la **ubicación actual**: cada pestaña de carpeta posee su propio estado de explorador (instancia por `tab.id`: historial, selección y vista), entrar en una carpeta navega dentro de la pestaña y la deduplicación solo aplica al abrir desde favoritos, árbol o «abrir en pestaña nueva». Hasta que llegue el visor (I11) una pestaña `document` muestra un marcador. `kind` es extensible para diff, historial, conflicto, repositorio y propiedades (§12). Cerrar otras, a la derecha, reordenar, duplicar y restaurar viven en el store, no en bucles de la interfaz. Reordenar usa eventos de puntero; se deja `dragDropEnabled` en su valor por defecto, porque desactivarlo haría que soltar un archivo del Explorador de Windows sobre la ventana navegue el WebView a ese archivo y se pierdan cambios sin guardar.

**Cierre de ventana sin ampliar capabilities.** `on_window_event(CloseRequested)` en Rust llama a `prevent_close` y emite `app://close-requested`; el frontend vacía el estado pendiente, pide confirmación si hay cambios sin guardar y, si el usuario acepta, invoca `app_confirm_close`. Para que la ventana nunca quede imposible de cerrar, el frontend invoca `app_frontend_ready` al montar; si no llegó, o si pasa `CLOSE_TIMEOUT` sin respuesta, Rust cierra directamente. `core:window:default` no incluye `allow-close` ni `allow-destroy`; así no se agrega ningún permiso.

`AppShell` hospeda `ProjectPanel` sin cambios desde I7 hasta que I9 lo sustituye por `InfoPanel`. `InfoPanel`: la raíz de la copia llega desde `fs_list.wc` (la produce I2 y la consume I9); el panel llama a `project.open(raíz)` cuando cambia y conserva actualizar, confirmar y cleanup de la Fase 1 con su tabla de cambios actual; el formulario de checkout queda siempre disponible porque crea una copia nueva. `ProjectPanel` pierde el formulario de abrir ruta. Deuda reconocida: `project` y el explorador consultan estado por dos caminos (`wc_status` y `wc_status_map`); se unifican cuando se rediseñe el panel (T-14 y T-15).

### Reutilización de DocuMalia (estudio del 2026-10-14)

| Pieza | Decisión |
|---|---|
| `TabBar.vue` | Adaptar: reordenar con eventos de puntero, desplazamiento con muchas pestañas, cierre con botón central |
| `ContextMenu.vue`, `contextMenuPosition.ts` | Reutilizar para las pestañas; usar tokens de capa (hoy tiene `z-index: 1000` fijo) |
| `ResizeHandle.vue`, `useResizablePanel.ts` | Reutilizar; renombrar el prefijo de clave (`usePersistedPreference.ts` ya existe aquí) |
| `ExplorerGridView.vue`, `treeNavigation.ts` | Reutilizar la cuadrícula y las migas; agregar lista, detalles y orden |
| `TreeItem.vue` | Adaptar: carga perezosa, flechas, props en vez de leer el store |
| `DocumentReader.vue` | Reutilizar la idea, **no su configuración**: llama a `DOMPurify.sanitize` por defecto, que deja pasar `style`, `form`, `svg` y `math` |
| `MarkdownEditor.vue` | No: usa CodeMirror; aquí Monaco (ADR-0002) |
| `stores/workspace.ts`, `services/api.ts`, `ConflictBanner`, `VersionsPanel`, `templateGuard` | No copiar: dominio MaliAPI/git |
| Animaciones GSAP | No: CSS (`transform` y `opacity`) para no agregar dependencia |

## 7. Proveedores de documentos

`documents/registry.ts` mantiene una lista de `DocumentProvider { id, label, editable, matches(probe): number, component }`. Gana el de mayor puntaje; si ninguno responde, `BinaryCard`. La 2B agrega proveedores sin tocar el registro.

| Proveedor | Cuándo | Detalle |
|---|---|---|
| Texto y código | `probe.kind === 'text'` | Monaco con carga diferida. Los lenguajes de la lista (C#, C++, C, Rust, JS, TS, JSON, XML, YAML, SQL, HTML, CSS, Python, PowerShell, Bash, batch, INI, Markdown) existen en `node_modules/monaco-editor` 0.57; la estructura de esa versión difiere de la guía ESM enlazada, así que los imports se verifican en I11. Workers por `?worker` de Vite. |
| Markdown | `probe.kind === 'text'` **y** extensión `md` | Un `.md` binario cae a `BinaryCard`. Modos Editor, Vista previa, Dividido. `marked` 18.x y `dompurify` ≥ 3.4.17 con versión exacta (decisión del usuario: las últimas, por las correcciones de seguridad, aunque `monaco-editor` traiga las suyas 14.0.0 y 3.4.15 y se dupliquen; el corpus XSS debe pasar con ellas). Saneado con **lista de permitidos** explícita (`ALLOWED_TAGS` y `ALLOWED_ATTR` mínimos de texto, listas, tablas, código, imágenes y enlaces; `ALLOW_DATA_ATTR: false`; `ALLOWED_URI_REGEXP` sin `data:` ni `javascript:`; sin `style`, `form`, `input`, `svg`, `math`, `iframe`, `object` ni `embed`), con un hook que reescribe las `src` relativas después de sanear; el corpus XSS corre también sobre la ventana real porque happy-dom no es un DOM fiable para DOMPurify. Los enlaces no navegan; las imágenes relativas se reescriben al protocolo y las remotas se bloquean. Una prueba prohíbe `v-html` fuera de `MarkdownPreview`. |
| Imagen | `probe.kind === 'image'` | `<img>` sobre el protocolo; el SVG se renderiza como imagen (no ejecuta scripts) y tiene un botón «Ver código» que abre una pestaña de texto. Si el `<img>` falla, cae a `BinaryCard`. |
| PDF | `probe.kind === 'pdf'` | `pdfjs-dist` 6.4.299 exacta (exige Node ≥ 22.13 y un WebView2 reciente; se prueba bajo el WebView2 real) con su worker, cMaps, fuentes estándar y wasm empaquetados; lee por el protocolo con `Range`; paginación y zoom; límite `maxImageSize`; `isEvalSupported: false`. La CSP gana `font-src` y, si el wasm lo exige, `'wasm-unsafe-eval'` (supuesto — verificar). |
| Binario | resto | `BinaryCard` + `HexViewer` virtualizado (filas de 16 bytes, tramos de 64 KiB, solo lectura) + «Abrir con la aplicación predeterminada». |

Detección por bytes: firmas con campos de cabecera coherentes (por ejemplo BMP exige tamaño y offset plausibles; ICO exige un recuento de imágenes razonable), porque `BM` o `00 00 01 00` solos darían falsos positivos.

**Apertura externa.** `fs_open_external` usa una **lista permitida** de extensiones de datos (pdf, docx, xlsx, pptx, odt, ods, odp, zip, 7z, rar, tar, gz, bz2, xz, mp3, mp4, mkv, avi, mov, wav, flac, ogg, webm, png, jpg, jpeg, gif, webp, bmp, ico, txt, md, log) y excluye los binarios heredados de Office (`doc`, `xls`, `ppt`, `rtf`), `csv`, los formatos con macros, html, svg y xml, que el sistema abriría con privilegios o con riesgo de macros e inyección de fórmulas. Riesgo aceptado: `docx`, `xlsx` y `pptx` pueden enlazar recursos externos al abrirse en la aplicación predeterminada. Además re-sondea el archivo: una cabecera `MZ` lo rechaza (el flujo alterno `archivo:flujo` ya lo rechaza `Workspace::resolve` por `is_ambiguous_name`). El rechazo devuelve `NotAllowed`. El lanzador es un `Launcher` inyectable; las pruebas usan uno falso y **ninguna prueba E2E intenta abrir un ejecutable**.

## 8. CSP y capabilities (paga T-10)

CSP en `tauri.conf.json`: `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'` (Monaco inyecta estilos); `img-src 'self' data: blob:` más el origen del protocolo; `connect-src ipc: http://ipc.localhost` más el protocolo; `font-src 'self'`; `worker-src 'self' blob:`; `object-src 'none'`; `frame-src 'none'`; `base-uri 'none'`. `devCsp` es solo el delta mínimo para el HMR de Vite (`ws://localhost:1420`). Como `tauri dev` usa `devCsp` y otro origen, **la CSP real se prueba contra el ejecutable compilado** (ver §9). Riesgo conocido: Tauri inyecta nonces y hashes en la CSP de sus propios assets, y con un nonce o hash en `style-src` el navegador ignora `'unsafe-inline'`, lo que rompería los estilos dinámicos de Monaco; lo primero que se prueba en I11 es `app.security.dangerousDisableAssetCspModification` para `style-src`. Capabilities siguen en `core:default` y `dialog:allow-open`; una prueba compara el archivo con esa lista.

## 9. Ventana real y arnés de pruebas

- Ventana por defecto 1280×800 y mínimo 900×600 (hoy 800×600 en `src-tauri/tauri.conf.json`). `bundle.targets` pasa de `"all"` a `["nsis"]` para que `tauri build` sea predecible, y `webviewInstallMode` queda explícito en `downloadBootstrapper` (descarga WebView2 solo si falta; Windows 11 ya lo trae): `offlineInstaller` (~127 MB más) se decide en la 2B con la prueba en máquina limpia.
- Modo principal de pruebas: **ejecutable de depuración** (`tauri build --debug --no-bundle`), que usa la CSP real, y se relanza directamente en segundos. `tauri dev` queda para el desarrollo diario.
- `scripts/e2e/start-app.ps1` arranca el ejecutable con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<puerto>`, `WEBVIEW2_USER_DATA_FOLDER` apuntando a una carpeta temporal (para aislar `localStorage`) y `DAKEDADUCK_CONFIG_DIR` con un `config.json` sembrado. La variable solo se lee con `cfg(any(debug_assertions, feature = "e2e-config-dir"))`: la característica de Cargo `e2e-config-dir` habilita la prueba de humo sobre una build de release y el instalador distribuido se compila sin ella, porque una variable abierta en release permitiría redirigir `svn_path`, un ejecutable que la app lanza; la parada usa `taskkill /T /F` para no dejar `msedgewebview2.exe` huérfanos. Supuestos — verificar en I1: WebView2 acepta el puerto desde Tauri y wry respeta `WEBVIEW2_USER_DATA_FOLDER`.
- `scripts/e2e/seed-fixtures.ps1` crea con `svnadmin` un repositorio y una copia de trabajo de fixtures.
- Las pruebas usan `playwright-core` por CDP (`connectOverCDP`) y se ejecutan con Vitest (`vitest.e2e.config.ts`, `npm run test:e2e`), con su propio `tsconfig` que verifican el script `build` y la etapa `build` de `pipeline.json`. Como `connectOverCDP` conecta con la página ya cargada, el arnés registra sus listeners y recarga la página para cubrir la primera carga. Falla cualquier petición cuyo host no esté en la lista permitida (`tauri.localhost`, `ipc.localhost`, `workspace-file.localhost`, `localhost:1420` solo en dev, `blob:`, `data:`) o cualquier violación de CSP.
- Alcance honesto: se controla la interfaz de la ventana; los diálogos nativos y el marco no. El cierre de ventana se prueba desde el arnés enviando `CloseMainWindow`: la página recibe `app://close-requested` y el proceso sigue vivo hasta confirmar, cancelar no cierra y confirmar termina el proceso.
- Puerta: los E2E no están en `pipeline.json` (la etapa `e2e` es de CI, necesita pantalla). Cada increment con interfaz los ejecuta en su verificación funcional y el QA Increment los exige.
- Se retiran el mock de Tauri (`tests/e2e/mock-tauri/`), `vite.e2e.config.ts` y `dev:e2e`: el arnés real los reemplaza y el mock ya no conocería los commands nuevos.

## 10. Pruebas

Rust: `tests/files.rs`, `tests/sniff.rs`, escritura (concurrencia, solo lectura, atómica, EOL y BOM, archivo bloqueado, update en curso), `tests/protocol.rs` (rangos, CORS, nombres con `#`, `%`, `?`, espacios y `ñ`), `tests/wc_status.rs` (repo real: cada estado de §15), `tests/ui_state.rs`, prueba de capabilities. Frontend: stores y registro con Vitest; `vitest.config.ts` pasa a `happy-dom` también para `src/components/**`, `src/documents/**` y los composables nuevos (`useResizablePanel`, `useSelection`); componentes con `@vue/test-utils`.

Gate de contrato y frontera (rompe en I2 si no se adapta): `src/services/contract.test.ts` lee solo `commands/mod.rs` con una regex, busca `commands::<nombre>,` en `lib.rs` y recorre solo `import * as gateway from './tauri'`. Hay que (a) leer todos los `commands/*.rs` con `import.meta.glob`, (b) ajustar la regex del registro (o dejar `pub use` en `mod.rs`), (c) recorrer también `services/*Api.ts`, (d) mover a `helpers` los exports que no son commands (`call` y los suscriptores de eventos), (e) ampliar `ALL_KINDS`/`kind_name` en `tests/contract.rs`, (f) incluir el evento `app://close-requested` en el contrato de eventos, (g) probar que `generate_handler!` funciona con los re-exports de los submódulos de `commands/`. `boundary.test.ts` mantiene que solo `tauri.ts` importa `@tauri-apps/*`.

Mutación: Stryker (umbral 85 ya fijado) excluye `src/documents/monaco/**` y `src/documents/pdf/**` (no se pueden probar sin navegador real); `cargo-mutants` sobre los módulos nuevos (necesita `SVNSERVE_BIN`).

## 11. Decisiones (elegida vs descartadas)

| Decisión | Elegida | Descartadas y por qué |
|---|---|---|
| Entregar archivos al frontend | Protocolo propio con `Range` | Asset protocol de Tauri: su alcance es estático y no pasa por `ScopedPath`; bytes por IPC: copias y memoria; `plugin-fs`: rompe la regla de no dar `fs` |
| Dónde persistir favoritos y sesión | `config.json` (Rust) | Todo en `localStorage`: sin validación y atado al perfil de WebView2; los tamaños de panel sí van a `localStorage` |
| Estado SVN | Listado inmediato + mapa de estados cacheado por copia | `svn status --depth immediates`: las carpetas no verían cambios de sus hijos; un proceso por fila: cientos de procesos |
| Pruebas de la ventana real | CDP con `playwright-core` sobre el ejecutable de depuración | `tauri-driver` + `msedgedriver`: binario extra que instalar; solo navegador con mock: no cubrió la ventana; solo `tauri dev`: no prueba la CSP real |
| Cierre de ventana | Interceptarlo en Rust y confirmar con un command propio | `onCloseRequested` desde JavaScript: exige `core:window:allow-close`, que amplía las capabilities |
| Editor de código | Monaco (ADR-0002) | CodeMirror de DocuMalia: preferencia del usuario |
| Escritura | Temporal único junto al destino + renombrar | Escribir directo: un fallo trunca; temporal en `%TEMP%`: no atómico entre volúmenes |
| Codificaciones | UTF-8 y UTF-16 con la biblioteca estándar; el resto como binario | `encoding_rs` y Windows-1252: `encoding_rs` no codifica UTF-16 y no hay criterio de aceptación que lo pida |
| Operaciones de archivo | Diferidas a la Fase 4 | Hacerlas con el sistema de archivos: en una copia de trabajo deben ser `svn add/delete/move` |
| Apertura externa | Lista permitida de formatos de datos | Lista de bloqueo: siempre se olvida alguna extensión peligrosa |
| Reordenar pestañas y favoritos | Eventos de puntero | HTML5 drag and drop: exige `dragDropEnabled: false`, y con eso soltar un archivo del Explorador navega la ventana |
| Configuración aislada en pruebas de release | Característica de Cargo `e2e-config-dir` | Variable siempre abierta en release: permitiría redirigir `svn_path`; probar el release contra el `config.json` real del usuario |
| Menú contextual del explorador | Solo el de pestañas; favoritos con su botón | Menú completo: no hay criterio que lo exija |
| Servicios del frontend | `filesApi.ts` sobre el núcleo de `tauri.ts` | Todo en `tauri.ts`: archivo enorme; `@tauri-apps` en varios módulos: rompe la frontera probada |

## 12. Riesgos y supuestos a verificar

| Riesgo o supuesto | Mitigación |
|---|---|
| WebView2 no acepta el puerto de depuración o ignora `WEBVIEW2_USER_DATA_FOLDER` | I1 lo verifica primero; plan alterno `tauri-driver` |
| Forma de la URL del protocolo y del origen de la página | I1 e I4 las miden en la ventana real |
| Los nonces y hashes que Tauri inyecta anulan `'unsafe-inline'` en `style-src` y rompen Monaco | I11 prueba primero `dangerousDisableAssetCspModification` para `style-src` |
| La ventana no se puede cerrar si el frontend no responde | Bandera `app_frontend_ready` y `CLOSE_TIMEOUT`; se prueba con `CloseMainWindow` |
| CSP rompe Monaco o pdf.js (workers, `eval`, wasm, fuentes) | E2E contra el ejecutable falla con cualquier violación; se ajusta la CSP mínima |
| `svn status` recursivo lento en copias enormes | Segundo plano, caché, aviso al caducar |
| Licencia de `opener`, `pdfjs-dist`, `playwright-core` | Verificar al agregarlas; el proyecto será open source |
| Archivos solo en la nube de OneDrive (el escritorio del usuario está bajo OneDrive) | El listado no abre archivos; `fs_probe` no lee un `cloud_only` sin «Descargar y abrir»; aviso en el `InfoPanel`; caso de prueba manual documentado (incluye medir si `wc_status_map` descarga archivos) |
| Imágenes y PDF enormes | Tope de respuesta del protocolo y `maxImageSize` en pdf.js |
| Un `.exe` o script abierto por error | Lista permitida + re-sondeo + lanzador falso en pruebas; ningún E2E intenta ejecutar nada |
