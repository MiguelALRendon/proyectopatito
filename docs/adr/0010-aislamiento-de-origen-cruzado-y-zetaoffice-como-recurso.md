---
status: accepted
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

## Implementación del aislamiento (Increment 2, 2026-10-17)

COOP `same-origin` y COEP `require-corp` ya están en `app.security.headers` de `tauri.conf.json` y en `server.headers` y `preview.headers` de `vite.config.ts`; `tests/e2e/isolationHeaders.test.ts` exige que coincidan. `workspace-file` ya traía CORP `cross-origin` en toda respuesta y `src-tauri/tests/protocol.rs` lo verifica ahora para cada estado, método y origen. El arnés E2E suma `zeta-assets.localhost` a sus hosts permitidos, exige `crossOriginIsolated` en cada arranque y registra `ERR_BLOCKED_BY_RESPONSE`; `tests/e2e/real-app/isolation.e2e.ts` lo comprueba en la ventana real.

## Actualización tras los spikes (2026-10-17, aceptada por el usuario)

Medido en la ventana real (`plans/fase-2b-documentos/spikes.md`):

- La aplicación aislada con COOP y COEP funciona: `crossOriginIsolated` es verdadero y los 142 E2E de la 2A siguen en verde.
- **ZetaOffice exige `'unsafe-eval'`** (Embind usa `new Function`), que no debe llegar a la CSP de toda la aplicación. La propuesta es alojarlo en un `iframe` servido por `zeta-assets` con **su propia CSP** (`'unsafe-eval'` y `'wasm-unsafe-eval'` solo para ese documento) y `sandbox="allow-scripts allow-same-origin"`: dentro del iframe `crossOriginIsolated` sigue siendo verdadero, la CSP de la página principal solo gana `frame-src http://zeta-assets.localhost`, y el `sandbox` es lo que cierra navegación, ventanas nuevas y descargas (sin él, un formulario del documento llevó la ventana entera a una URL externa). Esto sustituye lo dicho arriba de la ventana separada y del `iframe` descartado: el `iframe` aislado sí funciona con la página padre aislada.
- Al ser del mismo origen que su iframe, `soffice.js` no necesita CORS, el envoltorio `Blob` con `importScripts` ni `locateFile`.
- Servir los 262 MB enteros lleva a Rust a 1268 MB de pico; con `Range` en tramos de 8 MiB y los ganchos `Module.wasmBinary` y `Module.getPreloadedPackage` baja a 98 MB.
- `Content-Encoding: br` no funciona en un esquema propio: se sirve sin comprimir.
- Son cuatro archivos (`soffice.js`, `soffice.wasm`, `soffice.data` y `soffice.data.js.metadata`); no hay URL con versión inmutable, se fija por SHA-256.
- La memoria de WebAssembly se libera por completo al destruir el iframe (de ~1,8 GiB a ~0,3 GiB en 15 s), de modo que el reciclaje no necesita recargar la página.

## Implementación del hospedaje (Increment 4, 2026-10-18)

- `zeta-assets` quedó en `commands/zeta_protocol.rs` (módulo propio que reutiliza los ayudantes de `protocol.rs`) y su lógica de lista y tramos en `app/zeta_assets.rs`. `range.rs` ganó `plan_within(rango, total, tope)`; `plan` lo llama con 32 MiB.
- `host.html`, `host.js` y `office_thread.js` viven en `src-tauri/assets/zeta/` y se incrustan con `include_bytes!` (así `cargo-mutants`, que copia solo `src-tauri`, compila). `zeta.js` sale de `zetajs@1.2.0` (dependencia npm exacta) y entra en `third_party/zetaoffice.lock.json` como quinto archivo con origen `npm:`; `scripts/fetch-zetaoffice.ps1` verifica tamaño y SHA-256 de los cinco y no deja archivos parciales si un hash no coincide.
- La ventana principal se crea en código para registrar la frontera del WebView; ver [seguridad](../security.md).
- Medido en la ventana real: el iframe ocupa exactamente el cuerpo del visor; los nueve formatos abren y se clasifican como writer, calc o impress; Ctrl+O es `.uno:OpenFromWriter`; los comandos vetados deben devolver un despachador inerte; `location.assign` externo emite la petición aunque la ventana no cambie.
