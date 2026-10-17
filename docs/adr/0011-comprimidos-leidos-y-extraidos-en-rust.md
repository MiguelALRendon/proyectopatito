---
status: proposed
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
