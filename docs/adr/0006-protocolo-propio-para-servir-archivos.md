---
status: accepted
date: 2026-10-14
deciders: [usuario]
---

# 0006. Los archivos llegan a la ventana por un protocolo propio con `Range`

## Context and Problem Statement

El explorador necesita mostrar imágenes y PDF (y en la Fase 2B audio y vídeo) de archivos que pueden ser grandes. El frontend no tiene acceso a `fs` (CA-4 de la Fase 2A) y toda ruta debe pasar por `Workspace::resolve`.

## Considered Options

- Protocolo de URI propio registrado desde Rust, con soporte de `Range` (206 y 416).
- Asset protocol de Tauri.
- Enviar los bytes por IPC (un command que devuelve el archivo).
- `tauri-plugin-fs` en el frontend.

## Decision Outcome

Elegida: **protocolo propio `workspace-file`**. Cada petición resuelve la ruta (relativa al Workspace Root) con `resolve` y `revalidate`, rechaza `.svn`, aplica un tope por respuesta y devuelve cabeceras seguras (`nosniff`, `Cache-Control: no-store`, CSP `sandbox`, CORS con origen exacto). Descartadas: el asset protocol tiene un alcance estático que no pasa por `ScopedPath`; los bytes por IPC copian el archivo completo en memoria; `plugin-fs` rompe la regla de no dar `fs` al frontend.

### Consequences

- Positiva: un único camino de lectura de archivos, auditado, con streaming por rangos para PDF y, en la 2B, vídeo.
- Negativa: hay que mantener el análisis de `Range` y la compatibilidad con la firma `UriSchemeContext` de Tauri (cambió en 2.0.0-rc.17).
- Neutral: la forma de la URL en Windows (`http://workspace-file.localhost/...`) es un supuesto que la Fase 2A mide en la ventana real.

## Medido en la implementación

Aceptado con el Increment 15 de la Fase 2A (2026-10-16). La decisión no cambió; esto es lo que la implementación (`src-tauri/src/commands/protocol.rs`, `app/range.rs`, `app/files/serve.rs`) y la ventana real midieron:

- El supuesto «Neutral» se confirmó el 2026-10-15 (Increment 4): la página vive en `http://tauri.localhost` y la URL real del protocolo es `http://workspace-file.localhost/<ruta relativa, un segmento codificado con encodeURIComponent por barra>`. La CSP de `tauri.conf.json` lista exactamente ese origen en `img-src` y `connect-src`; con ella una imagen carga, un `fetch` con `Range` responde 206 y no hay violaciones (`tests/e2e/real-app/protocol.e2e.ts`).
- La API de Tauri usada es `register_asynchronous_uri_scheme_protocol` con `UriSchemeContext` (Tauri 2.11.6); la lógica (`handle`) no depende de Tauri y se prueba aparte (`tests/protocol.rs`).
- CORS con origen exacto: se refleja `Origin` solo si es `http://tauri.localhost` (y `http://localhost:1420` únicamente con `debug_assertions`), con `Vary: Origin`. Un `Range` con sufijo (`bytes=-N`) dispara el preflight, que responde 204 con `Access-Control-Allow-Headers: Range`; una cabecera distinta de `Range` falla en el preflight.
- Además de las cabeceras previstas, el protocolo envía siempre `Cross-Origin-Resource-Policy: cross-origin` y `Accept-Ranges: bytes`.
- Tope por respuesta: 32 MiB (`MAX_RESPONSE_BYTES`); un rango se recorta a ese tamaño y pedir completo un archivo mayor responde 413. La primera petición de pdf.js es un GET completo, por eso el visor lee con un `PDFDataRangeTransport` propio (primer rango de 4 MiB, el resto bajo demanda).
- Rechazos: fuera del root, `.svn`/`_svn` y archivos solo en la nube responden 403; inexistente, 404. El navegador normaliza `..` y `%2e%2e` antes de enviar la petición, así que el rechazo de recorrido se probó con `%2e%2e%2f` o `..%5C` dentro de un segmento. Un `?` solo existe como `%3F` en un nombre de NTFS y responde 404.
