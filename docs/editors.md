---
id: ref-editors
title: Editores, visores y registro de proveedores
type: reference
status: current
source: both
last_verified: 2026-10-16
symbols: [DocumentProvider, registerProvider, chooseProvider, registerBuiltinProviders, DocumentHost, classify, ProbeKind]
related: [ref-architecture, ref-security, ref-roadmap, adr-0002, adr-0006]
---

# Editores, visores y registro de proveedores

Cuando el usuario abre un archivo en una pestaña de documento, la aplicación decide qué componente lo muestra por el **contenido** del archivo y no solo por su nombre (Core Tenet 4: nunca mentir ni fingir). La decisión tiene dos pasos: el sondeo en Rust y la elección de proveedor en el frontend.

## 1. Sondeo (`fs_probe`)

`FileService::probe` (`src-tauri/src/app/files/mod.rs`) lee los primeros 8 KiB (`SNIFF_BYTES`) y `inspect` (`app/inspect.rs`) devuelve un `ProbeKind`, el MIME, la longitud, `has_macros` y, solo para documentos de Office de hasta 32 MiB, la `version` (el mismo token opaco de `fs_read_text`). Orden de decisión:

1. **Office**, solo si la extensión es una de las nueve (`docx`, `xlsx`, `pptx`, `odt`, `ods`, `odp`, `doc`, `xls`, `ppt`) **y** el contenido coincide (`app/office.rs`, `app/container.rs`): un ZIP cuyo directorio central completo trae `[Content_Types].xml` y una carpeta del formato (`word/`, `xl/`, `ppt/`), o un ZIP ODF cuyo primer `mimetype` guardado sin comprimir declara el MIME de esa extensión, o un OLE2 cuyo directorio contiene `WordDocument`, `Workbook`/`Book` o `PowerPoint Document` según la extensión. Un contenedor que no coincide (un `.zip` renombrado `.docx`, un `.xls` renombrado `.doc`, un `.msi` o `.msg`) cae a binario, nunca a comprimido. `has_macros` es verdadero con `vbaProject.bin`, `Basic/` o `Scripts/`, o con los almacenamientos `Macros`, `_VBA_PROJECT_CUR` o `VBA`.
2. **Tarball comprimido** (`app/compressed_tar.rs`), solo si el nombre es `.tar.gz`/`.tgz`, `.tar.bz2`/`.tbz2`/`.tbz` o `.tar.xz`/`.txz`, la firma coincide y el primer bloque descomprimido es una cabecera `ustar` con suma de verificación correcta; un `.gz`, `.bz2` o `.xz` suelto es binario.
3. Imagen, si la cabecera es coherente: PNG, JPEG, GIF, WEBP, BMP o ICO.
4. PDF, si empieza por `%PDF-` seguido de un dígito.
5. **Audio, vídeo y comprimidos por firma** (`app/media.rs`), con campos de cabecera coherentes: ID3 y cabecera de trama MPEG (esta solo con extensión `mp3`, `mp2` o `mpga`), RIFF `WAVE` y `AVI`, `fLaC`, `OggS` con códec conocido, `ftyp` de MP4/M4A/MOV con marca conocida, EBML de WebM y Matroska, 7z (con CRC de su cabecera), RAR4 y RAR5, y `ustar` con suma de verificación. La extensión solo decide audio o vídeo donde el contenedor es común (`m4a`/`m4b`, `weba`/`mka`).
6. **ZIP genérico**: archivo comprimido si su directorio central es válido; si no, binario.
7. Binario, si el contenido no es texto: UTF-8 válido sin bytes NUL, o UTF-16 con marca BOM.
8. SVG (también `ProbeKind::Image`), si el texto, tras el prólogo, abre con `<svg`.
9. Texto, en cualquier otro caso.

| `ProbeKind` | Significado |
|---|---|
| `text` | Texto UTF-8 o UTF-16 con BOM |
| `image` | PNG, JPEG, GIF, WEBP, BMP, ICO o SVG |
| `pdf` | PDF |
| `office` | Documento de Office reconocido por extensión y contenido |
| `audio` | MP3, WAV, FLAC, Ogg, M4A, WebM o Matroska de solo audio |
| `video` | MP4, MOV, AVI, WebM, Matroska u Ogg Theora |
| `archive` | ZIP, tar, tar.gz/bz2/xz, 7z o RAR |
| `binary` | Todo lo demás |
| `cloud` | Archivo solo en la nube: no se lee (ver [workspace](workspace.md#archivos-solo-en-la-nube-onedrive)) |

Los cinco tipos nuevos de la Fase 2B tienen visor (`office`, `audio`, `video` y `archive`); cuando el visor no puede mostrar el archivo cae a `BinaryCard`, con su etiqueta de tipo. Un archivo de menos de 512 bytes sin NUL se sigue clasificando como texto, como antes. Pruebas: `src-tauri/tests/{sniff,office_sniff,media_sniff,files}.rs` y `tests/e2e/real-app/classify.e2e.ts`.

`fs_write_bytes` (cabeceras `path` codificada y `expected-version`, cuerpo binario crudo) escribe un documento Office ya existente con el escritor atómico de `fs_write_text` y sus mismos errores, con tope de 32 MiB (`OfficeTooLarge`). Pruebas: `src-tauri/tests/write_bytes.rs`.

## 2. Registro de proveedores

Código: `src/documents/registry.ts` y `src/documents/providers.ts`.

```ts
interface DocumentProvider {
  id: string;
  label: string;
  matches: (context: { path: string; probe: FileProbe }) => number;
  component: Component;
}
```

- `chooseProvider` evalúa `matches` de cada proveedor registrado y elige el de **mayor puntaje**; `0` (`NO_MATCH`) significa «no me corresponde». Un `matches` que lanza o devuelve un valor no finito cuenta como `NO_MATCH`. Ante un empate gana el primero registrado.
- `registerProvider` reemplaza al proveedor con el mismo `id`.
- `registerBuiltinProviders()` se llama una vez en `src/main.ts`.
- `DocumentHost.vue` hace el sondeo, muestra el estado «Abriendo el documento…», y monta el componente elegido con las propiedades `path` y `probe`; escucha su evento `reprobe` para volver a sondear. Si el sondeo falla muestra `BinaryCard` con el error y un botón «Reintentar».

## Proveedores existentes

| `id` | Etiqueta | Puntaje | Condición (`matches`) | Componente |
|---|---|---|---|---|
| `text` | Texto y código | 10 | `probe.kind === 'text'` y no supera 5 MiB | `TextEditor` |
| `markdown` | Markdown | 20 | Extensión `md` y se cumple la condición de `text` | `MarkdownEditor` |
| `image` | Imagen | 20 | `probe.kind === 'image'` | `ImageViewer` |
| `pdf` | PDF | 20 | `probe.kind === 'pdf'` | `PdfViewer` |
| `binary` | Binario | 1 | Cualquier tipo salvo `cloud` | `BinaryCard` |

**Tarjeta «solo en la nube»**: no es un proveedor. `DocumentHost` muestra `CloudOnlyCard` cuando `probe.kind === 'cloud'`, antes de consultar el registro; el botón «Descargar y abrir» vuelve a sondear con `allow_download: true`.

Consecuencias de los puntajes: un `.md` cuyo contenido no es texto cae a `binary` (el nombre no manda); un `.md` válido usa el editor de Markdown (20) y no el de texto (10); un archivo de texto mayor de 5 MiB no tiene proveedor de edición y cae a `binary`, que lo ofrece con hexadecimal.

### Texto y código (`TextEditor`)

Monaco ([ADR 0002](adr/0002-monaco-como-editor.md)), cargado de forma diferida en su propio fragmento: solo se descarga al abrir un documento de texto. Lenguaje por extensión, resaltado, búsqueda y reemplazo, minimapa y números de línea (`src/documents/monaco/setup.ts`); tema tomado de los tokens CSS; workers de JSON, CSS y HTML empaquetados (sin red; JavaScript y TypeScript conservan el resaltado por Monarch y no empaquetan `ts.worker`, deuda **T-22**). La barra de estado muestra codificación, BOM y fin de línea. El estado de cada pestaña (original, versión de disco, texto, suciedad, solo lectura, conflicto) vive en `src/stores/documents.ts`. Guardar (Ctrl+S o botón) usa `fs_write_text` con la versión esperada y [escritura atómica](security.md#escritura-atómica-y-versión-con-hash); si el archivo cambió en disco se ofrece Cancelar, Recargar o Sobrescribir, y ningún error toca el texto del usuario. Un fin de línea mixto se pregunta antes de guardar.

### Markdown (`MarkdownEditor`, `MarkdownPreview`)

Modos Editor, Vista previa y Dividido (el reparto se redimensiona); el editor es el `TextEditor`. La vista previa pasa por el saneador de lista de permitidos descrito en [seguridad](security.md#markdown-lista-de-permitidos-y-único-v-html): imágenes remotas bloqueadas, relativas reescritas al protocolo, enlaces inertes.

### Imagen (`ImageViewer`)

`<img>` sobre el protocolo `workspace-file`. SVG siempre como imagen y, a petición, como código en un `TextEditor`. Si la imagen falla (`load` sin `decode()` válido) muestra el aviso y cae a `BinaryCard`.

### PDF (`PdfViewer`)

`pdfjs-dist` empaquetado, lectura por rangos de 4 MiB, paginación y zoom (pasos de 0,5 a 4); PDF con contraseña o dañado cae a `BinaryCard` con el motivo. No hay capa de texto seleccionable. Detalles de CSP y límites en [seguridad](security.md#pdf).

### Documentos de Office (`OfficeViewer`)

Proveedor `office` (`VIEWER_SCORE`, por `kind: office`). Abre los nueve formatos en **ZetaOffice** (LibreOffice 24.2 WebAssembly) dentro de un `<iframe>` creado por `officeHost` en el contenedor del propio visor, dentro de la pestaña del documento (no hay capa flotante). Solo existe la pestaña activa: al cambiar de pestaña el visor se desmonta, se destruye el iframe y `officeHost.destroy()` espera a que la memoria del WebView baje de 1 GiB (o 30 s) antes de crear otro, porque dos instancias a la vez sumaron 3,96 GiB.

- **Carga diferida**: sin abrir un Office no se pide nada a `zeta-assets` ni existe el iframe (E2E). `host.js` descarga `soffice.wasm` y `soffice.data` por tramos de 8 MiB con `Range`, los entrega a Emscripten (`wasmBinary`, `getPreloadedPackage`) y avisa `ready`; el visor muestra el progreso.
- **Bytes**: la página baja el archivo con un solo `fetch` a `workspace-file` (el tope de 32 MiB de la respuesta coincide con `MAX_OFFICE_BYTES`, así que no hacen falta tramos) y lo transfiere por el puerto; `host.js` lo escribe en `/tmp/office/<uuid>.<ext>` del sistema de archivos virtual. El nombre del usuario no entra.
- **Apertura**: `MacroExecutionMode` = `NEVER_EXECUTE`, `UpdateDocMode` = `NO_UPDATE`. Si `has_macros`, aviso persistente («no se ejecutan»). El contenedor expone `data-phase` (`loading`, `ready`, `failed`) y `data-kind` (`writer`, `calc`, `impress`).
- **Tamaño**: la ventana interna de LibreOffice se ajusta con `setPosSize` cada vez que cambia el tamaño del iframe (`resize` con 150 ms de debounce en `host.js`) y la barra de título interna queda oculta desplazando el lienzo 26 px; el contenedor tiene altura mínima `--size-office-min-height` (360 px) y desplaza en vez de desbordar.
- **Caídas a `BinaryCard`** con aviso (`OFFICE_FAILURE_NOTICES`): más de 32 MiB, WebView2 sin aislamiento de origen cruzado / `SharedArrayBuffer` / WebAssembly (`isOfficeSupported`), tiempo máximo de 60 s, fallo al iniciar, documento dañado o no legible. La apertura externa solo aparece para formatos de la lista permitida (doc, xls y ppt no la tienen).
- **Acciones vetadas** (Abrir, Guardar como, Exportar, Enviar, Cerrar, Salir, Nuevo, macros…): no hacen nada y el visor muestra un aviso con `data-command`. Detalle y trampas en [seguridad](security.md#zeta-assets-el-iframe-de-zetaoffice-y-la-frontera-del-webview-fase-2b-increment-4).
- **Guardar** (Increment 5): el estado de cada documento vive en `src/stores/office.ts` (`OfficeSession`: versión esperada, sucio, guardando, solo lectura, conflicto, error, aviso de fidelidad aceptado). El iframe avisa `modified` solo cuando `isModified()` es verdadero y no mientras `store()` corre (LibreOffice notifica también al limpiar la bandera); la pestaña muestra el punto de cambios y el visor el chip «Modificado» y el botón «Guardar». Guardar pide los bytes al iframe (`store()` conserva el formato original), los escribe con `fs_write_bytes` y la `expected-version` de la sesión, y actualiza la versión. Ctrl+S dentro de ZetaOffice llega como `save-requested` y sigue el mismo camino; un guardado que no inició la aplicación (`OnSaveDone`) se envía igualmente a disco y, si falla, el documento queda sucio. Una edición mientras se guarda deja el documento sucio al terminar.
- **Errores al guardar**: cambio externo → diálogo de conflicto de la 2A (Cancelar / Recargar / Sobrescribir; sobrescribir relee la versión del disco), solo lectura → aviso con «Reintentar guardado», `FileLocked`, `WorkingCopyBusy` y demás → aviso con «Reintentar»; en todos los casos los cambios se conservan. En doc, xls y ppt se avisa de la posible pérdida de formato antes de la primera escritura de la sesión. Más de 32 MiB no se escribe.
- **Un documento vivo, que sobrevive a otras pestañas**: `TabContent` renderiza un panel por pestaña (la activa más la del documento Office vivo, en orden estable y con `v-show`), de modo que ir al explorador y volver no recrea el iframe ni pierde los cambios. Solo hay un iframe: al abrir otro Office, si el vivo tiene cambios se pregunta (Cancelar vuelve a esa pestaña, Descartar, Guardar y continuar); si está limpio se suelta sin preguntar y su pestaña se reabre desde el disco al volver. Cerrar la pestaña o la ventana con cambios usa las confirmaciones de la 2A (`windowClose.ts` incluye las sesiones de Office).
- **Recarga**: «Recargar» tras un conflicto cierra el documento, relee versión y bytes y lo vuelve a abrir.
- **Gancho de pruebas**: `window.__officeTest` (insertar, leer, tamaño de la ventana interna, despachar un comando) dentro del iframe, servido por `office_test.js` y `office_test_thread.js`, que **solo existen en compilaciones de depuración o con `e2e-config-dir`** (404 en el instalador; comprobado el 2026-10-21 sobre el ejecutable de `tauri build`, que no contiene `__officeTest`).

### Audio y vídeo (`MediaPlayer`, `MediaCard`)

Proveedor `media` (`VIEWER_SCORE`, por `kind: audio` o `video`). `<audio>` o `<video>` con `src` al protocolo `workspace-file` (el `Range` lo resuelve el protocolo de la 2A), `preload="metadata"`, sin reproducción automática; los controles son propios: reproducir o pausar, posición (`aria-valuetext` «0:12 de 1:05»), silenciar, volumen y, en vídeo, pantalla completa. Teclado sobre el reproductor (grupo enfocable que nombra el archivo y sus atajos): Espacio reproduce o pausa, flechas izquierda y derecha buscan 5 s, arriba y abajo cambian el volumen un 10 %, `M` silencia y `F` pantalla completa; las combinaciones con Ctrl, Alt o Meta no se toman. El volumen no se guarda.

**Cuándo cae a `MediaCard`** (que envuelve `BinaryCard` con el motivo y, si llegaron, la duración y las dimensiones): `canPlayType(mime)` vacío (formato que el WebView no reconoce, sin crear siquiera el elemento) o el evento `error` con su código (`aborted`, `network`, `decode`, `unsupported`). La apertura externa sigue la lista permitida de la 2A. Al desmontar se libera el archivo (pausa, quita `src` y recarga).

**Matriz medida en la ventana real** (`media.e2e.ts`, archivos generados por código o grabados con `MediaRecorder` dentro del propio WebView; no hay `ffmpeg` ni archivos de terceros):

| Formato | Resultado |
|---|---|
| WAV PCM, MP3, FLAC | reproducen, buscan y piden el archivo con `Range` |
| WebM (Opus; VP8 + Opus), MP4 (H.264 + AAC), MKV (H.264 + Opus) | reproducen |
| AVI, pista WAV corrupta, ruido con nombre `.mp3` | tarjeta (no reconocido, no compatible o binario) |
| Medidos antes (S2, ver `plans/fase-2b-documentos/spikes.md`) | OGG Vorbis, M4A, WebM VP9 y AV1 reproducen; WMV, FLV, MPEG, Theora, WMA y MKV con VP9 + Opus no; HEVC sin verificar |

Trampas medidas: un FLAC con una sola trama o con la tasa «tomada de STREAMINFO» en la cabecera de trama falla con `PTS is not defined` en el demultiplexor de FFmpeg (hay que declarar los 8 kHz en cada trama y partirlo en varias); Chromium reutiliza su caché de medios del mismo URL, así que una prueba que quiere ver el `Range` necesita un archivo propio.

### Binario y hexadecimal (`BinaryCard`, `HexViewer`)

La tarjeta muestra nombre, tipo, tamaño y MIME, y un aviso cuando un archivo de nombre `.md` o `.txt` no es texto o cuando el texto supera el límite. El visor hexadecimal es de solo lectura, virtualizado (filas de 16 bytes) y pide a Rust tramos de 64 KiB con `fs_read_chunk` (`useHexChunks`, 8 tramos en caché). El botón «Abrir con la aplicación predeterminada» (`OpenExternalButton`) aparece solo si `fs_can_open_external` lo permite: lista permitida y re-sondeo descritos en [seguridad](security.md#apertura-externa-por-lista-permitida).

## Límites

| Límite | Valor |
|---|---|
| Edición de texto | 5 MiB (`MAX_EDITABLE_BYTES`, definido en Rust y en `src/documents/limits.ts`) |
| Respuesta del protocolo | 32 MiB |
| Lectura inicial de PDF | 4 MiB |
| Tramo del hexadecimal | 64 KiB |
| Bytes de sondeo | 8 KiB |

## Cómo se agrega un proveedor

1. Crear el componente en `src/components/documents/` con las propiedades `path: string` y `probe: FileProbe` y el evento `reprobe`. Si edita, usar `useDocumentTab()` (`src/documents/tabContext.ts`) para el estado de la pestaña. Leer solo por `fs_*` o por el protocolo con `fileUrl(path)`; nunca importar `@tauri-apps` (lo vigila `src/services/boundary.test.ts`).
2. Si el tipo nuevo requiere distinguirlo por contenido, ampliar `classify` en `src-tauri/src/app/sniff.rs`, el `ProbeKind` de Rust y `PROBE_KINDS` en `src/services/filesApi.ts` (TypeScript obliga a completar `KIND_LABELS` de `BinaryCard`), y la lista `probe_kinds` de `src-tauri/tests/fixtures/contract.json` (que `contract.rs` compara con `ProbeKind`).
3. Escribir su función `matches*` en `src/documents/providers.ts` con un puntaje coherente (20 para visores específicos, 10 para texto genérico, 1 para la caída) y registrarlo en `registerBuiltinProviders()`.
4. Definir la **caída segura**: si el visor no puede mostrar el archivo, debe caer a `BinaryCard` con un aviso, como hacen `ImageViewer` y `PdfViewer`.
5. Pruebas: `src/documents/registry.test.ts` para el puntaje, pruebas del componente (happy-dom) y un E2E en la ventana real que falle ante violaciones de CSP ([pruebas](testing.md)). Si lee archivos grandes, usar `Range` en lugar de pedir el archivo completo (el protocolo responde 413 sobre 32 MiB).

## Comprimidos (Increments 7 y 8)

El listado y la extracción viven en Rust (`app/archive`, [ADR 0011](adr/0011-comprimidos-leidos-y-extraidos-en-rust.md)) y el proveedor `archive` (`VIEWER_SCORE`, por `kind: archive`) los muestra en `ArchiveViewer.vue`. Formatos por sufijo del nombre: `.zip`, `.tar`, `.tar.gz`/`.tgz`, `.tar.bz2`/`.tbz2`/`.tbz`, `.tar.xz`/`.txz`, `.7z` y `.rar`.

| Comando | Qué hace |
|---|---|
| `archive_list(path, task_id)` | Entradas (hasta 5 000, con `truncated`), tamaños declarados, `encrypted`, `suspicions` (`declared_size`, `ratio` mayor de 200:1 desde 16 MiB declarados, `depth` mayor de 32) y, por entrada, `skip_reason` si no se extraerá |
| `archive_extract(path, task_id, allow_suspicious)` | Extrae **todo** a una carpeta nueva junto al comprimido (`<nombre sin extensión>`, o `-2`, `-3`… si existe); la interfaz no envía nombres ni selección. Devuelve carpeta, archivos, carpetas, bytes y omitidos con su razón (máx. 1 000 más un contador) |
| `archive_cancel(task_id)` | Marca la tarea; el identificador lo elige la interfaz (`newArchiveTaskId`) y el evento `archive://progress` lo repite |

Reglas de la extracción: todo o nada (ante cualquier error o cancelación se borra la carpeta nueva, que es lo único que se creó); un archivo cifrado se rechaza antes de escribir (`archive_encrypted`, no se piden contraseñas); `suspicions` sin confirmar devuelve `archive_needs_confirmation` con los códigos y la interfaz repite con `allow_suspicious`; los topes duros (4 GiB totales, 2 GiB por archivo, 50 000 entradas, 256 MiB por bloque 7z y por miembro RAR) no se saltan con la confirmación y se cuentan sobre lo realmente escrito. Se omiten enlaces, dispositivos y toda entrada con ruta absoluta, UNC, unidad, `..`, `.svn`/`_svn`, `:`, nombre reservado de Windows, final en punto o espacio, carácter no válido, más de 255 unidades UTF-16 por componente, más de 64 niveles o ruta final de más de 240 caracteres. Dos nombres que solo difieren en mayúsculas no se pisan: el segundo recibe `-2`. Si un nombre ya lo ocupa un archivo y la entrada es una carpeta, o al revés, se omite.

### Visor y extracción (Increment 8)

- **`ArchiveViewer.vue`** pide `archive_list` con un id de tarea propio (`newArchiveTaskId`), lo cancela si cambia la ruta o se desmonta y descarta una respuesta tardía. Muestra una tabla accesible (`role="table"`, `aria-rowcount`, `aria-rowindex`) con nombre, tamaño, tamaño comprimido y estado de cada entrada, y en la barra el formato, el número de entradas y el tamaño descomprimido. No hay fecha: el contrato de listado no la trae.
- **Sin virtualización por posición**: el listado tiene como máximo 5 000 filas (`truncated` avisa de que hay más) y cada fila usa `content-visibility: auto`, así que el navegador no maquetea ni pinta las que no se ven. Se mantienen todas en el DOM para que la lectura de pantalla y la búsqueda del navegador funcionen.
- **Nombres**: Vue escapa el HTML al pintar y `displayName` convierte los controles C0/C1, los de ancho cero y los bidireccionales (`U+202A–202E`, `U+2066–2069`…) en `‹U+202E›`; la fila queda marcada «Nombre con caracteres ocultos». Las entradas que no se extraerán (enlaces, especiales, nombres no seguros) llevan su razón.
- **Cifrados**: se listan con un aviso y el botón «Extraer todo…» queda deshabilitado. Si el listado no se puede leer (dañado, no soportado, demasiado grande) cae a `BinaryCard` con el mensaje de Rust.
- **`ExtractDialog.vue`** (sobre `BaseModal`) usa `useArchiveExtraction`: estados `idle → running → done | failed | cancelled | needs_confirmation`. Antes de empezar dice que se creará una carpeta nueva junto al archivo (el nombre lo elige Rust y solo se muestra en el resultado), avisa si la ruta pasa por una carpeta `OneDrive` y, si el listado trae sospechas, las enumera y cambia el botón a «Extraer de todos modos» (que envía `allow_suspicious`). Mientras extrae muestra una barra `<progress>` con archivos y bytes (evento `archive://progress` filtrado por id), «Cancelar extracción» y bloquea Escape y el clic en el fondo. Al terminar lista lo omitido con su razón y ofrece «Abrir carpeta» (abre una pestaña de carpeta nueva); en cualquier caso avisa a los exploradores con `reloadAfterChange` para que vean la carpeta. Cerrar la pestaña con una extracción en curso la cancela.
- Pruebas: `archive.test.ts`, `useArchiveExtraction.test.ts`, `ArchiveViewer.test.ts` (incluye el diálogo) y `tests/e2e/real-app/archive.e2e.ts`.

## Limitaciones conocidas de la Fase 2B

- **Office sin lector de pantalla dentro del documento.** La interfaz de ZetaOffice es un `canvas` de Qt sin DOM, así que no hay roles ARIA ni lector de pantalla dentro del lienzo; lo que lo rodea (barra de estado, avisos, confirmaciones) sí cumple las reglas de accesibilidad. Además su interfaz está solo en inglés (`soffice.data` trae únicamente el paquete `en-US`).
- **Un solo documento Office vivo.** Hay un solo iframe de ZetaOffice: al abrir otro Office se pregunta si el vivo tiene cambios (Cancelar, Descartar, Guardar y continuar) y, si está limpio, se suelta y su pestaña se reabre desde el disco al volver.
- **La memoria de WebAssembly no se devuelve** mientras el iframe vive (medido en el spike S1e: se libera al quitarlo) y los documentos grandes suben el consumo. No hay reciclado automático de la página (T-32).
- **doc, xls, ppt (y rtf y csv) sin apertura externa.** Quedan fuera de la lista permitida de la 2A: si ZetaOffice no los abre, solo se ve la tarjeta binaria.
- **Fixtures heredados circulares.** Los tres OLE2 (`doc`, `xls`, `ppt`) de `tests/fixtures/office/legacy/` los produjo ZetaOffice, el mismo motor que luego los abre: validan estructura, no que Word o Excel los abran.
- **Comprimidos:** extracción todo o nada (T-30) que comprueba el espacio libre del disco antes de escribir y rechaza si no alcanza; los RAR cifrados no se extraen.
- **Instalador sin firmar:** SmartScreen avisará (T-33).

Fuera de la 2A y la 2B por decisión del usuario: PDF editable. Roadmap completo en [roadmap](roadmap.md).
