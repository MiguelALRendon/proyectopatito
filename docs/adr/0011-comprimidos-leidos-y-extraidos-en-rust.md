---
status: accepted
date: 2026-10-14
deciders: [usuario]
---

# 0011. Los archivos comprimidos se leen y se extraen en Rust, con validación y límites propios

## Context and Problem Statement

La Fase 2B debe listar y extraer zip, tar, tar.gz, tar.bz2, tar.xz, 7z y rar. Un archivo comprimido es una entrada hostil (zip-slip, bombas de descompresión, enlaces, nombres reservados de Windows, flujos alternos) que además escribe a disco, y toda ruta debe pasar por `Workspace::resolve`.

## Considered Options

- Bibliotecas de Rust (`zip`, `tar`, `flate2`, `bzip2`, `liblzma`, `sevenz-rust2`, y `rars` para RAR si pasa el spike) detrás de un trait común, con validación de entradas y límites propios.
- libarchive compilado a WebAssembly en el frontend.
- `tar.exe` de Windows u otra aplicación externa.

## Decision Outcome

Elegida: **Rust**, en el módulo `app/archive` (que no conoce a Tauri), con un `ArchiveReader` por formato, una validación de entradas común al listado y a la extracción, y límites con nombre contados sobre lo realmente escrito (el tamaño declarado no se confía). La extracción crea una carpeta nueva dentro del Workspace Root, es cancelable y limpia solo lo que creó. Descartadas: libarchive en WASM obliga a extraer a disco por IPC archivo por archivo y a imponer los límites desde el frontend; `tar.exe` es una aplicación externa que el producto no usa. **RAR**: la crate `unrar` envuelve la biblioteca UnRAR de RARLAB, cuya licencia no está aprobada por la OSI, y el usuario la descartó; se evalúa `rars` (Apache-2.0, implementación en Rust, de uso extendido pero que su autor describe como poco probada en volumen) con archivos hostiles en el spike S3, y **si no pasa, RAR se omite**. El spike S3 comprueba que todas las crates compilan con MSVC.

### Consequences

- Positiva: la frontera de seguridad (`resolve`, límites, TOCTOU) está en un solo lenguaje y se prueba con archivos hostiles fabricados por código.
- Negativa: más dependencias compiladas (algunas con código C) y una biblioteca de RAR joven que puede quedar fuera si no pasa las pruebas hostiles.
- Neutral: los archivos cifrados se detectan pero no se abren.

## Actualización tras los spikes (2026-10-17)

Medido en `plans/fase-2b-documentos/spikes.md` (S3): `zip` 9.0.4, `tar`, `flate2`, `bzip2`, `liblzma` 0.4.8 (compila con MSVC), `sevenz-rust2` y `rars` listan y extraen. **Ninguna filtra los nombres de entrada** (las tres devuelven `../evil.txt`, `C:\x.txt`, `CON.txt`, `.svn/entries` tal cual), de modo que la validación propia es obligatoria. **`rars` pasa**: 16 archivos RAR reales, rechazo tipado de los fabricados para fallar, tope de salida por miembro efectivo y 300 variantes corruptas sin un solo pánico ni cuelgue; RAR se incluye. Dos restricciones nuevas: el compilador del proyecto es 1.88 y `sevenz-rust2` 0.24 pide 1.93 y `rars` 0.10.2 pide 1.89 (se usan `sevenz-rust2` 0.20.2, `rars` 0.10.0 y `aes` 0.9.2, o se sube el compilador), y **un 7z de un bloque de 1 GiB lleva el proceso a 1,2 GiB aunque se aborte a los 256 MiB**, por lo que se rechaza por tamaño de bloque declarado antes de decodificar. El listado de tar comprimido recorre el flujo completo (2,1 s por GiB en xz) y necesita tope de lectura y cancelación.

## Actualización tras el Increment 7 (2026-10-18)

Implementado en `app/archive`: un visitante (`EntryHandler`) que cada lector por formato alimenta, en lugar de un `ArchiveReader` con iterador (las bibliotecas empujan los datos: `rars` por `extract_with_control`, 7z por `for_each_entries`). La validación (`safety`) es común al listado y a la extracción. Decisiones: extracción **todo o nada** (se borra la carpeta nueva ante cualquier fallo o cancelación, sin temporal más renombrado porque el destino es exclusivo y cada archivo se abre con `create_new`); topes inyectables (`Limits`) para probarlos en su borde; el identificador de tarea lo elige la interfaz para poder cancelar antes de que el comando termine; sin comprobación previa de espacio libre (T-29). Las versiones de `sevenz-rust2` y `rars` quedan fijadas por el compilador 1.88 (T-28).
