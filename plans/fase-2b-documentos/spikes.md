# Spikes de la Fase 2B (Increment 1)

Medidos el 2026-10-17 en este equipo (Windows 11 Home, i5-10400F, 32 GB, WebView2 155.0.4283.60 / Chromium 155) sobre el ejecutable de depuración real, con el arnés CDP de la 2A. Los programas desechables viven en `spikes/` (ignorada por git y por prettier); aquí queda solo lo medido y sus consecuencias. Las cifras salen de los registros de ejecución de cada spike (`spikes/*.log`), no de memoria.

## Resumen y puerta de decisión (1.12)

| Spike | Veredicto | En una línea |
|---|---|---|
| S1a aislamiento | PASA | `crossOriginIsolated` verdadero, hilos de WebAssembly disponibles y los 142 E2E de la 2A en verde con COOP y COEP |
| S1b carga de ZetaOffice | PASA CON CONDICIONES | Arranca en ~6 s, pero exige `'unsafe-eval'` y Rust llega a 1268 MB al servirlo entero; resuelto con iframe propio y carga por tramos |
| S1c abrir y guardar | PASA | docx, xlsx, pptx, odt, ods, odp, doc, xls y ppt: abrir, editar, guardar, reabrir |
| S1d seguridad | PASA CON CONDICIONES | Sin macros por construcción; red cortada; canales de salida vetables, pero **solo con `sandbox` en el iframe** |
| S1e ciclo de vida | PASA CON CONDICIONES | La memoria se libera al quitar el iframe; documentos grandes suben el consumo |
| S1f licencias | PASA CON CONDICIONES | Redistribuible cumpliendo MPL-2.0, LGPL, OFL y avisos; la compilación exacta no tiene commit publicado |
| S2 códecs | PASA | Matriz medida; AVI, WMV, FLV, MPEG y Theora no se reproducen |
| S3 comprimidos | PASA CON CONDICIONES | Todas las bibliotecas funcionan; `rars` pasa; el compilador 1.88 no admite las versiones nuevas |
| S4 `svn.exe` | PASA | **SlikSVN 1.14.5** (elegido: misma procedencia que el `svn` de desarrollo, línea estable) y VisualSVN 1.15.0 (alternativa medida) |

Criterios duros de la puerta:

| Criterio | Resultado | Evidencia |
|---|---|---|
| (a) `crossOriginIsolated` sin romper Monaco, pdf.js ni IPC | **Cumple** | S1a: 142/142 E2E con COOP y COEP |
| (b) docx, xlsx, pptx y odt abren, se editan, guardan y reabren | **Cumple** | S1c, con lector independiente (zip y XML bien formados) |
| (c) sin `'unsafe-eval'` | **No cumple como estaba diseñado.** ZetaOffice lo exige en la página. **Cumple si** corre en un iframe con CSP propia | S1b: violación `script-src eval` en la página; con iframe, cero violaciones en la página de la aplicación |
| (d) licencias cumplibles de forma libre | **Cumple con condiciones** | S1f |
| (e) arranque en frío ≤ 60 s y memoria ≤ 2 GiB | **Cumple, justo en memoria** | 6,1 s; 1797 MiB (1,75 GiB) de memoria privada sumada de WebView2 tras arrancar (línea base 371 MiB) |
| (f) canales de salida vetables y Ctrl+S redirigible | **Cumple con condiciones** | S1d: interceptor de despacho más `sandbox` |
| (g) pico de memoria de Rust aceptable | **No cumple sirviendo el cuerpo entero (1268 MB). Cumple con `Range` (98 MB)** | S1b |
| (h) `svn.exe` 1.14.4 o superior con licencia redistribuible | **Cumple** | S4: SlikSVN 1.14.5 (Apache-2.0), 23 archivos, 15,0 MB |
| (i) DLL del runtime de Visual C++ redistribuibles | **Cumple con condiciones** | S4: lista de redistribución de Microsoft para Visual Studio |

**La puerta no se resuelve sola:** el criterio (c) y el (g) cambian el diseño (iframe en vez de página principal; carga por tramos). El Increment 2 no empieza hasta que el usuario decida.

## S1a — aislamiento de origen cruzado

Método: COOP `same-origin` y COEP `require-corp` en `app.security.headers` y en `server.headers` de Vite, compilación de depuración en `target-e2e`, E2E contra la ventana real.

| Medida | Resultado |
|---|---|
| `window.crossOriginIsolated` | `true` |
| `SharedArrayBuffer` y `WebAssembly.Memory({shared:true})` | disponibles |
| Versión del runtime (registro y `User-Agent`) | WebView2 155.0.4283.60, `Edg/155.0.0.0` |
| Suite E2E de la 2A completa | 142 pruebas, 11 archivos, 0 fallos (777 s), incluye Monaco, vista previa de Markdown, imágenes, PDF con `Range` y tarjeta de binario |
| Violaciones de CSP, peticiones externas, `ERR_BLOCKED_BY_RESPONSE` | ninguna; solo un `ERR_ABORTED` de `svn_detect` que es la propia recarga de la página |

`workspace-file` ya traía `Cross-Origin-Resource-Policy: cross-origin` desde la 2A, así que no hizo falta cambiarlo. Detección en ejecución de un WebView2 sin lo necesario: `window.crossOriginIsolated !== true`, o `typeof SharedArrayBuffer === 'undefined'`, o que `new WebAssembly.Memory({initial:1,maximum:2,shared:true})` lance; las tres comprobaciones son síncronas y baratas. Los cambios de `tauri.conf.json` y `vite.config.ts` se revirtieron con `git checkout --`.

## S1b — carga de ZetaOffice

Método: protocolo temporal `zeta-assets` (`spikes/zeta_spike.rs`, ya retirado del árbol) sirviendo los archivos descargados; arranque con el esquema del ejemplo oficial de zetajs.

Hallazgos que **cambian el plan**:

1. **Son cuatro archivos, no tres.** El ejemplo de zetajs también necesita `soffice.data.js.metadata` (215 180 bytes). Sin él no arranca. El `zetaoffice.lock.json` debe listarlo.
2. **Exige `'unsafe-eval'`.** Con `script-src 'self' 'wasm-unsafe-eval' <zeta-assets> blob:` la página dispara `EvalError: Evaluating a string as JavaScript violates … 'unsafe-eval'` (Embind crea funciones con `new Function`) y no arranca. La CSP de la aplicación no puede relajarse para todo el producto por esto.
3. **Solución medida: iframe con CSP propia.** `zeta-assets.localhost/host.html` carga en un `<iframe allow="cross-origin-isolated" sandbox="allow-scripts allow-same-origin">` dentro de la ventana de la aplicación. La respuesta del protocolo lleva su propia `Content-Security-Policy` (con `'unsafe-eval'` y `'wasm-unsafe-eval'`, solo para ese documento) y `Cross-Origin-Embedder-Policy: require-corp`. La CSP de la página principal solo gana `frame-src http://zeta-assets.localhost` y se mantiene sin `'unsafe-eval'`. Dentro del iframe `crossOriginIsolated` es `true`. Como `soffice.js` queda del mismo origen que el iframe, desaparecen el CORS, el envoltorio `Blob` con `importScripts` y `locateFile` del diseño original.
4. **El pico de memoria de Rust sirviendo el cuerpo entero es 1268 MB** (162 + 99 MB: ~4,8 copias). Con `Range` en tramos de 8 MiB y la página pidiendo los binarios antes de arrancar (`Module.wasmBinary` y `Module.getPreloadedPackage`, ganchos que existen en `soffice.js`) el pico de Rust baja a **98 MB** y el arranque total no cambia (6,3 s, de ellos 2,8 s de descarga). Costo: ~330 MB más de memoria del WebView mientras la página retiene los `ArrayBuffer`; se pueden soltar tras arrancar.
5. **`Content-Encoding: br` no sirve en un esquema propio.** Servir los `.br` con esa cabecera dejó el arranque colgado hasta el límite de 150 s. Se sirve sin comprimir.
6. **`FS` (el sistema de archivos virtual) es global dentro del iframe** tras cargar `soffice.js`; el anfitrión escribe y lee los documentos con `FS.writeFile` y `FS.readFile` (supuesto de S1c confirmado).
7. La interfaz está **solo en inglés** (`fcfg_langpack_en-US.xcd` es el único paquete de idioma en `soffice.data`).

Números (varias ejecuciones, equipo de desarrollo, disco SSD):

| Medida | Valor |
|---|---|
| `soffice.js` listo | 42 a 49 ms |
| Arranque (hasta que el worker UNO responde), frío y caliente | 6,1 s y 5,8 s (indistinguibles: el esquema propio no usa la caché de código de WebAssembly) |
| Memoria privada sumada de procesos WebView2 | 371 MiB antes; 1797 MiB tras arrancar; 1870 MiB tras el segundo arranque |
| Memoria de Rust al servir 262 MB | pico 1268 MB entero; 98 MB por tramos |
| Costo de compilar con los 262 MB en `bundle.resources` (mapa de directorios, `tauri build --debug --no-bundle`) | primera compilación 83 s (copia de 251 MB a `target-e2e/debug/zetaoffice`); sin cambios 26 s; tras tocar `lib.rs` 27 s; **sin recursos, 25 s**. La copia solo se repite si cambian los archivos: el costo diario es nulo |

## S1c — abrir, editar y guardar

Método: cada fixture entra al sistema de archivos virtual, se abre con `loadComponentFromURL` (`MacroExecutionMode` = 0, `UpdateDocMode` = 0), se edita con UNO, se guarda de dos maneras (`storeToURL` con filtro y `store()`), se lee de vuelta, se cierra, se reabre y se lee el texto. La estructura de lo guardado se verificó con Python (`zipfile`, `xml.dom.minidom`): zip íntegro, todos los XML bien formados, el texto editado presente en docx, xlsx, odt y ods.

| Formato | Componente | Filtro (nombre exacto) | Abrir | Editar | `storeToURL` | `store()` | Reabrir |
|---|---|---|---|---|---|---|---|
| docx | Writer | `MS Word 2007 XML` | 1208 ms (1.ª) | sí | sí | sí (sin filtro) | texto correcto |
| xlsx | Calc | `Calc MS Excel 2007 XML` | 676 ms | sí | sí | sí | correcto |
| pptx | Impress | `Impress MS PowerPoint 2007 XML` | 587 ms | sí | sí | sí | 2 diapositivas |
| odt | Writer | `writer8` | 361 ms | sí | sí | sí | correcto |
| ods | Calc | `calc8` | 325 ms | sí | sí | sí | correcto |
| odp | Impress | `impress8` | 351 ms | sí | sí | sí | 2 diapositivas |
| doc | Writer | `MS Word 97` | 354 ms | sí | sí (cabecera OLE2) | sí | correcto |
| xls | Calc | `MS Excel 97` | 336 ms | sí | sí (OLE2) | sí | correcto |
| ppt | Impress | `MS PowerPoint 97` | 351 ms | sí | sí (OLE2) | sí | correcto |

- `store()` **basta** y conserva el formato original de un documento cargado; `storeToURL` con filtro también funciona. El nombre `Calc MS Excel 97` o `Impress MS PowerPoint 97` **no existe** (da `IOException`); los correctos son `MS Excel 97` y `MS PowerPoint 97`. Para docx, xlsx y pptx los filtros de OOXML funcionan con los nombres del plan.
- Tras `store()` `isModified()` queda en falso; tras `storeToURL` queda en verdadero (el documento sigue ligado al archivo original). La aplicación debe usar `store()` y leer el archivo original del MEMFS.
- Escritura de una celda de Calc: `getSheets().getByIndex(0).getCellByPosition(c, r).setString(...)`; Writer: `getText().insertString(getText().getEnd(), ..., false)`; Impress: `getDrawPages().insertNewByIndex(n)`. El oyente `XModifyListener` creado con `zetajs.unoObject` dispara `modified` al editar.
- Los tres fixtures heredados se generaron aquí (odt/ods/odp a 97-2003) y se commitean en `tests/fixtures/office/legacy/` con su procedencia (prueba circular declarada). `scripts/e2e/make-office-fixtures.ps1` fabrica docx, xlsx, pptx, odt, ods y odp mínimos y válidos; ZetaOffice abrió los seis.
- Capturas: `spikes/out/ui-docx.png` (interfaz completa de Writer en el lienzo).

## S1d — seguridad del documento y frontera del WebView

**Macros.** Un odt con una macro Basic enlazada al evento «al abrir» **no se ejecuta ni siquiera con `MacroExecutionMode` = `ALWAYS_EXECUTE_NO_WARN`** (la prueba de control): la compilación WebAssembly no incluye el marco de scripts. Sondeo de servicios: `com.sun.star.script.provider.MasterScriptProviderFactory`, `ScriptProviderForBasic`, `BrowseNodeFactory`, `VBAEventProcessor` y `DocumentScriptLibraryContainer` devuelven `null`; `MailServiceProvider` y `DatabaseContext` también. Conclusión: en esta compilación **las macros no pueden ejecutarse**; `NEVER_EXECUTE` se mantiene como defensa en profundidad y `has_macros` solo informa.

**Red.** Un odt con una imagen y un hipervínculo a un servidor local de prueba (`127.0.0.1:18080`): cero peticiones al servidor y cero peticiones externas vistas por el arnés. LibreOffice WebAssembly no abre URL remotas por omisión.

**Interceptor de despacho.** `registerDispatchProviderInterceptor` con un objeto creado por `zetajs.unoObject([css.frame.XDispatchProviderInterceptor], {...})` funciona. Comandos vetados devolviendo `null` en `queryDispatch`: `.uno:Open`, `.uno:SaveAs`, `.uno:SaveACopy`, `.uno:ExportTo`, `.uno:ExportToPDF`, `.uno:SendMail`, `.uno:OpenHyperlink`, `.uno:RunMacro`, `.uno:MacroOrganizer` y `.uno:Print`; las consultas llegan tanto por `DispatchHelper` como por la propia interfaz de ZetaOffice. `.uno:Save` se redirige a un `XDispatch` propio (llegó la notificación de guardado a la aplicación). Falta comprobar con un clic real y con Ctrl+S sobre el lienzo; se cubre en el E2E del Increment 5.

**Frontera del WebView** (iframe que intenta salir por todos los canales: `window.open`, `<a download>` con URL externa y con `blob:`, envío de un formulario con `target=_top`, `window.top.location`, y navegación propia):

| Iframe | Resultado |
|---|---|
| **Sin `sandbox`** | **La página principal terminó en la URL externa** (el envío del formulario navegó la ventana entera), se disparó una descarga (`blob.txt`) y se abrió la página `edge://downloads-hub/`. Inaceptable |
| **`sandbox="allow-scripts allow-same-origin"`** | Cero peticiones externas, cero ventanas, cero descargas; `window.top.location` lanza `SecurityError`; la navegación del propio iframe queda bloqueada por `frame-src` (`chrome-error://`); `crossOriginIsolated` sigue `true` y ZetaOffice arranca igual |

Rust, además (defensa en profundidad): Tauri 2.11.6 tiene en `WebviewWindowBuilder` `on_navigation(Fn(&Url) -> bool)`, `on_new_window(Fn(Url, NewWindowFeatures) -> NewWindowResponse)` y `on_download(Fn(Webview, DownloadEvent) -> bool)`. Para engancharlos la ventana debe crearse en código (`"create": false` en `tauri.conf.json` y `WebviewWindowBuilder::from_config` en `setup`); eso es trabajo del Increment 4 (4.6). No se probó en este spike porque el `sandbox` ya cierra los canales.

## S1e — ciclo de vida y recursos

| Prueba | Resultado |
|---|---|
| Diez ciclos abrir, editar y cerrar el mismo docx | memoria privada 1797 → 1853 (1.º) → 1862 (5.º) → 1872 MB (10.º): ~7 MB por ciclo, sin fuga grave |
| Documentos con carga de 16, 32 y 64 MiB (zip con una parte binaria sin comprimir) | abren en ~0,4 s cada uno; memoria 2110, 2307 y 2718 MiB (2,06, 2,25 y 2,65 GiB; acumulada); la subida del archivo por CDP tardó 7, 23 y 88 s (no representativa: en producción viaja por `fetch` y `postMessage`) |
| Documento con 100 000 párrafos (5,7 M de caracteres, 0,4 MiB comprimido) | abre en 4,2 s; memoria 1842 MiB (1,80 GiB) al abrirlo solo |
| **Quitar el iframe** tras cerrar el documento | **libera toda la memoria**: 1765 MB a los 3 s → 299 MB a los 15 s (un proceso de WebView2 desaparece) |
| Recargar la página principal | también libera (194 MB a los 30 s) |

Consecuencias: el reciclaje se hace **destruyendo el iframe** (más barato que recargar la página: no toca la sesión de pestañas), y hay que esperar ~15 s a que el proceso muera antes de crear otro (si no, la memoria se suma: 4057 MiB, 3,96 GiB, medidos). `OFFICE_RECYCLE_BYTES` propuesto: destruir el iframe al cerrar el último documento Office, o al pasar de 2,5 GiB de memoria privada del WebView. `MAX_OFFICE_BYTES` propuesto: **32 MiB** (con 64 MiB el consumo supera 2,6 GiB). `OFFICE_LOAD_TIMEOUT` propuesto: **60 s** (arranque ~6 s; con margen por equipos lentos y por el arranque en frío tras reiniciar).

## S1f — licencias de ZetaOffice

Fuentes públicas leídas el 2026-10-17: `LICENSE` de zetajs, `readlicense_oo/license/license.xml` de la rama `distro/allotropia/zeta-24-2` de LibreOffice (espejo en GitHub; `git.libreoffice.org` bloquea a clientes automáticos), los archivos `LICENSE.*` de `allotropia/qtbase` y `allotropia/qt5` (rama `5.15.2+wasm`) y el `README` de zetajs, que enumera los repositorios de los que sale la compilación.

| Componente | Licencia | Obligación al redistribuir |
|---|---|---|
| zetajs 1.2.0 (npm, 62 848 bytes) | MIT | Conservar el aviso de copyright (`allotropia software GmbH and contributors`) |
| LibreOffice (código propio) | MPL-2.0 (`license.xml`: «This product is made available subject to the terms of the Mozilla Public License, v. 2.0») | Texto de la licencia y acceso al código fuente de los archivos MPL: rama `distro/allotropia/zeta-24-2` |
| Qt 5.15.2 (fork de allotropia) | LGPL 3 (con GPL 3 y acuerdo comercial como alternativas; el fork trae `LICENSE.LGPLv3`) | Texto LGPL 3 y GPL 3 (la LGPL se apoya en ella), aviso, acceso al código del fork y **forma de reenlazar**: como `soffice.wasm` es la obra combinada y se distribuye sin cambios y con las instrucciones de compilación públicas (README de LOWA), basta una oferta pública de fuentes más esos enlaces |
| Emscripten (fork `allotropia/emscripten`, `fixed-3.1.65`) | MIT y otras permisivas | Aviso de copyright |
| 158 componentes de terceros que declara `license.xml` | Mayoría Apache-2.0, MIT, BSD, Boost, MPL, OFL; 3 LGPL (CLucene y dos diccionarios); 3 GPL (diccionario esperanto, guiones rumanos y ucranianos) | Incluir el aviso completo. Los diccionarios no están en `soffice.data` (la lista de 1903 archivos no tiene ninguno), así que la GPL no aplica a lo que se distribuye |
| Fuentes de `soffice.data` (Liberation, DejaVu, Carlito, Caladea, Noto, Amiri, Linux Libertine, etc., 55 MB) | SIL OFL 1.1 y Bitstream Vera / DejaVu | Texto de la OFL y de cada aviso; no vender las fuentes por separado |

Hallazgos:

- **No hay URL con versión inmutable.** `https://cdn.zetaoffice.net/zetaoffice_<versión>/…` devuelve 404 para 1.0.0, 1.1.0, 1.2.0, 24.2.0 y 24.2.7; solo existe `zetaoffice_latest`. Se fija por SHA-256 (tabla abajo) y por `Last-Modified: Tue, 13 May 2025 15:18:07 GMT` (el `ETag` de `soffice.js` es `682362af-d180c`).
- **El commit exacto de la compilación publicada no figura en ningún texto público.** El README de zetajs da la rama (`zeta-24-2`) y los forks de emscripten y Qt, no el commit. Para MPL y LGPL el cumplimiento razonable es la oferta pública de fuentes apuntando a esas ramas, con el SHA-256 que se distribuye; no es una correspondencia exacta por commit y se anota como riesgo residual. Por decisión del usuario no se contacta a allotropia.
- Los términos comerciales de zetaoffice.net se refieren a su CDN y soporte («paid packages … include the use of our high performance CDN»); no se encontró ningún texto que prohíba alojar los binarios por cuenta propia: la página dice «self-host or CDN».
- La licencia del proyecto (MIT) es compatible: los binarios de ZetaOffice se distribuyen como un recurso aparte, sin enlazarse con código MIT del proyecto.

SHA-256 de lo descargado con `curl --compressed`:

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `soffice.js` | 858 124 | `5143e5354f470b87f86ba272bcfef857bd13e6f07b59666e48a7ccb89643cd77` |
| `soffice.wasm` | 161 667 499 | `9ebd9a487e849a24b9c69f843ebdb451709c27b7722c010e36846433474a5bd4` |
| `soffice.data` | 99 520 604 | `3dab0a5448e599dccc1b1e69f4f86ea9eb30777c3f1ed7b9c386a5f4163e361c` |
| `soffice.data.js.metadata` | 215 180 | `5d9d909d0b9b38443c0f19704032d0fc12d654f6c9c24c2c3b237739c4848ae3` |
| `zetajs-1.2.0.tgz` (npm) | 62 848 (sin empaquetar) | integridad `sha512-lAY5Q7qvvGYlmsMyuAByL/re9uIbDmJhHLXvF2FNhOdnv8V1/jUTS5EwIB6dAohFtzrd9HhP//5eoAvNGc9hPA==` |

Lista de avisos que el instalador debe llevar: el `license.xml` de la rama citada como superconjunto (cubre MPL-2.0, LGPL 2.1/3, GPL 2/3 por referencia, OFL, Apache, CPL, LPPL, CC-BY-SA), la LICENSE de zetajs, y la oferta de fuentes con las cuatro URL de repositorios.

## S2 — códecs de WebView2

Método: `canPlayType` sobre 35 combinaciones, `MediaRecorder` en la ventana real para fabricar archivos, y reproducción real con `<video>` y `<audio>` (carga con `blob:`, CSP desactivada por CDP para la medición). **Hallazgo confirmado:** con la CSP actual (`default-src 'self'`) **todo medio se rechaza** con `Media load rejected by URL safety check`; `media-src` es imprescindible (Increment 6, paso 6.1).

Reproducen de verdad (archivo real, metadatos leídos y `currentTime` avanzando):

| Formato | Muestra | Resultado |
|---|---|---|
| MP3 | `real.mp3` (CC0, Wikimedia Commons) | reproduce |
| FLAC | `real.flac` (CC0, Wikimedia Commons) | reproduce |
| WAV | generado por el spike (PCM 16 bits) | reproduce |
| OGG Vorbis | `Example.ogg` (Wikimedia Commons; licencia no verificada en este spike) | reproduce, 6,1 s |
| M4A / AAC | `MediaRecorder` `audio/mp4` | reproduce |
| WebM Opus (audio) | `MediaRecorder` | reproduce |
| WebM VP8, VP9, AV1 + Opus | `MediaRecorder` | reproducen |
| WebM con H.264 | `MediaRecorder` | reproduce |
| MP4 H.264 + AAC | `MediaRecorder` | reproduce |
| MKV con H.264 | `MediaRecorder` (`video/x-matroska`) | reproduce |
| MOV | el MP4 H.264 servido como `video/quicktime` | reproduce (Chromium detecta por contenido) |

No reproducen: **AVI, WMV, FLV** (`DEMUXER_ERROR_COULD_NOT_OPEN`), MPEG, Theora, WMA, MKV con VP9 y Opus (`canPlayType` «no»). `canPlayType` dice «probably» para HEVC (`hvc1`, `hev1`), pero **no se pudo comprobar con un archivo real**: no hay codificador HEVC en esta máquina y `MediaRecorder` no lo ofrece. HEVC queda como «sin verificar»; la tarjeta de «no soportado» debe cubrir el caso por el evento `error`, no por la tabla. `MediaRecorder` ofrece `video/webm` (vp8, vp9, av1, h264), `video/mp4` (avc1) y `video/x-matroska`; no ofrece `audio/ogg` ni HEVC. Muestras de `mathiasbynens/small` (renuncia a derechos de autor, equivalente a CC0) resultaron degeneradas (72 bytes) y se descartaron.

Fixtures de la 2B (Increment 6): se pueden generar webm, mp4 y mkv con `MediaRecorder` por CDP, WAV con código, y para mp3 y flac se usan las muestras CC0 de Wikimedia Commons con su procedencia (el ogg exige confirmar su licencia o buscar otro).

## S3 — comprimidos

Versiones y licencias leídas de crates.io el 2026-10-17:

| Crate | Versión probada | Última | Licencia | Rust mínimo de la última |
|---|---|---|---|---|
| `zip` | 9.0.4 | 9.0.4 | MIT | 1.88 |
| `tar` | 0.4.46 | 0.4.46 | MIT o Apache-2.0 | 1.63 |
| `flate2` | 1.1.10 | 1.1.10 | MIT o Apache-2.0 | 1.67 |
| `bzip2` | 0.6.1 | 0.6.1 | MIT o Apache-2.0 | 1.82 |
| `liblzma` | 0.4.8 (compila liblzma de C con MSVC sin problemas) | 0.4.8 | MIT o Apache-2.0 | 1.60 |
| `sevenz-rust2` | **0.20.2** | 0.24.0 | Apache-2.0 | **1.93** (0.21 en adelante); 0.20.2 pide 1.85 |
| `rars` | **0.10.0** (solo lectura, sin cifrado) | 0.11.0 | Apache-2.0 | **1.89** (0.10.2 y 0.11.0); 0.10.0 pide 1.87 |

**Hallazgo de entorno:** el compilador del proyecto es **1.88**. `sevenz-rust2` 0.24.0 y `rars` 0.10.2/0.11.0 (las versiones del plan) **no compilan**, y con `zip` 9.0.4 hay que fijar `aes` en 0.9.2 (0.9.3 pide 1.89). Opciones para el Increment 7: subir el compilador (a 1.93 o superior; decisión del proyecto, afecta a todo) o fijar `sevenz-rust2` 0.20.2, `rars` 0.10.0 y `aes` 0.9.2 y anotarlo en `TECH_DEBT.md`. El spike usó la segunda.

Resultados con archivos fabricados por código (`spikes/archives`, programa de prueba que cuenta lo escrito y aborta al pasar un tope):

| Prueba | Resultado |
|---|---|
| Listar y extraer zip, tar, tar.gz, tar.bz2, tar.xz y 7z normales (3 archivos, uno con `ñ`) | correcto en los seis; nombres UTF-8 íntegros |
| Nombres hostiles (`../evil.txt`, `..\evil2.txt`, `/abs.txt`, `C:\x.txt`, `a/../../b.txt`, `CON.txt`, `.svn/entries`) en zip, tar y 7z | **las tres bibliotecas devuelven los nombres tal cual, sin filtrar**: la validación de entradas (Increment 7.3) es obligatoria y propia |
| Enlaces simbólico y duro en tar | se informan como `Symlink` y `Link`; zip informa `is_symlink()` |
| Cifrado | zip con AES: `Password required to decrypt file`; 7z cifrado: `PasswordRequired`; RAR cifrado: error tipado `encryption feature disabled` (se detecta, no se descifra) |
| Tamaño declarado falso en zip (3 declarado, 5000 reales) | `File is larger than its declared uncompressed size` |
| Bomba de 1 GiB de ceros con tope de 256 MiB | se detiene exactamente al pasar el tope en zip (33 ms), tar.gz (32 ms), tar.bz2 (573 ms), tar.xz (521 ms) y 7z (1,0 s) |
| Misma bomba sin tope (1 GiB completo) | zip 125 ms, tar.gz 128 ms, tar.bz2 2,3 s, tar.xz 2,1 s, 7z 1,1 s; pico de memoria **4 a 12 MiB salvo 7z: 1234 MiB** |
| **7z: memoria proporcional al tamaño declarado** | un solo bloque de 1 GiB hace llegar el proceso a 1,2 GiB **aunque se aborte a los 256 MiB**. Regla obligatoria: rechazar un 7z cuyo tamaño de bloque declarado supere `MAX_7Z_BLOCK_BYTES` (propuesto 256 MiB) **antes** de decodificar |
| Listado de tar.gz, tar.bz2 y tar.xz | recorre el flujo completo (2,1 s por GiB en xz): necesita tope de lectura y cancelación (ya en el diseño, `MAX_LIST_READ_BYTES`) |
| `liblzma` con `memlimit` de 1 MiB y 64 MiB sobre un tar.xz de diccionario de 8 MiB | 1 MiB: `memory limit reached`; 64 MiB: lee correctamente. El mecanismo de tope de memoria del descompresor funciona |
| 100 000 entradas en un zip | listar 0,86 s y 39 MiB; extraer 1,1 s |
| Truncados al 60 % | zip y 7z: error al abrir (`Could not find EOCD`, `UnexpectedEof`); tar.gz, tar.bz2 y tar.xz: error de flujo (`incomplete deflate stream`, `premature eof`) sin pánico |
| **RAR con `rars` 0.10.0** | 16 archivos (RAR 1.3, 1.5–4.x y 5/7, del repositorio de `rars` y de `mathiasbynens/small`; los de `rars` fueron verificados por su autor contra RAR 7.12 y UnRAR 7.20): se listan y extraen; los fixtures «fabricados para ser rechazados» (algoritmo desconocido, bloque sin tablas) devuelven error tipado; con tope de 16 bytes rechaza un miembro de 65 536 bytes (`member requires 65536 output bytes, above the configured limit`) |
| Fuzz de RAR: 300 variantes (bytes cambiados, truncados, bytes insertados) de 5 archivos | **0 pánicos, 0 cuelgues, 0 caídas**; peor tiempo 0,02 s |

Veredicto RAR: **`rars` pasa** las pruebas hostiles de este spike (no hay bombas de RAR fabricadas: sin codificador propietario; la prueba de bomba se cubre con el tope `max_member_output_bytes`, que se comprobó). Procede incluir RAR en el Increment 7, con `rars` 0.10.0 y `default-features = false` (lectura secuencial, sin cifrado ni escritura).

Fixtures de RAR: se copiaron de `rars` 0.10.0 (`tests/fixtures`, Apache-2.0) y de `mathiasbynens/small` (CC0); no se commitean todavía: lo hará el Increment 7.

## S4 — `svn.exe` y runtime

**Dos candidatos medidos. Elegido: SlikSVN 1.14.5.** La primera versión de este spike eligió VisualSVN sin haber comprobado la versión actual de SlikSVN (solo se había mirado la instalación local, 1.14.2); el usuario lo cuestionó con razón y se midió SlikSVN 1.14.5.

| | SlikSVN 1.14.5 (elegido) | VisualSVN 1.15.0 (alternativa) |
|---|---|---|
| Origen | `https://sliksvn.com/download/slik-subversion-1-14-5-x64/` → `Slik-Subversion-1.14.5-x64.zip` (7 701 022 bytes, SHA-256 `77d4fe02999dda3bdc3a20e86243ae6ede99aaf072b4c12b0cdedb54d88e954a`, contiene el MSI; se extrajo sin instalar con `msiexec /a`) | `https://www.visualsvn.com/files/Apache-Subversion-1.15.0-x64.zip` (5 350 595 bytes, SHA-256 `98bb798dd6c70cc875b9bdacd600594351cf88f0a39a831a5055df061c871bb5`) |
| Versión | 1.14.5, compilada el 2025-04-17; **línea estable 1.14** (la del `svn` de desarrollo y de todas las pruebas de la Fase 1); corrige CVE-2024-45720 (≥ 1.14.4) | 1.15.0, compilada el 2026-10-08 (9 días de antigüedad); formato de copia de trabajo nuevo (WC 32) |
| Archivos de la clausura | 23 (20 de SlikSVN más `vcruntime140.dll`, `vcruntime140_1.dll` y `msvcp140.dll`: la DLL de BerkeleyDB importa las tres) | 18 |
| Tamaño | 15,0 MB | 10,97 MB |
| OpenSSL | OpenSSL **3** (`libssl-3-x64`, `libcrypto-3-x64`; con licencia Apache 2.0, sin la cláusula de publicidad de OpenSSL 1.1) | ninguno (SChannel) |
| BerkeleyDB | `SlikSvn-DB44-20-x64.dll` (licencia Sleepycat: oferta de código fuente) | ninguno |
| Pruebas con `PATH` y `ProgramFiles` vacíos | `--version` = 1.14.5, checkout, add, status, commit y `ls` por https: correctos | las mismas: correctas |
| Mensajes traducidos | trae `es` y `de` en `Share\Locale` (el ejecutor fija `LANGUAGE=en` en `svn/runner.rs`, así que la salida que se analiza sigue en inglés; se comprobará en el Increment 10 con el empaquetado real) | no |

Ambos son compilaciones de terceros del mismo código de Apache Subversion, sin parches que se hayan comprobado; ninguna es «el svn de Apache», que no publica binarios (su página de paquetes lista terceros). Se elige SlikSVN 1.14.5 porque es la línea estable, ya es la que usa el proyecto, y evita estrenar un formato de copia de trabajo nuevo; a cambio hay que cumplir la oferta de fuentes de BerkeleyDB y el aviso de OpenSSL 3 (9.6 del plan). VisualSVN queda documentado como alternativa si SlikSVN dejara de publicar.

Resultados medidos con VisualSVN 1.15.0 (la clausura de SlikSVN sigue el mismo método):

| Medida | Resultado |
|---|---|
| Licencia (VisualSVN) | Apache Subversion con licencias y avisos incluidos en `Licenses\`: Apache 2.0 (Subversion, APR, APR-Util, Serf), Expat, SQLite (dominio público), zlib. La página de VisualSVN lo describe como «redistributable package»; **no incluye un texto propio de términos de redistribución**, solo el de Apache 2.0, que permite redistribuir. Riesgo residual: el empaquetado es de un tercero |
| OpenSSL y BerkeleyDB | **No trae** `libssl`, `libcrypto` ni `DB44`; `libsvn_ra_serf` importa `Secur32`, `CRYPT32` y `bcrypt` (SChannel). Un archivo se llama `OpenSSL License.txt` pero contiene texto de Apache 2.0; ninguna DLL contiene la cadena «openssl». Desaparecen las dos obligaciones activas de licencia (BerkeleyDB y OpenSSL) previstas en el 9.6 |
| Clausura mínima (`dumpbin /dependents` iterado desde `svn.exe` más los módulos que se cargan por nombre) | 18 archivos: `svn.exe`, `libsvn_{client,delta,diff,fs,fs_fs,fs_util,fs_x,ra,ra_local,ra_serf,ra_svn,repos,subr,wc}-1.dll`, `libapr-1.dll`, `libaprutil-1.dll`, `vcruntime140.dll`; **10 970 208 bytes (10,46 MiB)**; el paquete completo trae 35 archivos y 12,8 MB |
| Prueba con `PATH` y `ProgramFiles` apuntando a una carpeta vacía | `svn --version --quiet` = `1.15.0`; `checkout file:///` (revisión 0), `add`, `status`, `commit` (revisión 1) y `ls` de `https://svn.apache.org/…` correctos; `svn://` llega a conectar y falla solo por no haber servidor |
| Con la `vcruntime140.dll` de `%VCToolsRedistDir%` (14.51.36247.0) en lugar de la del paquete (14.29.30157.0) | las mismas pruebas, idénticas |
| Tamaño antes de comprimir | 10,97 MB con el runtime (la carpeta `bin` de SlikSVN pesa 13 MB y es de 2022) |
| `svn` instalado en esta máquina | SlikSVN 1.14.2 de 2022 con OpenSSL 1.1.1: **no sirve para empaquetar** (CVE-2024-45720); la versión actual del mismo proveedor, 1.14.5, sí |

**Runtime de Visual C++ (`+crt-static` y redistribución):**

- `svn.exe` de VisualSVN y de SlikSVN importan solo `VCRUNTIME140.dll`; en SlikSVN la DLL de BerkeleyDB además importa `VCRUNTIME140_1.dll` y `MSVCP140.dll` (VisualSVN no las necesita) (más `KERNEL32` y la UCRT del sistema, que Windows 10 y 11 incluyen: `api-ms-win-crt-*`). No necesita `msvcp140` ni `vcruntime140_1`.
- La aplicación de Tauri sin `+crt-static` importa `VCRUNTIME140.dll` y `VCRUNTIME140_1.dll` (medido sobre `dakedaduck-svn.exe`). **Compilada con `RUSTFLAGS="-C target-feature=+crt-static"` ya no importa ninguna** (`dumpbin /dependents` de `src-tauri/target-crt`, compilada en 2 min 24 s; 16,9 MB frente a 21,1 MB en depuración). Se retiró ese directorio de compilación.
- Redistribución: la página de redistribución de Visual Studio 2026 de Microsoft (`https://aka.ms/vs/18/redistribution`, consultada 2026-10-17) dice que «puede copiar y distribuir con su programa cualquiera de los archivos dentro de `[VisualStudioFolder]\VC\redist` y subcarpetas», salvo `debug_nonredist`, y que la distribución está **limitada a usuarios de Visual Studio con licencia**. Aquí está instalado Visual Studio Community 2026 (`C:\Program Files\Microsoft Visual Studio\18\Community`, `VC\Redist\MSVC\14.51.36231\x64\Microsoft.VC145.CRT\vcruntime140.dll`). Cumple siempre que quien compile el instalador tenga una edición con licencia; Community es válida para proyectos de código abierto. El `vcruntime140.dll` de VisualSVN (14.29.30157) es más antiguo y no se usa.
- Limitación declarada: esta máquina tiene el runtime del sistema, así que **no se puede demostrar su ausencia aquí**; solo se calculó la clausura. Lo confirma la prueba en máquina limpia (al final del Increment 10).

## S1g — prueba de rotura de la interfaz de ZetaOffice (2026-10-17)

Hecha a petición del usuario sobre la ventana real (iframe de 988×692 px dentro de la aplicación, controlado por CDP con `spikes/probe.mjs`; capturas en `spikes/out/probe/`). Todo lo siguiente ocurrió con el documento abierto **sin** interceptor, salvo lo marcado.

| # | Qué se hizo | Qué pasó | Gravedad |
|---|---|---|---|
| 1 | Archivo → Open (menú o Ctrl+O) | Abre un diálogo de Qt sobre un disco virtual (`/home/web_user`, vacío), no sobre los archivos del usuario; el documento deja de dibujarse mientras tanto; un segundo Ctrl+O apila otro diálogo | alta |
| 2 | Arrastrar ese diálogo (o cualquiera) hacia el borde | Queda recortado por el borde del iframe y se puede perder; al soltar el ratón fuera del iframe se selecciona el texto de la aplicación de detrás | media |
| 3 | Archivo → Close | Desaparece el documento y aparece la **pantalla de inicio de ZetaOffice** (crear Writer, Calc, Impress, Draw, Math, Base, documentos recientes): rompe «un documento por pestaña» | alta |
| 4 | Archivo → Exit ZetaOffice (o Ctrl+Q) | El lienzo queda gris y muerto; solo se recupera destruyendo y recreando el iframe | alta |
| 5 | Cambiar el tamaño del iframe | El lienzo **no** se adapta: la interfaz queda recortada con el tamaño inicial | alta |
| 6 | La ✕ de la barra de menús, «Reload», «Exit», varias entradas de Help | Botones que parecen activos y no hacen nada (bloqueados por el interceptor, pero siguen dibujados activos) | baja |
| 7 | Tras una acción por menú, Escape | No cierra el diálogo si el foco de teclado quedó fuera del iframe; con un clic previo dentro, sí | media |
| 8 | Calc e Impress | Según el estado dibujan una barra de título propia («hoja.xlsx — ZetaOffice Calc», con restaurar y cerrar); Writer no | media |
| 9 | F5, Ctrl+R, F11, F12, Ctrl+Shift+I con el foco en el lienzo | No recargan ni abren nada de la aplicación; F12 solo hizo «Group» de Calc; F5 y Slide Show → Start no inician el pase de diapositivas en esta compilación | sin riesgo |
| 10 | Menú Tools | Muy largo, con Macros, Development Tools, XML Filter Settings, Mail Merge, Translate…; los que dependen de URL, archivos o scripts no tienen sentido aquí | media |

**Soluciones probadas** (en `spikes/zeta/office_thread.js`):
- Interceptor de despacho ampliado con Close, Exit, New, Reload, Recent, Wizards, Templates, Options, Customize, About, Help, Quit, Save As, Export, Print, Send, Open y las URL `private:`, `service:`, `file:`, `macro:` y `vnd.sun.star.script:`: con él, Open, Close, New, Ctrl+Q, Ctrl+N y Ctrl+O dejan de hacer nada y no aparece la pantalla de inicio. **Trampa medida:** registrar **el mismo** objeto interceptor en el marco y en el Desktop rompe la cadena y deshabilita los cuadros de estilo, fuente y tamaño; hay que crear **un objeto por registro**. Con interceptores independientes los cuadros quedan bien y el clic en Open no abre nada.
- **Corrección (2026-10-17, tras una captura del usuario):** el evento `resize` solo cambia el tamaño del lienzo HTML; la ventana interna de LibreOffice **no** lo sigue y queda con su tamaño inicial (938×787 frente a un lienzo de 1003×668), de modo que se corta la barra de estado y sobra un panel oscuro a la derecha y abajo. Lo que sí funciona es pedirlo por UNO desde el hilo de Office: `frame.getContainerWindow().setPosSize(0, 0, w, h, 15)` cada vez que el iframe cambie de tamaño (con `ResizeObserver` en el host, que avisa por `postMessage`). La ventana interna descuenta decoración: con la barra de título visible hay que pedir `w = ancho − 2`, `h = alto − 50`; con la barra de título oculta (siguiente punto) bastan `w = ancho − 2`, `h = alto`. Medido con el tamaño real de la ventana de la aplicación (cambiada por CDP `Browser.setWindowBounds`) y el iframe **dentro** del contenedor de contenido: a 1500×900 y a 1920×1057 el visor sigue a la ventana con la barra de menús arriba y la barra de estado pegada abajo. **Límite medido:** con el recuadro muy bajo (≈ 260 px, ventana de 900×600 con el panel de checkout debajo) LibreOffice impone un alto mínimo y recorta menú y barra de estado; el contenedor del visor necesita un alto mínimo (≈ 360 px) con desplazamiento del contenedor.
- **Barra de título interna oculta (probado):** con `#qtcanvas` en `position:absolute; top:-26px; height:alto+26px` el iframe recorta la barra y Qt sigue recibiendo bien los clics (File → menú abrió en su sitio). Con esto la ventana deja de «parecer una ventana» y la barra de estado queda completa al pie.
- `user-select: none` en la página mientras hay un documento Office abierto: arrastrar hacia fuera del iframe ya no selecciona el texto de la aplicación.
- Dar el foco al iframe en cada clic dentro del lienzo (Escape cerró el diálogo tras un clic previo).

**Sin resolver (a atacar en el Increment 5):** las entradas bloqueadas siguen dibujadas como activas (habría que quitarlas del menú con la configuración de la interfaz de UNO o con el filtro de comandos); el diálogo arrastrado fuera del borde; el menú Tools completo (lista de permitidos en vez de lista de bloqueados, comprobada con un recorrido automático de todos los menús); Insert → Image (abre el mismo diálogo de archivos virtual); el panel lateral se puede ocultar sin forma de volver desde nuestra interfaz.

## Increment 3 — diferencias entre el diseño §6 y el código real de la 2A (2026-10-17)

Verificadas leyendo `sniff.rs`, `files/{mod,edit,version,text}.rs`, `commands/files.rs`, `registry.ts`, `filesApi.ts`, `tauri.ts`, `contract.json` y `protocol.rs` antes de tocar nada.

| Punto | Diseño §6 | Código real | Qué se hizo |
|---|---|---|---|
| `classify` | Combinaba firma y extensión | Era una función pura sobre los primeros 8 KiB, sin nombre de archivo | `Sample` suma `extension`; el contenedor ZIP y OLE2 y los tarballs exigen leer más allá de los 8 KiB, así que lo compone `inspect` (`app/inspect.rs`, nuevo) y `probe_facts` lo llama |
| `FileProbe.version` | «El mismo token opaco de `fs_read_text`» | `version_of` es longitud + mtime + FNV-1a de **todo** el contenido; calcularlo exige leer el archivo | `version` es `Option<String>`: solo para Office de hasta 32 MiB, en `FileService::probe`; `probe_facts` (que usa también el protocolo para el MIME) no lo calcula |
| `fs_write_bytes` | `tauri::ipc::Request` con cabeceras | `fs_write_text` recibe `req: WriteTextArgs` en JSON; `call` solo admitía argumentos con nombre | `call` admite `InvokeArgs` y `InvokeOptions`; el comando lee `path` (codificada) y `expected-version` de las cabeceras; `ensure_unchanged` y `current_version` reciben el tope |
| Registro de proveedores | «No cambia de forma» | `chooseProvider` puntúa por proveedor y `DocumentHost` cae a `BinaryCard` | Confirmado: los tipos nuevos caen a `BinaryCard` con su etiqueta |
| Contrato | Suma tipos y errores | `contract.json`, `contract.rs`, `tauri.ts` y `filesApi.ts` se vigilan entre sí | 24 a 30 errores, 5 a 9 tipos de sondeo, `FileProbe` con `has_macros` y `version`; la prueba de contrato trata la petición cruda como parámetro inyectado |
| Cabecera CORP | Increment 4 de la 2A | Ya estaba en toda respuesta del protocolo | Verificada en el Increment 2 para cada estado |

Decisiones tomadas al implementar, más estrictas que el plan:
- **Office OOXML:** además de `[Content_Types].xml` se exige una carpeta del formato (`word/`, `xl/`, `ppt/`); un `xlsx` renombrado `.docx` cae a binario.
- **Office ODF:** se lee el `mimetype` guardado sin comprimir y debe declarar el MIME de la extensión; un `.odt` con contenido de `.ods` cae a binario.
- **Lector ZIP propio** (sin la biblioteca `zip`, que llega en el Increment 7): topes de 20 000 entradas y 4 MiB de directorio, ZIP64 rechazado, longitud de comentario coherente.
- **Lector OLE2 propio:** cadena de directorio acotada (1024 sectores), DIFAT acotada, desplazamientos validados contra la longitud del archivo.
- **Tarballs:** `flate2`, `bzip2` y `liblzma` se añaden ya en este increment para confirmar que el primer bloque descomprimido es una cabecera `ustar`; no hay comprobación previa de la firma porque los decodificadores ya rechazan lo que no es suyo.
- **Texto corto:** un archivo de menos de 512 bytes sin NUL que empiece como una firma (`PK\x03\x04` solo, por ejemplo) sigue siendo texto, como en la 2A; las pruebas exigen «no es Office ni comprimido», no «es binario».

## Cambios que estos resultados imponen al plan y al diseño

| Punto del plan | Cambio |
|---|---|
| Diseño §3 y §4, ADR-0010 | ZetaOffice vive en un `iframe` con `sandbox="allow-scripts allow-same-origin"` y `allow="cross-origin-isolated"`, servido por `zeta-assets` con su propia CSP (`'unsafe-eval'`, `'wasm-unsafe-eval'`); la CSP de la página principal solo suma `frame-src`. Desaparecen el CORS, el `Blob` con `importScripts` y `locateFile` |
| 4.1 lock | Cuatro archivos (más `soffice.data.js.metadata`); sin URL inmutable: se fija por SHA-256 |
| 4.3 protocolo | `Range` obligatorio (no opcional): el cuerpo entero llega a 1268 MB en Rust; el anfitrión descarga por tramos y usa `Module.wasmBinary` y `Module.getPreloadedPackage`; sin `Content-Encoding: br` |
| 4.5 y 5.1 | El anfitrión sin `canvas` en la página principal: el lienzo, `FS` y el worker UNO están dentro del iframe; mensajes por `postMessage`; el interceptor se instala al abrir cada documento |
| 5.4 reciclaje | Se destruye el iframe (no se recarga la página) y se espera a que el proceso muera antes de crear otro |
| `MAX_OFFICE_BYTES` y `OFFICE_LOAD_TIMEOUT` | 32 MiB y 60 s |
| 1.10 y 9.x `svn.exe` | **SlikSVN 1.14.5** (23 archivos, 15,0 MB, con BerkeleyDB y OpenSSL 3: el 9.6 sigue vigente); `vcruntime140.dll`, `vcruntime140_1.dll` y `msvcp140.dll` se copian de la edición de Visual Studio del equipo de compilación; VisualSVN 1.15.0 queda como alternativa documentada |
| 7.1 crates | Compilador 1.88: `sevenz-rust2` 0.20.2, `rars` 0.10.0, `aes` 0.9.2; o subir el compilador. Regla nueva: rechazar 7z con bloque declarado mayor de 256 MiB antes de decodificar |
| 9.x documento | Las macros no pueden ejecutarse en esta compilación; `has_macros` solo informa |
| Limitación de producto | Interfaz de ZetaOffice solo en inglés |
| Interfaz de ZetaOffice | S1g: bloquear comandos con interceptores independientes (uno por registro), enviar `resize` al iframe, `user-select: none`, foco al iframe; el resto queda como paso 5.7 |

## Increment 4 — hallazgos medidos en la ventana real (2026-10-18)

| Hallazgo | Medición | Consecuencia |
|---|---|---|
| Ctrl+O abría el selector de archivos de LibreOffice | En Writer el atajo es `.uno:OpenFromWriter` (Calc e Impress tienen el suyo); la lista exacta solo conocía `.uno:Open`. El selector mostraba `/home/web_user` (disco virtual), no el del usuario | El interceptor veta por familias de prefijo (`Open*`, `SaveAs*`, `Export*`, `SendMail*`) |
| `queryDispatch` se consulta al construir menús | Un `blocked` por consulta daba el aviso al abrir (`.uno:HelpIndex`) y desbordaba el contenedor 45 px | Los comandos vetados devuelven un despachador inerte que avisa solo al ejecutarse |
| El lienzo tarda en dibujarse | Una captura inmediata tras `opened` sale en blanco; a los 2 a 5 s aparecen menús, regla y barra de estado completos | Las pruebas esperan 4 s antes de interactuar |
| `location.assign` externo emite la petición | Respuesta 200 con cabeceras de Cloudflare (`cf-ray`) y la ventana no cambia (`net::ERR_ABORTED`) | Riesgo residual documentado; Rust impide el cambio de origen, no la petición |
| Playwright enmascara `on_download` | Con Playwright la descarga se completa y aparece `edge://downloads-hub`; con CDP crudo el manejador de Rust cancela y no se escribe nada | La prueba de descarga usa `rawCdp.ts` y comprueba el disco; validada con un mutante (`true`) |
| El clic en un enlace de Writer no es observable | Un Ctrl+clic sobre un hipervínculo azul no llamó a `window.open` ni produjo `blocked`; el menú contextual (clic derecho, Shift+F10) y el menú Edit no se dibujaron | No hay prueba de que el enlace se active; la defensa es el `sandbox` del iframe y `on_new_window` |
| Un ODT con biblioteca Basic incompleta no abre | `loadComponentFromURL` devolvió `null` con `script-lc.xml` sin `script-lb.xml` ni entradas de manifiesto; con la estructura completa abre y se detecta `has_macros` | Era el fixture, no el visor |

## Increment 5 — hallazgos medidos al editar y guardar (2026-10-18)

| Hallazgo | Medición | Consecuencia |
|---|---|---|
| `modified` también se notifica al limpiar la bandera | Tras `store()` el documento seguía «Modificado» aunque el guardado llegó a disco (versión devuelta) | El worker avisa solo si `isModified()` y no mientras guarda |
| `FS.readFile` puede apoyarse en memoria compartida | El envío de bytes por el puerto no completaba el guardado | `host.js` copia a un `ArrayBuffer` propio |
| Una instancia del visor obsoleta enviaba `open` al iframe de la nueva | «open: ya abierto opening» al abrir un tercer documento tras varios cambios | Guardas de generación en el visor y `destroyOwned(generación)` en el anfitrión |
| El diálogo de cierre de pestaña usa «Volver», no «Cancelar» | Captura del fallo | La prueba usa el rótulo real |
| La ventana interna queda 2 px más estrecha y 24 px más baja que el iframe | `getPosSize()` frente al recuadro, constante en cuatro tamaños de ventana | La prueba exige constancia, no igualdad; con 1000×700 el panel (≈290 px) es menor que el alto mínimo de 360 px y el visor desplaza |
| Diez ciclos de abrir y cerrar | Sin acumulación bajo el tope de 2,5 GiB de memoria privada del WebView | `OFFICE_RELEASED_BYTES` (1 GiB) basta como señal de liberación; el tope de reciclado se cumple porque cada cierre destruye el iframe |
| Ocultar o atenuar las entradas vetadas de los menús | `getSettings(menubar, true)` y `replaceSettings` sobre el gestor del módulo lanzan `IllegalAccessException` (solo lectura); el del documento (`model.getUIConfigurationManager()`) no tiene la barra y escribir ahí la guardaría en los ODF; un `statusChanged` con `IsEnabled = false` desde `addStatusListener` no atenuó el botón Abrir y la mitad de los oyentes llegan sin métodos (`$precise`) | Se mantiene el despachador inerte con aviso: las entradas siguen dibujadas activas |
| Los cuadros de estilo y fuente tardan en rellenarse | Vacíos 5 s después de abrir, llenos a los 14 s, con o sin los cambios de los despachadores | Las pruebas no dependen de ellos |
