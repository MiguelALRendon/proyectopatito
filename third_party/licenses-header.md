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

Los textos completos de estas licencias (el `license.xml` de la rama de LibreOffice, la LGPL 3 y la GPL 3 de Qt y la LICENSE de zetajs) se instalan sin modificar en la carpeta `zetaoffice-licenses` de la aplicación, con su origen y su SHA-256 en el `README.md` de esa carpeta.

**Oferta de código fuente (MPL y LGPL).** El código de lo que se distribuye está disponible públicamente, sin coste: LibreOffice, rama `distro/allotropia/zeta-24-2`; Qt, repositorios `allotropia/qtbase` y `allotropia/qt5` (rama `5.15.2+wasm`) de GitHub; Emscripten, repositorio `allotropia/emscripten` (rama `fixed-3.1.65`); y las instrucciones de compilación, en el README de <https://github.com/allotropia/zetajs>. Como `soffice.wasm` se distribuye sin cambios, el usuario puede sustituirlo por una compilación propia: basta reemplazar los archivos de la carpeta `zetaoffice` de la instalación (el instalador se declara por usuario, así que la carpeta es escribible).

Limitación conocida: no existe una URL con versión inmutable de estos binarios, así que se identifican por su SHA-256 y no por el commit exacto de compilación, que allotropia no publica.

## Bibliotecas de comprimidos

| Biblioteca                                       | Licencia         | Notas                                                                                 |
| ------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------- |
| `rars` 0.10.0                                    | Apache-2.0       | Lectura de RAR en Rust. No incluye cifrado                                            |
| `sevenz-rust2` 0.20.2                            | Apache-2.0       | 7z                                                                                    |
| `zip` 9.0.4, `tar`, `flate2`, `bzip2`, `liblzma` | MIT / Apache-2.0 | zip, tar, gzip, bzip2 y xz (`liblzma` enlaza liblzma de xz-utils, de dominio público) |
