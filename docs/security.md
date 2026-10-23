---
id: ref-security
title: Seguridad
type: reference
status: current
source: both
last_verified: 2026-10-16
symbols: [handle, FIXED_HEADERS, renderMarkdown, ALLOWED_TAGS, Password, replace_atomically, Closing, ConfigStore, OPENABLE_EXTENSIONS]
related: [ref-architecture, ref-workspace, ref-svn-integration, adr-0001, adr-0003, adr-0005, adr-0006, adr-0009]
---

# Seguridad

La aplicación es un programa de Windows autocontenido (Tauri 2 sobre WebView2): no carga nada de la red y el frontend no tiene acceso directo al sistema de archivos ni a un shell. Este documento recoge las fronteras que existen hoy en el código y qué prueba vigila cada una. Lo que todavía no existe está marcado como **diferido**.

## Principios

| Principio | Cómo se cumple |
|---|---|
| Solo Rust lanza `svn.exe`; sin shell hacia el frontend ([ADR 0001](adr/0001-sin-tauri-plugin-shell.md)) | No hay `tauri-plugin-shell` en `Cargo.toml`, `Cargo.lock` ni `package-lock.json`. `src/services/boundary.test.ts` falla si cualquier archivo de `src` distinto de `src/services/tauri.ts` importa `@tauri-apps/`, `__TAURI` o llama a `invoke(` |
| Toda ruta pasa por `Workspace::resolve` | Ver [workspace](workspace.md) |
| Nunca se interpreta un binario como texto ni se ejecuta un archivo del usuario | `fs_probe` clasifica por contenido (`app/sniff.rs`, primeros 8 KiB); la apertura externa es de lista permitida (más abajo) |
| No se finge funcionalidad | Marketplace aparece deshabilitado con aviso (`tests/e2e/real-app/shell.e2e.ts`); lo diferido se declara en [roadmap](roadmap.md) |
| Nada bloquea la interfaz | Los `fs_*` son `async` con `spawn_blocking` (`commands/files.rs`, `blocking` en `app/state.rs`) |

## Capabilities mínimas

`src-tauri/capabilities/default.json` concede a la ventana `main` solo `core:default` y `dialog:allow-open` (elegir carpetas). La prueba `the_main_window_capabilities_grant_only_core_default_and_the_folder_dialog` de `src-tauri/tests/app_state.rs` exige que exista una única capability y que sus permisos sean exactamente esos dos. En lugar de ampliar permisos, el cierre de ventana ([ADR 0009](adr/0009-cierre-de-ventana-interceptado-en-rust.md)), la apertura externa y la lectura de archivos usan commands propios y el protocolo `workspace-file`.

## CSP

`src-tauri/tauri.conf.json` (`app.security.csp`; T-10 pagada, antes era `null`), aquí partida en líneas:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: http://workspace-file.localhost;
media-src 'self' http://workspace-file.localhost; font-src 'self';
connect-src ipc: http://ipc.localhost http://workspace-file.localhost;
worker-src 'self'; object-src 'none'; frame-src http://zeta-assets.localhost;
base-uri 'none'
```

`media-src` (Increment 6) deja pasar `<audio>` y `<video>` solo hacia `workspace-file`: sin ella `default-src 'self'` rechazaba todo medio («Media load rejected by URL safety check»). `frame-src` solo admite el origen de ZetaOffice (ver más abajo).

`devCsp` es igual y añade `ws://localhost:1420 http://localhost:1420` a `connect-src` para `tauri dev`, que por eso **no prueba la CSP real**: solo el ejecutable compilado la aplica ([ADR 0008](adr/0008-pruebas-de-ventana-real-por-cdp.md)).

Lo medido sobre la ventana real (detalle en [entorno de desarrollo](human-explanations/entorno-desarrollo.md)):

- La página vive en `http://tauri.localhost`; el protocolo propio, en `http://workspace-file.localhost`; el IPC, en `http://ipc.localhost`.
- Tauri solo agrega hashes SHA-256 a `script-src`; `style-src 'unsafe-inline'` queda como está, de modo que los estilos dinámicos de Monaco funcionan sin `dangerousDisableAssetCspModification`.
- Los workers de Monaco y de pdf.js se sirven desde `tauri.localhost/assets/`: basta `worker-src 'self'`, sin `blob:`, sin `'unsafe-eval'` y sin `'wasm-unsafe-eval'`. `font-src 'self'` basta para la fuente `codicon` de Monaco y para pintar PDF.
- Los scripts de worker llegan sin cabecera `Content-Security-Policy`, así que una violación dentro de un worker no dispara `securitypolicyviolation` en el documento; por eso `viewers.e2e.ts` también comprueba las peticiones reales.

Vigilancia: el arnés E2E registra cada `securitypolicyviolation` y cada petición a un host que no sea `tauri.localhost`, `ipc.localhost` o `workspace-file.localhost` (`tests/e2e/real-app/harness.ts`). `smoke.e2e.ts` comprueba además que una petición externa y un script en línea **sí** violan la CSP y no se ejecutan; el resto de las pruebas exigen cero violaciones.

## Aislamiento de origen cruzado (Fase 2B, Increment 2)

Toda la ventana corre con `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp` ([ADR 0010](adr/0010-aislamiento-de-origen-cruzado-y-zetaoffice-como-recurso.md)), declaradas en `src-tauri/tauri.conf.json` (`app.security.headers`) y repetidas en `server.headers` y `preview.headers` de `vite.config.ts`, de modo que `tauri dev` está aislado igual que el ejecutable. La prueba `tests/e2e/isolationHeaders.test.ts` compara las tres declaraciones y falla si divergen. Con ellas `window.crossOriginIsolated` es verdadero y hay `SharedArrayBuffer` y memoria de WebAssembly compartida, que es lo que exige ZetaOffice.

Consecuencia: toda respuesta de un protocolo propio que la página incruste necesita `Cross-Origin-Resource-Policy: cross-origin`, o COEP la bloquea (`ERR_BLOCKED_BY_RESPONSE`). `workspace-file` la pone en **todas** sus respuestas (200, 206, 400, 403, 404, 413, 416, 405, HEAD y preflight, y para cualquier `Origin`), verificado en `src-tauri/tests/protocol.rs`. El arnés E2E falla el arranque si la ventana no está aislada y cuenta como petición indebida cualquier `ERR_BLOCKED_BY_RESPONSE`.

## `zeta-assets`, el iframe de ZetaOffice y la frontera del WebView (Fase 2B, Increment 4)

- **Protocolo `zeta-assets`** (`src-tauri/src/commands/zeta_protocol.rs`, `src-tauri/src/app/zeta_assets.rs`): lista cerrada de **ocho nombres** (`soffice.js`, `soffice.wasm`, `soffice.data`, `soffice.data.js.metadata`, `zeta.js` desde `src-tauri/resources/zetaoffice/`, y `host.html`, `host.js`, `office_thread.js` incrustados en el binario desde `src-tauri/assets/zeta/`). Todo lo demás es 404 (`..`, barras, mayúsculas, `%2e`, `.br`, nombres sin lista). Solo GET y HEAD (el resto 405 con `Allow`). Los archivos grandes exigen `Range` y salen en tramos de 8 MiB; sin `Range` son 413 (servir 262 MB de una vez llevó a Rust a 1268 MB). Toda respuesta, también los errores, lleva `Cross-Origin-Resource-Policy: cross-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `nosniff`, `Cache-Control: no-store` y la CSP propia del documento del iframe (la única con `'unsafe-eval'` y `'wasm-unsafe-eval'`). No pasa por el Workspace: no sirve datos del usuario.
- **CSP de la página**: solo suma `frame-src http://zeta-assets.localhost`. `src/services/csp.test.ts` y `src-tauri/tests/zeta_assets.rs` fallan si `zeta-assets` aparece en cualquier otra directiva o si aparece `unsafe-eval`.
- **Iframe** `sandbox="allow-scripts allow-same-origin"` con `allow="cross-origin-isolated"`: sin `allow-popups`, `allow-top-navigation` ni `allow-forms`. Se crea dentro del contenedor del visor (`OfficeViewer`), nunca como capa flotante, y se destruye al cerrar la pestaña.
- **Canal**: `officeHost` crea un `MessageChannel` y entrega `port2` con `postMessage(..., 'http://zeta-assets.localhost', [port2])`; `host.js` solo acepta ese mensaje si `event.source === window.parent` y trae exactamente un puerto. Después todo viaja por el puerto privado y cada mensaje se valida en ambos lados (`parseHostMessage` en la página; lista de comandos y formatos en `host.js`).
- **Interceptor de despacho** (`office_thread.js`): un objeto por registro (marco y Desktop). Veta por nombre exacto y por familias (`.uno:Open*`, `.uno:SaveAs*`, `.uno:Export*`, `.uno:SendMail*`) más los prefijos de URL `private:`, `service:`, `file:`, `macro:`, `vnd.sun.star.script:`, `http:`, `https:`, `ftp:`, `mailto:`. Devuelve un despachador inerte que solo avisa (`blocked`) cuando el comando **se ejecuta**: LibreOffice consulta `queryDispatch` al dibujar menús, y devolver `null` o avisar en la consulta daba un aviso falso al abrir. **Trampa medida en la ventana real:** Ctrl+O en Writer es `.uno:OpenFromWriter` (Calc e Impress tienen el suyo), no `.uno:Open`; con la lista exacta abría el selector de archivos de LibreOffice sobre su disco virtual. Por eso se vetan familias. Guardar (`.uno:Save`) se redirige al aviso `save-requested`; el guardado real llega en el Increment 5.
- **Veto ampliado en el Increment 5:** además de las familias `Open*`, `SaveAs*`, `Export*` y `SendMail*`, se vetan `InsertGraphic`, `InsertSound`, `InsertVideo`, `InsertPlugin`, `InsertObject`, `InsertDoc`, `InsertFile`, `LinkDialog`, `EditLinks` y `UpdateAllLinks` (abrían el selector de archivos del disco virtual o actualizan vínculos). `office-ui.e2e.ts` despacha 38 comandos y URL vetados por UNO y exige que cada uno se detenga (aviso con `data-command`), que no aparezca ventana, selector ni descarga y que el lienzo siga vivo.
- **Bytes del guardado:** `FS.readFile` puede devolver una vista sobre memoria compartida (`SharedArrayBuffer`) en la compilación con hilos; `host.js` los copia a un `ArrayBuffer` propio antes de transferirlos y `parseHostMessage` rechaza cualquier otra cosa.
- **Hipervínculos**: el clic en un enlace de Writer no pasa por la cadena de despacho de comandos (lo ejecuta el despachador interno del documento), así que ahí la defensa es el `sandbox` del iframe y la denegación de ventanas nuevas de Rust. La prueba E2E comprueba que un Ctrl+clic sobre un enlace no navega, no abre ventanas ni descarga; **no se logró activar el enlace con el ratón** en esta compilación (el menú contextual no se dibuja), así que no hay prueba de que el clic llegue a ejecutarse.
- **Frontera de Rust** (`src-tauri/src/commands/webview.rs`): la ventana principal se crea en código (`"create": false` en `tauri.conf.json` y `WebviewWindowBuilder::from_config`) para registrar `on_navigation` (solo `http://tauri.localhost` sin usuario ni puerto, y `http://localhost:1420` en depuración), `on_new_window` (siempre `Deny`) y `on_download` (siempre `false`). Las pruebas E2E `webview-boundary.e2e.ts` se validaron con mutantes manuales: permitir navegación y ventanas, o permitir descargas, las hace fallar.
- **Riesgo residual medido (navegación):** `location.assign('https://example.com/')` desde la página **sí emite la petición GET** (se observó la respuesta 200 con cabeceras de Cloudflare) y la ventana no cambia porque la navegación se aborta después (`net::ERR_ABORTED`). Rust impide que la ventana quede en otro origen, no que salga esa petición. Solo puede originarla código que ya corre en la página, donde la CSP prohíbe scripts en línea y externos; los hipervínculos de Markdown ya están desactivados (`LINK_INERT_LABEL`) y los del documento Office viven en el iframe.
- **Trampa de prueba:** Playwright conectado por CDP fuerza su propio comportamiento de descargas y las deja pasar (`edge://downloads-hub` aparece y el archivo se descarga) aunque `on_download` devuelva `false`; sin Playwright el manejador de Rust cancela la descarga. Por eso la prueba de descarga usa un cliente CDP crudo (`tests/e2e/real-app/rawCdp.ts`) y comprueba el disco.

## Protocolo `workspace-file`

Único camino por el que la ventana lee archivos para mostrarlos ([ADR 0006](adr/0006-protocolo-propio-para-servir-archivos.md)). Código: `src-tauri/src/commands/protocol.rs` (`handle`, probable sin Tauri), `app/range.rs` y `app/files/serve.rs`.

| Aspecto | Comportamiento |
|---|---|
| URL | `http://workspace-file.localhost/<ruta relativa, un segmento por barra codificado con encodeURIComponent>` (`fileUrl` en `src/services/filesApi.ts`) |
| Métodos | `GET`, `HEAD` y `OPTIONS`; cualquier otro, 405 con `Allow` |
| Ruta | Decodifica el porcentaje (UTF-8 inválido: 400); solo se aceptan componentes normales, de lo contrario 403; después `FileService::scope` (`resolve`) y `regular_file` (`revalidate`, filtro de `.svn`/`_svn` y rechazo de solo-nube) |
| Estados | Fuera del root, `.svn`/`_svn` y solo-nube: 403; no existe o no es archivo: 404; permiso denegado: 403; otros errores de E/S: 500 |
| `Range` | Un solo rango en bytes (`inicio-fin`, `inicio-`, `-sufijo`): 206 con `Content-Range`; sintaxis inválida: 400; varios rangos u otra unidad: 416; fuera del archivo: 416 con `Content-Range: bytes */total` |
| Tope | 32 MiB por respuesta (`MAX_RESPONSE_BYTES`): un rango se recorta a ese tamaño y pedir completo un archivo mayor responde 413 |
| `Content-Type` | Salido del sondeo por contenido, no de la extensión |
| Cabeceras fijas | `Accept-Ranges: bytes`, `Cross-Origin-Resource-Policy: cross-origin`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; sandbox`, `Vary: Origin` |
| CORS | Solo si `Origin` es exactamente `http://tauri.localhost` (y `http://localhost:1420` únicamente con `debug_assertions`); nunca `*`. El preflight responde 204 con `Allow-Methods: GET, HEAD, OPTIONS` y `Allow-Headers: Range` |

Un `Range` con sufijo dispara el preflight (no es una cabecera segura de CORS) y una cabecera distinta de `Range` falla en el preflight; ambos se midieron en la ventana real (`tests/e2e/real-app/protocol.e2e.ts`). Pruebas: `tests/protocol.rs`, `tests/range.rs`.

## Contraseñas y credenciales

- La contraseña viaja solo por stdin hacia `svn --password-from-stdin`, sin salto de línea final ([ADR 0003](adr/0003-credenciales-por-ui-y-stdin.md), [ADR 0005](adr/0005-password-por-stdin-sin-salto-de-linea.md)). El tipo `Password` imprime `Password(***)` en `Debug`, `redact_command` oculta `--password` en el log técnico y `RunOptions` nunca la muestra (`tests/svn_layer.rs`).
- No se guarda: `config.json` solo contiene `workspace_root`, `svn_path` y la sección `ui` (`AppConfig`); `CredentialsModal` vacía el campo tras enviar, el reintento del store del proyecto descarta las credenciales (`NO_CREDENTIALS`) y `explorerStatus.test.ts` comprueba que el store del explorador no conserva la contraseña.
- La app no usa `--no-auth-cache`: la credencial puede quedar en el auth cache de Subversion según su configuración (consecuencia aceptada en el ADR 0003).
- Un certificado TLS no confiable nunca se acepta en silencio (ADR 0004).
- Los `--username` y la contraseña de `wc_status_map` siguen el mismo camino; sin usuario, una contraseña se rechaza antes de lanzar `svn`.

## Markdown: lista de permitidos y único `v-html`

`renderMarkdown` (`src/documents/markdown/render.ts`) convierte con `marked` 18.1.1 y sanea con DOMPurify 3.4.17, ambos fijados exactos en `package.json`:

- **Lista de permitidos**: `ALLOWED_TAGS` (`a`, `b`, `blockquote`, `br`, `code`, `del`, `em`, `h1`-`h6`, `hr`, `i`, `img`, `kbd`, `li`, `ol`, `p`, `pre`, `s`, `strong`, `sub`, `sup`, tablas, `ul`) y `ALLOWED_ATTR` (`align`, `alt`, `colspan`, `href`, `rowspan`, `src`, `start`, `title`); sin atributos `data-*` ni `aria-*`; `ALLOW_UNKNOWN_PROTOCOLS: false`; `base` prohibida (y escapada antes de sanear, `neutralizeBaseTags`, porque el parseo inerte hereda la CSP).
- Después de sanear: las imágenes con esquema o `//` se sustituyen por un aviso («remotas bloqueadas»); las relativas se normalizan contra la carpeta del documento y solo se aceptan si siguen dentro del root, reescritas a `workspace-file`; los enlaces pierden el `href` (inertes) y conservan el destino en el `title`. El HTML resultante pasa por una segunda pasada de DOMPurify con la misma configuración antes de llegar a `v-html`.
- **Único `v-html`**: `src/components/documents/MarkdownPreview.vue`. `src/documents/markdown/noVHtml.test.ts` falla si otro archivo de `src` usa `v-html`, `innerHTML =`, `outerHTML =`, `insertAdjacentHTML` o `document.write(`.
- Corpus de ataques: `xssCorpus.ts` corre en la ventana real contra el DOMPurify verdadero, porque happy-dom no es un DOM fiable para esto (`viewers.e2e.ts`, `render.test.ts`).

## Imágenes y SVG

Imágenes `png`, `jpg`, `gif`, `webp`, `bmp`, `svg` e `ico` se muestran con `<img>` apuntando al protocolo; el SVG **nunca** se inserta en línea y el protocolo lo sirve con `nosniff` y `sandbox`, de modo que no ejecuta scripts. `ImageViewer.vue` llama a `img.decode()` tras `load` y, si falla (por ejemplo un PNG sin datos), cae a `BinaryCard`. Un archivo que empieza por `<svg` se abre como imagen aunque se llame `.md`: el contenido manda sobre el nombre. El SVG puede verse como código en el editor de texto.

## PDF

`pdfjs-dist` 6.4.299 empaquetado, sin CDN: worker propio, cMaps, fuentes estándar y wasm en `dist/assets/pdfjs/`. Lee por rangos de 4 MiB (`PDF_RANGE_CHUNK_BYTES`) con `disableAutoFetch` y `disableStream`, porque la primera petición completa de pdf.js recibiría 413 con archivos de más de 32 MiB; `maxImageSize` queda en 4096 × 4096 píxeles (`PDF_MAX_IMAGE_PIXELS`). `src/documents/pdf/pdfjsEval.test.ts` falla si una versión nueva reintroduce `isEvalSupported` o código dinámico.

## Apertura externa por lista permitida

`fs_open_external` (`src-tauri/src/app/files/external.rs`) es el último recurso para lo que ningún visor abre:

- **Lista permitida** (`OPENABLE_EXTENSIONS`, 33 extensiones): `pdf`, `docx`, `xlsx`, `pptx`, `odt`, `ods`, `odp`, `zip`, `7z`, `rar`, `tar`, `gz`, `bz2`, `xz`, `mp3`, `mp4`, `mkv`, `avi`, `mov`, `wav`, `flac`, `ogg`, `webm`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `txt`, `md`, `log`. Sin `doc`, `xls`, `ppt`, `rtf`, `csv`, macros, `html`, `svg`, `xml`, ejecutables ni scripts. La comparación ignora mayúsculas y usa solo la última extensión.
- **Re-sondeo**: aunque la extensión sea permitida, un archivo cuyos dos primeros bytes sean `MZ` (cabecera de ejecutable) se rechaza con `NotAllowed`.
- La ruta pasa por `resolve` (rechaza `archivo.txt:flujo`, nombres con punto o espacio final y `..`), `.svn`/`_svn`, junctions que salen del root y archivos solo-nube; una carpeta nunca se abre.
- El lanzador es una dependencia inyectable (`Launcher`; `SystemLauncher` usa la crate `opener` fijada en `=0.9.0`); las pruebas usan uno falso que registra que nunca se invoca ante un rechazo (`tests/open_external.rs`).
- Ninguna prueba E2E abre un ejecutable ni lanza la aplicación predeterminada: `binary.e2e.ts` comprueba que el botón aparece o no y el clic usa una respuesta simulada de la compuerta de IPC que no llega a Rust.

## Límites

| Límite | Valor | Dónde |
|---|---|---|
| Archivo editable | 5 MiB (`MAX_EDITABLE_BYTES`); mayor: se ofrece como binario con hexadecimal | `app/files/text.rs`, `src/documents/limits.ts` |
| Respuesta del protocolo | 32 MiB (`MAX_RESPONSE_BYTES`) | `app/range.rs` |
| Tramo del visor hexadecimal | 64 KiB (`HEX_CHUNK`), 8 tramos en caché | `app/files/text.rs`, `src/documents/useHexChunks.ts` |
| Entradas por listado | 20 000 (`MAX_LIST_ENTRIES`), con `truncated` | `app/files/mod.rs` |
| Entradas de estado | 20 000 (`MAX_STATUS_ENTRIES`), con `truncated` | `app/wc_status.rs` |
| Bytes de sondeo | 8 KiB (`SNIFF_BYTES`) | `app/sniff.rs` |
| Directorio central ZIP al sondear | 20 000 entradas y 4 MiB; ZIP64 se rechaza | `app/container.rs` |
| Directorio OLE2 al sondear | 1024 sectores de directorio y 1024 de DIFAT, con cadena acotada | `app/container.rs` |
| Entrada de un tarball al sondear | 4 MiB de entrada, 512 bytes leídos y 64 MiB de memoria de xz | `app/compressed_tar.rs` |
| Documento Office | 32 MiB (`MAX_OFFICE_BYTES`); más grande se clasifica pero no se lee ni se escribe | `app/files/mod.rs` |
| Estado de interfaz | 200 favoritos, 64 pestañas, 500 vistas | `app/ui_state.rs` |
| Plazos de `svn` | 120 s por consulta, 1 h por operación larga, 5 s para detectar la versión | `svn/runner.rs`, `app/operations.rs`, `svn/locator.rs` |

## Escritura atómica y versión con hash

`FileService::write_text` (`src-tauri/src/app/files/edit.rs`) solo escribe sobre un archivo regular existente, no solo-nube y no de solo lectura. Orden: toma sin esperar el candado de la copia (`WorkingCopyBusy` si hay un update o commit), comprueba que la **versión** esperada siga siendo la del disco (`FileChanged` si cambió), escribe un temporal único `<nombre>.<pid>-<n>.dd-tmp` en la misma carpeta (`create_new`, con reintentos si el nombre existe), hace `sync_all` y lo renombra sobre el destino. Si algo falla, borra el temporal. Un renombrado que choca con otro proceso devuelve `FileLocked` (códigos de Windows 5, 32 y 33).

La versión es una cadena opaca `longitud-marcaDeEscritura-FNV1a64(contenido)` (`app/files/version.rs`): detecta cambios externos aunque el tamaño y la fecha coincidan. Conserva BOM, codificación (UTF-8 o UTF-16 siempre con BOM) y final de línea. Tras guardar se invalida la caché de estado SVN. Limitación: el reemplazo por renombrado no conserva atributos ni ACL del original (**T-16**).

## Cierre de ventana con latido

El cierre lo intercepta Rust sin ampliar capabilities ([ADR 0009](adr/0009-cierre-de-ventana-interceptado-en-rust.md); `app/closing.rs`, `commands/window.rs`, `src/composables/useWindowClose.ts`). Si el frontend no avisó que está listo, o vence `CLOSE_TIMEOUT` (5 s) sin respuesta, Rust cierra directo para que la ventana nunca quede imposible de cerrar; la confirmación del frontend (`app_confirm_close`) usa `destroy()`. Mientras hay guards registrados (un diálogo puede estar abierto) la página envía `app_hold_close` de inmediato y cada `HOLD_PING_MS` (2 s); Rust pasa a `Deciding` y solo cierra si pasan `HOLD_KEEPALIVE_TIMEOUT` (6 s) sin latido. Un latido tardío no revive una decisión vencida ni inicia otra tras cancelar o confirmar. Compromiso aceptado (**T-24**): si el JS se cuelga antes del primer latido, el failsafe de 5 s cierra la ventana aun con texto sin guardar. Pruebas: `tests/closing.rs` (reloj simulado) y `shell.e2e.ts` / `editor-close.e2e.ts` (ventana real).

## `config.json` durable y cuarentena

`ConfigStore` (`src-tauri/src/config/mod.rs`) vive en `app_config_dir` y escribe `config.json.tmp`, `sync_all` y renombra. Un JSON corrupto se mueve a `config.json.bad` (o `.bad.1`, `.bad.2`... si ya existe) y se arranca con valores por defecto; una sección `ui` con forma inválida o versión desconocida se lee como valor por defecto sin tocar `workspace_root` ni `svn_path` y sin cuarentena. Si el archivo existe pero no se puede leer (error de E/S), `AppState` se niega a sobrescribirlo. `DAKEDADUCK_CONFIG_DIR` (ruta absoluta) solo se respeta con `debug_assertions` o la característica `e2e-config-dir`; el instalador se compila sin ella.

## Deuda de seguridad abierta

Del [ledger](TECH_DEBT.md); ninguna bloquea:

| ID | Resumen |
|---|---|
| T-15 | Ventana entre validar y abrir una ruta en `list`/`probe`: una junction podría hacer leer fuera del root nombres, metadatos y hasta 8 KiB |
| T-6 | Si la aplicación muere a mitad de un commit queda el mensaje en `%TEMP%` |
| T-24 | Failsafe de 5 s del cierre con texto sin guardar (compromiso del ADR 0009) |
| T-16 | El guardado por renombrado no conserva atributos ni ACL |
| T-17 | La prueba del nombre corto 8.3 puede pasar en vacío |

## `svn.exe` incluido (Increment 10)

El `svn.exe` que viaja con el instalador se verifica en cada detección contra `third_party/svn.manifest.json` (tamaño y SHA-256 de los 23 archivos, y ninguna DLL o ejecutable de más). Un conjunto alterado o incompleto se ignora con aviso y la aplicación no lo ejecuta. Es una comprobación de **integridad**: el usuario (y cualquier proceso suyo) puede escribir en la carpeta de instalación por usuario y reemplazar a la vez archivos y el manifiesto embebido solo cambiando el ejecutable, así que no es una defensa frente a un atacante local con ese nivel de acceso; el modelo de amenaza es el mismo que el de cualquier `svn.exe` que el usuario instale. Un `svn` anterior a 1.14.4 (CVE-2024-45720) se acepta con un aviso persistente.

## Comprimidos (Increment 7)

Un comprimido es una entrada hostil que escribe a disco. La defensa vive en `app/archive` y no depende de la biblioteca de cada formato (ninguna filtra los nombres, medido en el spike S3):

- **Ruta de cada entrada**: `safety::sanitize` normaliza ``\`` y `/` y rechaza lo que Windows interpretaría fuera de la carpeta o de forma especial (absolutas, UNC, rutas de dispositivo, unidades, `..`, `.svn`/`_svn`, `:` de flujos alternos, nombres reservados, final en punto o espacio, caracteres no válidos, longitudes y profundidad). Después `Workspace::resolve` (sin sobrescribir) y `revalidate` justo antes de abrir cada archivo con `create_new`, de modo que un enlace o una junction que apareciera entre medias no lleva fuera del Workspace Root.
- **Nada de enlaces ni dispositivos**: se omiten y se informan; jamás se crea un enlace.
- **Topes sobre lo escrito, no sobre lo declarado**: cada sink cuenta bytes reales contra el tope por archivo y el total; el listado además marca la razón de compresión y la profundidad para pedir confirmación. Un zip que miente en su cabecera lo detecta la propia biblioteca (`File is larger than its declared uncompressed size`) y, si no, el contador. 7z rechaza un bloque declarado de más de 256 MiB antes de decodificar (medido: 1 GiB lleva el proceso a 1,2 GiB aunque se aborte); xz tiene `memlimit` de 256 MiB; la lectura de tar comprimido tiene tope de 4 GiB descomprimidos y es cancelable.
- **Cifrados**: se detectan (cabecera o entrada) y se rechazan; no hay contraseñas.
- **Concurrencia**: la extracción toma el candado de escritura de la carpeta de destino (`try_lock_for_write`, anidado con la copia de trabajo que la contiene): si hay una operación SVN en curso devuelve `working_copy_busy` en vez de esperar.
- **Cancelación y fallo**: todo o nada; se borra la carpeta nueva (única cosa creada) y no se toca nada más.

La interfaz (Increment 8) no decide nada de seguridad: envía la ruta, un id de tarea y `allow_suspicious`, que solo vale `true` tras mostrar al usuario las sospechas (`declared_size`, `ratio`, `depth`) y recibir su clic en «Extraer de todos modos». Los nombres del comprimido se pintan como texto (Vue escapa el HTML) y los caracteres de control, de ancho cero y bidireccionales se muestran como `‹U+XXXX›` para que una entrada `factura‮fdp.exe` no engañe. Verificado en la ventana real: un nombre `<img src=x onerror=…>` no crea ningún elemento ni ejecuta nada.

**Hallazgo del Increment 9 (2026-10-18):** un `.7z` con la firma y la suma de verificación de la cabecera inicial correctas pero con el tamaño de la cabecera siguiente absurdo (`0x0101010101010101`) hacía que `sevenz-rust2` intentara reservar ~72 PB y el proceso entero abortaba (`memory allocation failed`, no es un pánico y ni siquiera se puede capturar). La E2E de clasificación lo descubrió porque su fixture de 7z tenía justo esa forma. `reader_7z.rs` valida ahora la cabecera inicial antes de abrir la biblioteca: el tamaño no puede pasar de 16 MiB y posición más tamaño deben caber en el archivo; si no, `archive_corrupt`. Prueba de regresión en `archive_list.rs` y 2 400 variantes mutadas al azar de 7z (más 400 de zip y 400 de RAR) sin un solo aborto. Lo que no se puede descartar es que otra reserva proporcional a un campo interno de la cabecera de otro formato tenga la misma forma.

Antes de extraer se compara el tamaño declarado con el espacio libre del disco (`app/disk.rs`, `GetDiskFreeSpaceExW`) y se rechaza como `archive_limit` si no alcanza; si la consulta falla no se bloquea y un disco lleno se detecta al escribir y se limpia. Riesgos residuales: `panic = "abort"` en release significa que un pánico de una biblioteca de comprimidos cerraría la aplicación (no se halló ninguno en 300 variantes corruptas de RAR ni en las pruebas hostiles de zip, tar y 7z); `sevenz-rust2` 0.20.2 y `rars` 0.10.0 son las últimas versiones que compila el compilador 1.88 del proyecto (ver T-28).

## Atribución de iconos

Los iconos de la interfaz son Solar de 480 Design (licencia CC BY 4.0), tomados de DocuMalia e incrustados como rutas SVG en `src/utils/iconPaths.ts`; la atribución está en el encabezado de ese archivo. La excepción es el icono `save`, dibujado a mano y propio del proyecto.
