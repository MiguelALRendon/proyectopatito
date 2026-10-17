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
img-src 'self' data: blob: http://workspace-file.localhost; font-src 'self';
connect-src ipc: http://ipc.localhost http://workspace-file.localhost;
worker-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'
```

`devCsp` es igual y añade `ws://localhost:1420 http://localhost:1420` a `connect-src` para `tauri dev`, que por eso **no prueba la CSP real**: solo el ejecutable compilado la aplica ([ADR 0008](adr/0008-pruebas-de-ventana-real-por-cdp.md)).

Lo medido sobre la ventana real (detalle en [entorno de desarrollo](human-explanations/entorno-desarrollo.md)):

- La página vive en `http://tauri.localhost`; el protocolo propio, en `http://workspace-file.localhost`; el IPC, en `http://ipc.localhost`.
- Tauri solo agrega hashes SHA-256 a `script-src`; `style-src 'unsafe-inline'` queda como está, de modo que los estilos dinámicos de Monaco funcionan sin `dangerousDisableAssetCspModification`.
- Los workers de Monaco y de pdf.js se sirven desde `tauri.localhost/assets/`: basta `worker-src 'self'`, sin `blob:`, sin `'unsafe-eval'` y sin `'wasm-unsafe-eval'`. `font-src 'self'` basta para la fuente `codicon` de Monaco y para pintar PDF.
- Los scripts de worker llegan sin cabecera `Content-Security-Policy`, así que una violación dentro de un worker no dispara `securitypolicyviolation` en el documento; por eso `viewers.e2e.ts` también comprueba las peticiones reales.

Vigilancia: el arnés E2E registra cada `securitypolicyviolation` y cada petición a un host que no sea `tauri.localhost`, `ipc.localhost` o `workspace-file.localhost` (`tests/e2e/real-app/harness.ts`). `smoke.e2e.ts` comprueba además que una petición externa y un script en línea **sí** violan la CSP y no se ejecutan; el resto de las pruebas exigen cero violaciones.

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
| Estado de interfaz | 200 favoritos, 64 pestañas, 500 vistas | `app/ui_state.rs` |
| Plazos de `svn` | 120 s por consulta, 1 h por operación larga, 5 s para detectar la versión | `svn/runner.rs`, `app/operations.rs`, `app/svn_locator.rs` |

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

## Diferido (Fase 2B, `proposed`)

Nada de lo siguiente existe en el código: aislamiento de origen cruzado y protocolo `zeta-assets` para ZetaOffice ([ADR 0010](adr/0010-aislamiento-de-origen-cruzado-y-zetaoffice-como-recurso.md)), lectura y extracción de comprimidos en Rust con validación de entradas ([ADR 0011](adr/0011-comprimidos-leidos-y-extraidos-en-rust.md)) y `svn.exe` empaquetado con verificación de hash ([ADR 0012](adr/0012-svn-exe-como-recurso-del-instalador.md)). Ver `plans/fase-2b-documentos`.

## Atribución de iconos

Los iconos de la interfaz son Solar de 480 Design (licencia CC BY 4.0), tomados de DocuMalia e incrustados como rutas SVG en `src/utils/iconPaths.ts`; la atribución está en el encabezado de ese archivo. La excepción es el icono `save`, dibujado a mano y propio del proyecto.
