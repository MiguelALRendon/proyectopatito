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

`FileService::probe` (`src-tauri/src/app/files/mod.rs`) lee como máximo los primeros 8 KiB (`SNIFF_BYTES`) y `classify` (`app/sniff.rs`) devuelve un `ProbeKind`, el MIME y la longitud. Orden de decisión:

1. Imagen, si la cabecera es coherente: PNG, JPEG, GIF, WEBP, BMP o ICO.
2. PDF, si empieza por `%PDF-` seguido de un dígito.
3. Binario, si el contenido no es texto: UTF-8 válido sin bytes NUL, o UTF-16 con marca BOM.
4. SVG (también `ProbeKind::Image`), si el texto, tras el prólogo, abre con `<svg`.
5. Texto, en cualquier otro caso.

| `ProbeKind` | Significado |
|---|---|
| `text` | Texto UTF-8 o UTF-16 con BOM |
| `image` | PNG, JPEG, GIF, WEBP, BMP, ICO o SVG |
| `pdf` | PDF |
| `binary` | Todo lo demás |
| `cloud` | Archivo solo en la nube: no se lee (ver [workspace](workspace.md#archivos-solo-en-la-nube-onedrive)) |

Un `.docx`, un audio, un vídeo o un `.zip` son hoy `binary`: el sondeo no distingue Office, audio, vídeo ni comprimidos (**diferido**, ver más abajo). Pruebas: `src-tauri/tests/sniff.rs`, `files.rs`.

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

## Diferido a la Fase 2B (nada de esto existe en el código)

| Funcionalidad | Estado | Dónde está planeada |
|---|---|---|
| Office (docx, xlsx, pptx, odt, ods, odp, doc, xls, ppt) con ZetaOffice | `proposed`, requiere aislamiento de origen cruzado | [ADR 0010](adr/0010-aislamiento-de-origen-cruzado-y-zetaoffice-como-recurso.md), `plans/fase-2b-documentos` Increments 1 a 5 |
| Audio y vídeo con `<audio>`/`<video>` sobre el protocolo | Planeado | `plans/fase-2b-documentos` Increment 6 |
| Comprimidos (zip, tar, tar.gz, tar.bz2, tar.xz, 7z; rar solo si una biblioteca libre pasa el spike) | `proposed` | [ADR 0011](adr/0011-comprimidos-leidos-y-extraidos-en-rust.md), Increments 7 y 8 |

Fuera de la 2A y la 2B por decisión del usuario: PDF editable. Mientras tanto, esos formatos caen a `BinaryCard` y, si su extensión está en la lista permitida, ofrecen la apertura externa. Roadmap completo en [roadmap](roadmap.md).
