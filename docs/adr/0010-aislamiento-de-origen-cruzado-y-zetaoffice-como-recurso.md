---
status: proposed
date: 2026-10-14
deciders: [usuario]
---

# 0010. La aplicación corre aislada de origen cruzado y sirve ZetaOffice desde un recurso propio

## Context and Problem Statement

ZetaOffice (LibreOffice compilado a WebAssembly) usa hilos de WebAssembly y `SharedArrayBuffer`, que el navegador solo concede a una página con `crossOriginIsolated` (COOP `same-origin` y COEP `require-corp`). Sus archivos pesan 262 MB descomprimidos (`soffice.wasm` 162 MB, `soffice.data` 100 MB) y el proyecto no puede cargar nada de una red ni de un CDN.

## Considered Options

- Aislar toda la ventana de la aplicación y servir ZetaOffice desde un protocolo propio `zeta-assets`, con los archivos como recurso del instalador.
- Una ventana de Tauri separada solo para Office.
- Un `iframe` aislado dentro de la ventana principal.
- Una compilación de ZetaOffice sin hilos.
- Cargar ZetaOffice desde `cdn.zetaoffice.net`.
- Incrustar los archivos en `frontendDist`.

## Decision Outcome

Elegida: **toda la aplicación aislada** (cabeceras en `app.security.headers` y en el servidor de Vite) y **protocolo `zeta-assets`** que sirve una lista cerrada de nombres (los del archivo de bloqueo `third_party/zetaoffice.lock.json`, con versión y SHA-256) desde `bundle.resources`, con MIME correcto, `Cross-Origin-Resource-Policy: cross-origin` y CORS de origen exacto (`zeta-assets.localhost` es de otro origen que la página, y el wasm y los datos se cargan en modo CORS). `app.security.headers` solo se aplica a los recursos `tauri://` de la aplicación, no a los protocolos propios ni al IPC; por eso `workspace-file` y `zeta-assets` ponen CORP a mano, porque bajo COEP un recurso de otro origen sin ella se bloquea. Como el origen es distinto, `officeHost` crea el script principal con un `Blob` que ejecuta `importScripts` y define `locateFile`, igual que el ejemplo oficial de zetajs. Los recursos se declaran en `bundle.resources` como mapa de directorios, no como glob (con un glob vacío `tauri-build` falla en un clon limpio). Descartadas: la ventana separada rompe las pestañas de documentos y duplica el estado; un `iframe` aislado exige que la página padre también lo esté, así que no evita el aislamiento global; no existe una compilación sin hilos publicada; el CDN contradice la autocontención; `frontendDist` metería 262 MB en cada compilación. El spike S1 del Increment 1 mide si WebView2 concede el aislamiento con las cabeceras de Tauri y si Monaco, pdf.js y el IPC siguen funcionando; si falla, se detiene y se consulta al usuario.

### Consequences

- Positiva: una sola ventana, pestañas normales y Office sin red.
- Negativa: el aislamiento afecta a todo lo entregado por la 2A (hay que ponerle CORP a cada protocolo propio y vigilarlo con una regresión E2E); el instalador crece decenas de MB y la instalación unos 262 MB; los binarios de ZetaOffice se redistribuyen cumpliendo las condiciones de sus licencias libres (MPL-2.0, LGPL de Qt), que el spike S1f verifica en sus textos y fuentes públicos; si no pudieran cumplirse de forma libre, se busca otra alternativa con el usuario.
- Neutral: si WebView2 no decodifica `Content-Encoding: br` en esquemas propios, los archivos se sirven sin comprimir desde disco.
