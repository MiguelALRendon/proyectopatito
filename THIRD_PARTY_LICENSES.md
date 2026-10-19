# Licencias de terceros

dakedaduck svn se distribuye bajo la licencia MIT (archivo `LICENSE`). Incluye, o descarga al ejecutarse desde su propio instalador, los componentes de terceros que se listan aquí con sus licencias y, donde la licencia lo pide, la forma de obtener su código fuente. Este documento se genera con `scripts/generate-licenses.mjs`: las dos últimas secciones salen de `package-lock.json` y `Cargo.lock`; el resto está escrito a mano en `third_party/licenses-header.md`.

## Subversion incluido (SlikSVN 1.14.5)

El instalador lleva el cliente `svn.exe` de **SlikSVN 1.14.5** (compilación de Windows x64 de Apache Subversion 1.14.5, publicada por SlikSVN) y solo las bibliotecas que necesita. El manifiesto con el SHA-256 de cada archivo está en `third_party/svn.manifest.json` y se comprueba en cada arranque.

| Componente                                    | Licencia                                                              | Texto completo                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Apache Subversion 1.14.5                      | Apache-2.0                                                            | `svn\licenses\Subversion-License.txt`                                            |
| Apache Portable Runtime (APR) y APR-Util      | Apache-2.0                                                            | `Apr-License.txt`, `Apr-Util-License.txt`                                        |
| Berkeley DB 4.4 (`SlikSvn-DB44-20-x64.dll`)   | Licencia de Sleepycat Software (redistribución con oferta de fuentes) | `BerkeleyDB-License.txt`                                                         |
| OpenSSL 3 (`libssl-3-x64`, `libcrypto-3-x64`) | Apache-2.0 (no lleva la cláusula de publicidad de OpenSSL 1.1)        | `OpenSSL-License.txt`                                                            |
| Cyrus SASL                                    | BSD con atribución                                                    | `Cyrus-Sasl-License.txt`                                                         |
| GNU gettext (`libintl`)                       | LGPL-2.1                                                              | `GetText-Runtime-License.txt`                                                    |
| Serf, LZ4, utf8proc, zlib                     | Apache-2.0, BSD-2, MIT y zlib                                         | `Serf-License.txt`, `LZ4-License.txt`, `Utf8Proc-License.md`, `ZLib-License.txt` |

Los textos completos se instalan junto a `svn.exe`, en la carpeta `svn\licenses` de la aplicación.

**Oferta de código fuente.** La licencia de Berkeley DB exige que quien redistribuye el binario informe de cómo obtener el código completo de Berkeley DB y del software que lo usa (Subversion y sus bibliotecas). Se obtiene sin coste, de sus proyectos de origen: Apache Subversion 1.14.5 en <https://subversion.apache.org/download.cgi> (archivo `subversion-1.14.5`), Apache APR y APR-Util en <https://apr.apache.org/>, Berkeley DB 4.4 en <https://www.oracle.com/database/technologies/related/berkeleydb.html> y OpenSSL en <https://www.openssl.org/source/>. El empaquetado de Windows sin modificar es el de <https://sliksvn.com/>.

## Runtime de Visual C++

`svn.exe` y sus bibliotecas importan `vcruntime140.dll`, `vcruntime140_1.dll` y `msvcp140.dll`, que se distribuyen **sin cambios**, copiadas del redistribuible de Visual C++ 14.51.36247.0 de Visual Studio, según los términos de redistribución de Microsoft para los archivos de la lista REDIST (<https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files>). La propia aplicación se enlaza con el runtime de C de forma estática y no las necesita.

## ZetaOffice (LibreOffice 24.2 para WebAssembly) y zetajs

Los binarios `soffice.js`, `soffice.wasm`, `soffice.data` y `soffice.data.js.metadata` se descargan con `scripts/fetch-zetaoffice.ps1` desde el CDN de ZetaOffice, se fijan por SHA-256 en `third_party/zetaoffice.lock.json` y viajan como recurso del instalador. Son una compilación de allotropia de la rama `distro/allotropia/zeta-24-2` de LibreOffice.

| Componente                                                                                                | Licencia                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| LibreOffice (código propio)                                                                               | Mozilla Public License 2.0                                                                                           |
| Qt 5.15.2 (fork de allotropia)                                                                            | LGPL-3.0 (con GPL-3.0 y acuerdo comercial como alternativas)                                                         |
| Emscripten (fork de allotropia, `fixed-3.1.65`)                                                           | MIT y otras permisivas                                                                                               |
| Componentes de terceros de LibreOffice (158 declarados en su `license.xml`)                               | Mayoría Apache-2.0, MIT, BSD, Boost, MPL, OFL; tres de ellos LGPL (CLucene y dos diccionarios que no se distribuyen) |
| Fuentes incluidas en `soffice.data` (Liberation, DejaVu, Carlito, Caladea, Noto, Amiri, Linux Libertine…) | SIL Open Font License 1.1 y Bitstream Vera / DejaVu                                                                  |
| zetajs 1.2.0                                                                                              | MIT, © allotropia software GmbH and contributors                                                                     |

El `license.xml` de la rama `distro/allotropia/zeta-24-2` es el aviso completo y superconjunto de los anteriores.

**Oferta de código fuente (MPL y LGPL).** El código de lo que se distribuye está disponible públicamente, sin coste: LibreOffice, rama `distro/allotropia/zeta-24-2`; Qt, repositorios `allotropia/qtbase` y `allotropia/qt5` (rama `5.15.2+wasm`) de GitHub; Emscripten, repositorio `allotropia/emscripten` (rama `fixed-3.1.65`); y las instrucciones de compilación, en el README de <https://github.com/allotropia/zetajs>. Como `soffice.wasm` se distribuye sin cambios, el usuario puede sustituirlo por una compilación propia: basta reemplazar los archivos de la carpeta `zetaoffice` de la instalación (el instalador se declara por usuario, así que la carpeta es escribible).

Limitación conocida: no existe una URL con versión inmutable de estos binarios, así que se identifican por su SHA-256 y no por el commit exacto de compilación, que allotropia no publica.

## Bibliotecas de comprimidos

| Biblioteca                                       | Licencia         | Notas                                                                                 |
| ------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------- |
| `rars` 0.10.0                                    | Apache-2.0       | Lectura de RAR en Rust. No incluye cifrado                                            |
| `sevenz-rust2` 0.20.2                            | Apache-2.0       | 7z                                                                                    |
| `zip` 9.0.4, `tar`, `flate2`, `bzip2`, `liblzma` | MIT / Apache-2.0 | zip, tar, gzip, bzip2 y xz (`liblzma` enlaza liblzma de xz-utils, de dominio público) |

## Paquetes de npm que llegan a la interfaz

Salen de `package-lock.json` (solo dependencias de ejecución, 43 paquetes).

| Paquete                                   | Licencia                |
| ----------------------------------------- | ----------------------- |
| @babel/helper-string-parser 7.29.7        | MIT                     |
| @babel/helper-validator-identifier 7.29.7 | MIT                     |
| @babel/parser 7.29.9                      | MIT                     |
| @babel/types 7.29.8                       | MIT                     |
| @jridgewell/sourcemap-codec 1.6.0         | MIT                     |
| @napi-rs/canvas 1.0.11                    | MIT                     |
| @napi-rs/canvas-win32-x64-msvc 1.0.11     | MIT                     |
| @tauri-apps/api 2.11.1                    | Apache-2.0 OR MIT       |
| @tauri-apps/plugin-dialog 2.7.3           | MIT OR Apache-2.0       |
| @types/trusted-types 2.0.7                | MIT                     |
| @vue/compiler-core 3.5.43                 | MIT                     |
| @vue/compiler-dom 3.5.43                  | MIT                     |
| @vue/compiler-sfc 3.5.43                  | MIT                     |
| @vue/compiler-ssr 3.5.43                  | MIT                     |
| @vue/devtools-api 8.2.1                   | MIT                     |
| @vue/devtools-kit 8.2.1                   | MIT                     |
| @vue/devtools-shared 8.2.1                | MIT                     |
| @vue/reactivity 3.5.43                    | MIT                     |
| @vue/runtime-core 3.5.43                  | MIT                     |
| @vue/runtime-dom 3.5.43                   | MIT                     |
| @vue/server-renderer 3.5.43               | MIT                     |
| @vue/shared 3.5.43                        | MIT                     |
| birpc 2.9.0                               | MIT                     |
| csstype 3.2.3                             | MIT                     |
| dompurify 3.4.17                          | (MPL-2.0 OR Apache-2.0) |
| entities 7.0.1                            | BSD-2-Clause            |
| estree-walker 2.0.2                       | MIT                     |
| hookable 5.5.3                            | MIT                     |
| magic-string 0.30.21                      | MIT                     |
| marked 14.0.0                             | MIT                     |
| marked 18.1.1                             | MIT                     |
| monaco-editor 0.57.0                      | MIT                     |
| nanoid 3.3.20                             | MIT                     |
| nostics 1.3.0                             | MIT                     |
| pdfjs-dist 6.4.299                        | Apache-2.0              |
| perfect-debounce 2.1.0                    | MIT                     |
| picocolors 1.1.1                          | ISC                     |
| pinia 4.0.3                               | MIT                     |
| postcss 8.5.30                            | MIT                     |
| source-map-js 1.2.2                       | BSD-3-Clause            |
| typescript 6.0.3                          | Apache-2.0              |
| vue 3.5.43                                | MIT                     |
| zetajs 1.2.0                              | MIT                     |

## Crates de Rust enlazados en el ejecutable

Salen de `Cargo.lock` para x86_64-pc-windows-msvc (solo dependencias normales, 248 crates).

| Paquete                             | Licencia                            |
| ----------------------------------- | ----------------------------------- |
| adler2 v2.0.1                       | 0BSD OR MIT OR Apache-2.0           |
| aes v0.8.4                          | MIT OR Apache-2.0                   |
| aho-corasick v1.1.5                 | Unlicense OR MIT (*)                |
| alloc-no-stdlib v2.0.4              | BSD-3-Clause                        |
| alloc-stdlib v0.2.4                 | BSD-3-Clause (*)                    |
| anyhow v1.0.104                     | MIT OR Apache-2.0                   |
| base64 v0.22.1                      | MIT OR Apache-2.0                   |
| base64 v0.23.1                      | MIT OR Apache-2.0                   |
| bit-set v0.8.0                      | Apache-2.0 OR MIT                   |
| bit-vec v0.8.0                      | Apache-2.0 OR MIT                   |
| bitflags v1.3.2                     | MIT/Apache-2.0                      |
| bitflags v2.13.2                    | MIT OR Apache-2.0 (*)               |
| block-buffer v0.10.4                | MIT OR Apache-2.0                   |
| block-padding v0.3.3                | MIT OR Apache-2.0                   |
| brotli v8.0.4                       | BSD-3-Clause AND MIT                |
| brotli-decompressor v5.0.3          | BSD-3-Clause/MIT                    |
| bumpalo v3.20.3                     | MIT OR Apache-2.0                   |
| byteorder v1.5.0                    | Unlicense OR MIT                    |
| bytes v1.12.1                       | MIT                                 |
| bzip2 v0.6.1                        | MIT OR Apache-2.0 (*)               |
| camino v1.2.6                       | MIT OR Apache-2.0                   |
| cargo_metadata v0.19.2              | MIT                                 |
| cargo-platform v0.1.9               | MIT OR Apache-2.0                   |
| cbc v0.1.2                          | MIT OR Apache-2.0                   |
| cfb v0.7.3                          | MIT                                 |
| cfg-if v1.0.5                       | MIT OR Apache-2.0                   |
| cipher v0.4.4                       | MIT OR Apache-2.0 (*)               |
| cookie v0.18.2                      | MIT OR Apache-2.0 (*)               |
| cpufeatures v0.2.17                 | MIT OR Apache-2.0                   |
| crc32fast v1.5.2                    | MIT OR Apache-2.0 (*)               |
| crossbeam-channel v0.5.17           | MIT OR Apache-2.0 (*)               |
| crossbeam-utils v0.8.23             | MIT OR Apache-2.0                   |
| crypto-common v0.1.7                | MIT OR Apache-2.0                   |
| cssparser v0.36.0                   | MPL-2.0 (*)                         |
| cssparser-macros v0.6.1             | MPL-2.0                             |
| ctor v0.8.0                         | Apache-2.0 OR MIT                   |
| ctor-proc-macro v0.0.7              | Apache-2.0 OR MIT                   |
| darling v0.24.1                     | MIT                                 |
| darling_core v0.24.1                | MIT (*)                             |
| darling_macro v0.24.1               | MIT                                 |
| deranged v0.5.8                     | MIT OR Apache-2.0                   |
| derive_more v2.1.1                  | MIT                                 |
| derive_more-impl v2.1.1             | MIT                                 |
| digest v0.10.7                      | MIT OR Apache-2.0                   |
| dirs v6.0.0                         | MIT OR Apache-2.0                   |
| dirs-sys v0.5.0                     | MIT OR Apache-2.0                   |
| displaydoc v0.2.7                   | MIT OR Apache-2.0 (*)               |
| dom_query v0.27.0                   | MIT                                 |
| dpi v0.1.2                          | Apache-2.0 AND MIT (*)              |
| dtoa v1.0.11                        | MIT OR Apache-2.0                   |
| dtoa-short v0.3.5                   | MPL-2.0                             |
| dunce v1.0.5                        | CC0-1.0 OR MIT-0 OR Apache-2.0      |
| dyn-clone v1.0.20                   | MIT OR Apache-2.0                   |
| equivalent v1.0.2                   | Apache-2.0 OR MIT                   |
| erased-serde v0.4.10                | MIT OR Apache-2.0                   |
| fastrand v2.5.0                     | Apache-2.0 OR MIT                   |
| fdeflate v0.3.7                     | MIT OR Apache-2.0                   |
| filetime v0.2.29                    | MIT/Apache-2.0                      |
| flate2 v1.1.10                      | MIT OR Apache-2.0 (*)               |
| fnv v1.0.7                          | Apache-2.0 / MIT                    |
| foldhash v0.2.0                     | Zlib                                |
| form_urlencoded v1.2.2              | MIT OR Apache-2.0                   |
| generic-array v0.14.7               | MIT (*)                             |
| getrandom v0.3.4                    | MIT OR Apache-2.0                   |
| getrandom v0.4.3                    | MIT OR Apache-2.0                   |
| glob v0.3.4                         | MIT OR Apache-2.0                   |
| hashbrown v0.12.3                   | MIT OR Apache-2.0                   |
| hashbrown v0.17.1                   | MIT OR Apache-2.0                   |
| heck v0.5.0                         | MIT OR Apache-2.0                   |
| html5ever v0.38.0                   | MIT OR Apache-2.0                   |
| http v1.5.0                         | MIT OR Apache-2.0 (*)               |
| ico v0.5.0                          | MIT                                 |
| icu_collections v2.3.0              | Unicode-3.0 (*)                     |
| icu_locale_core v2.3.0              | Unicode-3.0 (*)                     |
| icu_normalizer v2.3.0               | Unicode-3.0                         |
| icu_normalizer_data v2.3.0          | Unicode-3.0                         |
| icu_properties v2.3.0               | Unicode-3.0                         |
| icu_properties_data v2.3.0          | Unicode-3.0                         |
| icu_provider v2.3.1                 | Unicode-3.0 (*)                     |
| ident_case v1.0.1                   | MIT/Apache-2.0                      |
| idna v1.1.0                         | MIT OR Apache-2.0                   |
| idna_adapter v1.2.2                 | Apache-2.0 OR MIT                   |
| indexmap v1.9.3                     | Apache-2.0 OR MIT                   |
| indexmap v2.14.2                    | Apache-2.0 OR MIT (*)               |
| infer v0.19.0                       | MIT                                 |
| inout v0.1.4                        | MIT OR Apache-2.0                   |
| itoa v1.0.18                        | MIT OR Apache-2.0                   |
| json-patch v3.0.1                   | MIT/Apache-2.0                      |
| jsonptr v0.6.3                      | MIT OR Apache-2.0                   |
| keyboard-types v0.7.0               | MIT OR Apache-2.0                   |
| libbz2-rs-sys v0.2.5                | bzip2-1.0.6                         |
| libc v0.2.190                       | MIT OR Apache-2.0                   |
| liblzma v0.4.8                      | MIT OR Apache-2.0                   |
| liblzma-sys v0.4.9                  | MIT OR Apache-2.0                   |
| litemap v0.8.3                      | Unicode-3.0                         |
| lock_api v0.4.14                    | MIT OR Apache-2.0                   |
| log v0.4.34                         | MIT OR Apache-2.0                   |
| lzma-rust2 v0.16.5                  | Apache-2.0                          |
| markup5ever v0.38.0                 | MIT OR Apache-2.0                   |
| memchr v2.8.3                       | Unlicense OR MIT                    |
| mime v0.3.17                        | MIT OR Apache-2.0                   |
| miniz_oxide v0.8.9                  | MIT OR Zlib OR Apache-2.0           |
| miniz_oxide v0.9.1                  | MIT OR Zlib OR Apache-2.0           |
| mio v1.2.4                          | MIT                                 |
| muda v0.19.3                        | Apache-2.0 OR MIT                   |
| new_debug_unreachable v1.0.6        | MIT                                 |
| normpath v1.5.2                     | MIT OR Apache-2.0                   |
| num-conv v0.2.2                     | MIT OR Apache-2.0                   |
| once_cell v1.21.4                   | MIT OR Apache-2.0                   |
| opener v0.9.0                       | MIT OR Apache-2.0                   |
| option-ext v0.2.0                   | MPL-2.0                             |
| parking_lot v0.12.5                 | MIT OR Apache-2.0                   |
| parking_lot_core v0.9.12            | MIT OR Apache-2.0                   |
| percent-encoding v2.3.2             | MIT OR Apache-2.0                   |
| phf v0.13.1                         | MIT                                 |
| phf_generator v0.13.1               | MIT                                 |
| phf_macros v0.13.1                  | MIT (*)                             |
| phf_shared v0.13.1                  | MIT                                 |
| pin-project-lite v0.2.17            | Apache-2.0 OR MIT                   |
| plist v1.10.1                       | MIT                                 |
| png v0.17.16                        | MIT OR Apache-2.0 (*)               |
| potential_utf v0.1.6                | Unicode-3.0                         |
| powerfmt v0.2.1                     | MIT OR Apache-2.0                   |
| ppmd-rust v1.5.1                    | CC0-1.0 OR MIT-0                    |
| precomputed-hash v0.1.1             | MIT                                 |
| proc-macro2 v1.0.107                | MIT OR Apache-2.0 (*)               |
| quick-xml v0.42.0                   | MIT (*)                             |
| quote v1.0.47                       | MIT OR Apache-2.0 (*)               |
| rars v0.10.0                        | Apache-2.0                          |
| raw-window-handle v0.6.2            | MIT OR Apache-2.0 OR Zlib           |
| regex v1.13.1                       | MIT OR Apache-2.0 (*)               |
| regex-automata v0.4.18              | MIT OR Apache-2.0                   |
| regex-syntax v0.8.11                | MIT OR Apache-2.0                   |
| rfd v0.16.0                         | MIT                                 |
| rustc-hash v2.1.3                   | Apache-2.0 OR MIT                   |
| same-file v1.0.6                    | Unlicense/MIT                       |
| schemars v0.8.22                    | MIT                                 |
| schemars_derive v0.8.22             | MIT                                 |
| scopeguard v1.2.0                   | MIT OR Apache-2.0                   |
| selectors v0.36.1                   | MPL-2.0                             |
| semver v1.0.28                      | MIT OR Apache-2.0                   |
| serde v1.0.229                      | MIT OR Apache-2.0 (*)               |
| serde_core v1.0.229                 | MIT OR Apache-2.0                   |
| serde_derive v1.0.229               | MIT OR Apache-2.0 (*)               |
| serde_derive_internals v0.29.1      | MIT OR Apache-2.0                   |
| serde_json v1.0.154                 | MIT OR Apache-2.0 (*)               |
| serde_repr v0.1.21                  | MIT OR Apache-2.0 (*)               |
| serde_spanned v1.1.2                | MIT OR Apache-2.0                   |
| serde_with v3.24.0                  | MIT OR Apache-2.0                   |
| serde_with_macros v3.24.0           | MIT OR Apache-2.0 (*)               |
| serde-untagged v0.1.9               | MIT OR Apache-2.0                   |
| serialize-to-javascript v0.1.2      | MIT OR Apache-2.0                   |
| serialize-to-javascript-impl v0.1.2 | MIT OR Apache-2.0                   |
| servo_arc v0.4.3                    | MIT OR Apache-2.0                   |
| sevenz-rust2 v0.20.2                | Apache-2.0                          |
| sha2 v0.10.9                        | MIT OR Apache-2.0                   |
| simd-adler32 v0.3.10                | MIT                                 |
| siphasher v1.0.4                    | MIT OR Apache-2.0                   |
| smallvec v1.16.3                    | MIT OR Apache-2.0                   |
| softbuffer v0.4.8                   | MIT OR Apache-2.0                   |
| stable_deref_trait v1.2.1           | MIT OR Apache-2.0                   |
| string_cache v0.9.0                 | MIT OR Apache-2.0                   |
| strsim v0.11.1                      | MIT                                 |
| syn v2.0.119                        | MIT OR Apache-2.0 (*)               |
| syn v3.0.9                          | MIT OR Apache-2.0 (*)               |
| synstructure v0.14.0                | MIT (*)                             |
| tao v0.35.3                         | Apache-2.0                          |
| tar v0.4.46                         | MIT OR Apache-2.0                   |
| tauri v2.11.6                       | Apache-2.0 OR MIT (*)               |
| tauri-codegen v2.6.3                | Apache-2.0 OR MIT                   |
| tauri-macros v2.6.3                 | Apache-2.0 OR MIT                   |
| tauri-plugin-dialog v2.7.3          | Apache-2.0 OR MIT                   |
| tauri-plugin-fs v2.5.2              | Apache-2.0 OR MIT                   |
| tauri-runtime v2.11.3               | Apache-2.0 OR MIT (*)               |
| tauri-runtime-wry v2.11.4           | Apache-2.0 OR MIT                   |
| tauri-utils v2.9.3                  | Apache-2.0 OR MIT (*)               |
| tendril v0.5.1                      | MIT OR Apache-2.0 (*)               |
| thiserror v1.0.69                   | MIT OR Apache-2.0                   |
| thiserror v2.0.21                   | MIT OR Apache-2.0 (*)               |
| thiserror-impl v1.0.69              | MIT OR Apache-2.0 (*)               |
| thiserror-impl v2.0.21              | MIT OR Apache-2.0 (*)               |
| time v0.3.55                        | MIT OR Apache-2.0 (*)               |
| time-core v0.1.9                    | MIT OR Apache-2.0                   |
| time-macros v0.2.32                 | MIT OR Apache-2.0                   |
| tinystr v0.8.4                      | Unicode-3.0                         |
| tokio v1.53.2                       | MIT (*)                             |
| tokio-macros v2.7.2                 | MIT                                 |
| toml v1.1.8+spec-1.1.0              | MIT OR Apache-2.0                   |
| toml_datetime v1.1.2+spec-1.1.0     | MIT OR Apache-2.0                   |
| toml_parser v1.1.5+spec-1.1.0       | MIT OR Apache-2.0                   |
| toml_writer v1.1.3+spec-1.1.0       | MIT OR Apache-2.0                   |
| tracing v0.1.44                     | MIT                                 |
| tracing-core v0.1.36                | MIT                                 |
| typed-path v0.12.3                  | MIT OR Apache-2.0                   |
| typeid v1.0.3                       | MIT OR Apache-2.0                   |
| typenum v1.20.1                     | MIT OR Apache-2.0                   |
| unic-char-property v0.9.0           | MIT/Apache-2.0                      |
| unic-char-range v0.9.0              | MIT/Apache-2.0                      |
| unic-common v0.9.0                  | MIT/Apache-2.0                      |
| unic-ucd-ident v0.9.0               | MIT/Apache-2.0                      |
| unic-ucd-version v0.9.0             | MIT/Apache-2.0                      |
| unicode-ident v1.0.27               | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-segmentation v1.13.3        | MIT OR Apache-2.0                   |
| url v2.5.8                          | MIT OR Apache-2.0 (*)               |
| urlpattern v0.3.0                   | MIT                                 |
| utf8_iter v1.0.4                    | Apache-2.0 OR MIT                   |
| uuid v1.26.1                        | Apache-2.0 OR MIT (*)               |
| walkdir v2.5.0                      | Unlicense/MIT                       |
| web_atoms v0.2.6                    | MIT OR Apache-2.0                   |
| webview2-com v0.38.2                | MIT (*)                             |
| webview2-com-macros v0.8.1          | MIT                                 |
| webview2-com-sys v0.38.2            | MIT                                 |
| winapi-util v0.1.11                 | Unlicense OR MIT (*)                |
| window-vibrancy v0.6.0              | Apache-2.0 OR MIT                   |
| windows v0.61.3                     | MIT OR Apache-2.0 (*)               |
| windows_x86_64_msvc v0.52.6         | MIT OR Apache-2.0                   |
| windows_x86_64_msvc v0.53.1         | MIT OR Apache-2.0                   |
| windows-collections v0.2.0          | MIT OR Apache-2.0                   |
| windows-core v0.61.2                | MIT OR Apache-2.0 (*)               |
| windows-future v0.2.1               | MIT OR Apache-2.0                   |
| windows-implement v0.60.2           | MIT OR Apache-2.0 (*)               |
| windows-interface v0.59.3           | MIT OR Apache-2.0 (*)               |
| windows-link v0.1.3                 | MIT OR Apache-2.0                   |
| windows-link v0.2.1                 | MIT OR Apache-2.0                   |
| windows-numerics v0.2.0             | MIT OR Apache-2.0                   |
| windows-result v0.3.4               | MIT OR Apache-2.0                   |
| windows-strings v0.4.2              | MIT OR Apache-2.0                   |
| windows-sys v0.59.0                 | MIT OR Apache-2.0                   |
| windows-sys v0.60.2                 | MIT OR Apache-2.0                   |
| windows-sys v0.61.2                 | MIT OR Apache-2.0 (*)               |
| windows-targets v0.52.6             | MIT OR Apache-2.0                   |
| windows-targets v0.53.5             | MIT OR Apache-2.0                   |
| windows-threading v0.1.0            | MIT OR Apache-2.0                   |
| windows-version v0.1.7              | MIT OR Apache-2.0 (*)               |
| winnow v1.0.4                       | MIT                                 |
| writeable v0.6.4                    | Unicode-3.0                         |
| wry v0.55.1                         | Apache-2.0 OR MIT                   |
| yoke v0.8.3                         | Unicode-3.0 (*)                     |
| yoke-derive v0.8.4                  | Unicode-3.0 (*)                     |
| zerofrom v0.1.8                     | Unicode-3.0 (*)                     |
| zerofrom-derive v0.1.8              | Unicode-3.0 (*)                     |
| zerotrie v0.2.5                     | Unicode-3.0 (*)                     |
| zerovec v0.11.8                     | Unicode-3.0 (*)                     |
| zerovec-derive v0.11.6              | Unicode-3.0 (*)                     |
| zip v9.0.4                          | MIT                                 |
| zlib-rs v0.6.8                      | Zlib                                |
| zmij v1.0.23                        | MIT                                 |
| zopfli v0.8.4                       | Apache-2.0                          |
