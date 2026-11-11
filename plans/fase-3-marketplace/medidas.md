# Medidas — Fase 3: Marketplace (Increment 1)

> Mediciones hechas el 2026-10-23 en esta máquina (Windows 11 Home). Sirven de base a los increments 2 a 12 del `plan.md`. Los datos personales de los fixtures están saneados (`src-tauri/tests/fixtures/marketplace/README.md`).

**Versiones de `svn` usadas.** Empaquetado `src-tauri/resources/svn/svn.exe` **1.14.5** (principal); SlikSVN del sistema **1.14.2** y `.tools/apache-subversion` **1.15.0** como contraste. **No se midió con la versión mínima 1.10** (no hay binario disponible): lo que dependa de ella queda como supuesto. Servidores: `svnserve` 1.15.0 de `.tools/` (con `password-db` y `authz-db`), repositorios `file:///` creados con `svnadmin` 1.14.2, `tests/common/http_auth_server.ps1` (HTTP 401/404) y `openssl s_server` 3.2.4 de Git for Windows (TLS). Los scripts de medición son desechables (scratchpad) y no se commitean; lo que se repite está en los fixtures.

## Resumen de consecuencias para el plan

| # | Hallazgo | Consecuencia |
|---|---|---|
| M1 | La credencial dada por `stdin` **sí queda** en el auth cache (cifrada con `wincrypt` en `svn.simple`), y la segunda operación sin credenciales funciona; con `--no-auth-cache` no queda y la segunda falla con `E170001 Can't get password`; con `store-passwords=no` o sin almacenes, solo se guarda el usuario | La política «svn.exe cachea, la app no persiste» funciona; la casilla «No recordar» = `--no-auth-cache` **más** credenciales de sesión en Rust (si no, cada listado volvería a pedir la contraseña) |
| M1 | `E170001` lo comparten **autenticación** («Password incorrect», «Can't get password») y **autorización** («Authorization failed») | La clasificación debe mirar el mensaje, no solo el código: «Authorization failed» = permisos denegados y **no** debe abrir el diálogo de credenciales |
| M1 | http(s): con un servidor falso no se puede medir el cache (svn solo cachea tras un éxito completo); sin credenciales da `E215004 No more credentials` | **No medido para http(s)**; el aviso de la interfaz lo dice igual (svn usa el mismo almacén) |
| M2 | `svn list --xml` y `svn info --xml <URL>` traen `<lock>` (token, dueño, comentario, fecha); `info` trae `size` | El parser de la Fase 3 puede leer el bloqueo desde `list`; ver `fixtures/marketplace/` |
| M2 | `export` de carpeta termina con `Exported revision N.`; de **archivo** con `Export complete.` (sin revisión); con externals imprime `Exported external at revision N.` antes | `parse_revision` debe aceptar `Exported revision ` y **no** tomar la línea del external como revisión final; un export de archivo no tiene revisión |
| M2 | El texto de `export` se emite en la página de códigos OEM, no en UTF-8 (nombres con acentos salen como bytes no UTF-8) | La decodificación del progreso debe tolerarlo (UTF-8 con respaldo OEM/Latin-1) |
| M2 | Códigos de error: no encontrado = `W160013`+`E200009` (list/info por `file://` y `svn://`), `E160013` (http), `E210005` (repositorio inexistente en `svn://`), `E180001` (`file://` no es repositorio), `E160006` (revisión inexistente); red = `E730061` (rechazo), `E731001` (host desconocido), `E175012` (tiempo agotado); `E170013` envuelve a casi todos | Tabla de I2: se clasifica por el **código interno**, no por `E170013` |
| M3 | La revisión de commit de una carpeta en `list` es la del último cambio dentro del subárbol; `svn info --depth immediates --xml <carpeta local>` da en **una llamada** la revisión base y la última revisión cambiada de cada hijo; tras un commit parcial el hijo queda en la revisión nueva y la raíz en la anterior | «Desactualizado» = revisión remota del elemento > última revisión **local de ese elemento**; comparar con la revisión base de la raíz daría falsos positivos |
| M4 | `#` y `%` crudos funcionan, pero `%XX` se decodifica y `@` exige peg final o `%40`; un argumento que empieza por `-` se toma como opción; la ñ cruda funciona; el destino de un `export` de **archivo** necesita que exista la carpeta padre | `remote_url` codifica todo salvo `A-Za-z0-9-._~` por segmento y agrega `@`; la validación rechaza lo que no tenga `://` |
| M5 | Ante un certificado no confiable, `svn` en modo no interactivo **solo** dice `E230001` con los motivos («issuer is not trusted», «certificate issued for a different hostname», «certificate has expired»); **no** da emisor, huella ni vigencia | Para mostrar el diálogo de §68 hace falta leer el certificado por otro camino (ver «Decisión 1») |
| M5 | `--config-option servers:global:ssl-authority-files=<ruta>` (también con espacios) hace confiable una CA propia **y** un certificado autofirmado exacto; otro certificado distinto sigue fallando; para nombre distinto o vencido queda el motivo restante y se resuelve con `--trust-server-cert-failures=cn-mismatch` / `expired` / `unknown-ca` solo por esa invocación (no se guarda nada) | El almacén propio de certificados de la aplicación funciona como lo describe `design.md` §8; la confianza para nombre/vencido se concede por operación y por motivos concretos |
| M6 | Con un certificado de cliente PKCS#12: sin certificado, sin frase o con frase incorrecta el error es el mismo, `E120171 An error occurred during SSL communication`; la frase **no** se cachea en modo no interactivo | El mensaje de la interfaz debe decir «el servidor exige un certificado de cliente o la frase es incorrecta»; ver «Decisión 2» para entregar la frase |
| M6 | Funciona la frase en `ssl-client-cert-password` de un `servers` dentro de un `--config-dir` privado, y por `--config-option` (esta última queda en `argv`) | Ver «Decisión 2» |
| M7 | `svn list` (con y sin `--xml`) **se cierra con una violación de acceso** (exit 139, escribe un informe y un minidump en `%TEMP%` con nombres de archivo) cuando el directorio contiene un nombre con `:`; pasa igual en 1.14.2, 1.14.5 y 1.15.0; `svn info --depth immediates --xml <URL>` lista lo mismo **sin** caerse | El listado primario puede ser `list`, con **reintento por `info --depth immediates`** ante una salida anómala (código de salida de crash) y un aviso «nombres no válidos en Windows»; o usar `info --depth immediates` siempre (decidir con la medición de rendimiento de I5); los informes de caída en `%TEMP%` deben limpiarse |
| M7 | `checkout` aborta en el primer nombre no válido (`x.` → `E155000 … not valid as filename`) dejando una copia a medias; con `:` crea un flujo alterno de datos (`a:b`) | Confirma la limpieza del destino al fallar (I8) |
| M7 | Rutas de **431** caracteres absolutos funcionan en `checkout` y `export` con svn 1.14.5 | «Ruta demasiado larga» no es un fallo de `svn` a esa escala; lo que pueda fallar es `std::fs` de la aplicación |

## M1 — Auth cache (`svn://` con `svnserve`, sin `--config-dir` compartido)

Método: `svnserve` con `password-db` (usuarios `alice` y `bob`), cada caso con un `--config-dir` aislado, `printf 'secret1' | svn list svn://127.0.0.1:PUERTO/r1 --username alice --password-from-stdin --non-interactive` y luego la misma orden **sin** credenciales. Contraseña por `stdin` sin salto de línea (ADR 0005).

| Caso | Primera operación | Segunda sin credenciales | Qué queda en disco |
|---|---|---|---|
| Configuración por defecto | éxito | **éxito** | `auth/svn.simple/<hash>`: `passtype=wincrypt`, contraseña cifrada con DPAPI |
| `--no-auth-cache` | éxito | `E170001: Can't get password` | nada |
| `[auth] store-passwords = no` | éxito | `E170001: Can't get password` | un archivo con solo el nombre de usuario |
| `store-plaintext-passwords = no` y `password-stores =` | éxito | `E170001: Can't get password` | solo el usuario |
| Contraseña incorrecta | `E170001: Authentication error from server: Password incorrect` | — | — |
| Sin caché y sin credenciales | `E170001: Can't get password` | — | — |

Mismo comportamiento con las tres versiones (1.14.2: mensaje «Can't get username or password» en el caso sin caché). **http**: con `http_auth_server.ps1` (401 sin credenciales, 404 con credenciales correctas) la segunda operación no tiene caché porque `svn` solo la guarda tras una operación completa; los errores observados fueron `E215004 No more credentials or we tried too many times` (sin credenciales o incorrectas) y `E160013 '/repo' path not found` (credenciales correctas). **Veredicto:** se mantiene la decisión del usuario (el auth cache de svn.exe); «No recordar» exige credenciales de sesión en Rust.

## M2 — Salida real y códigos de error

Repositorio `file:///` con nombres con espacios, acentos, `%`, `#` y `@`, carpeta vacía, archivo bloqueado, propiedades (`svn:mime-type`, una propiedad con salto de línea) y un `svn:externals` hacia un segundo repositorio. Salidas literales saneadas en `src-tauri/tests/fixtures/marketplace/` (`list-*.xml`, `info-*.xml`, `proplist-*.xml`, `propget-externals.txt`, `export-*.txt`).

- `list --xml` de carpeta con espacios (`%20`), de `arroba@dir@` y de acentos (`%C3%B1`) funcionan; la lista de una carpeta vacía es un `<list>` sin entradas; un external **no** aparece en el listado.
- Códigos de error medidos (todos con `E170013` envolviendo, salvo los marcados): ver el resumen. Permisos: con `authz` (`bob` solo lectura / sin acceso) el listado y la escritura dan `E170001: Authorization failed`; credencial errónea `E170001: Authentication error from server: Password incorrect`.
- `export` de carpeta a un destino cuyo padre no existe crea los padres; el de **archivo** falla con `E720003` si el padre no existe.

## M3 — Revisión de una carpeta y `info --depth immediates`

Dos copias de trabajo (`wc` y `wc3` en la revisión 4). Tras `commit` parcial de un archivo (r5): el archivo queda con revisión base 5 y la raíz con 4. `list` remoto: la carpeta `carpeta con espacios` figura con revisión 3 (su último cambio) aunque HEAD era 4. En `wc3`, `info --xml 100%.txt` da última revisión cambiada 1 frente a 5 en `list` remoto (desactualizado). `svn info --depth immediates --xml <carpeta>` devuelve una `<entry>` por hijo con `revision` (base) y `<commit revision>` (última cambiada). **Veredicto:** la regla de «desactualizado» del diseño se sostiene; no se necesita `svn status -u` salvo en «Actualizar estado».

## M4 — URL, codificación y esquemas

Ver el resumen. No se probaron `file://` con un servidor remoto (UNC/SMB) ni `svn+ssh` (fuera del Marketplace): se confía en la validación de Rust, que se prueba en I2. `file://localhost/...` funciona; `file://host-inexistente/...` falla con `E180001`.

## M5 — Certificados de servidor (`openssl s_server`, svn 1.14.5)

Certificados generados con `openssl` 3.2.4: una CA, un servidor firmado por la CA con SAN `127.0.0.1`, un autofirmado con SAN, uno con SAN `otro.local`, uno vencido (2020), y un cliente firmado por la CA (PKCS#12 con frase). El servidor solo hace el apretón de manos TLS y responde HTTP simple, por lo que «TLS aceptado» se reconoce porque `svn` pasa a esperar HTTP y vence por `http-timeout` (`E175012`).

| Servidor | Sin confianza | Con `ssl-authority-files` | Con `--trust-server-cert-failures` |
|---|---|---|---|
| Firmado por CA interna | `issuer is not trusted` | CA: TLS aceptado (también con la ruta con espacios); un certificado ajeno como autoridad: sigue sin confiar | — |
| Autofirmado (hoja) | `issuer is not trusted` | el propio certificado: TLS aceptado | `unknown-ca`: aceptado (solo esa invocación) |
| Nombre distinto | `certificate issued for a different hostname, issuer is not trusted` | CA: queda `certificate issued for a different hostname` | CA + `cn-mismatch`: aceptado |
| Vencido | `certificate has expired, issuer is not trusted` | CA: queda `certificate has expired` | CA + `expired`: aceptado |

Con `--trust-server-cert-failures` no se escribe nada en el auth cache. Con el servidor falso de `tls_server.ps1` (autofirmado, sin HTTP) el comportamiento es el mismo. El mensaje de error **no** contiene emisor, huella ni vigencia.

## M6 — Certificado de cliente

`openssl s_server -Verify 1 -CAfile ca.crt`. Solo la combinación correcta pasa el TLS: `ssl-client-cert-file` apuntando al PKCS#12 y `ssl-client-cert-password` con la frase correcta, ya sea en el `servers` de un `--config-dir` o por `--config-option`. Casos fallidos (sin certificado, PKCS#12 sin frase, frase incorrecta, tras quitar la frase del archivo): todos `E120171`. **Trampa de la medición:** con `MSYS2_ARG_CONV_EXCL` activado, `--config-dir /c/...` no se convierte a ruta de Windows y `svn` ignora el directorio; los scripts deben pasar rutas de Windows.

## M7 — Windows

- `svn list` con un nombre `a:b` en el directorio: **violación de acceso** (exit 139) y un informe `svn-crash-log*.log`/`.dmp` en `%TEMP%`; no ocurre con `x.`, `aux.txt`, `con`, `?`, `"` ni `|`. `info --depth immediates` sí lista.
- `checkout` con `x.` en la raíz: `E155000 'x.' is not valid as filename` y aborta (queda una copia parcial); con `a:b` se crea un flujo alterno de datos en vez de una carpeta.
- Ruta de 431 caracteres absolutos: `checkout` y `export` correctos.

## Decisiones (puerta del paso 1.9, resueltas por el usuario el 2026-10-23)

Ninguna cambia el alcance aprobado, pero cada una cuesta algo que el plan prometía consultar. **Resuelto:** (1) opción (b), Schannel con `windows-sys`; (2) opción (b), directorio de configuración temporal con unión al `auth` real; (3) `svn list` con reintento por `svn info --depth immediates` tras una caída. Se reflejan en los pasos 2.5, 4.3, 4.4, 5.3 y 8.2 del `plan.md`.

1. **Cómo leer el certificado que el servidor presenta** (M5: `svn` no entrega emisor ni huella, y para «Confiar» con un certificado concreto hay que tenerlo). El proyecto no tiene ninguna dependencia de TLS. Opciones: (a) agregar `rustls` + un lector de X.509 (dependencias nuevas, compilación más pesada, apretón de manos solo de lectura y sin enviar nada); (b) usar Schannel de Windows con `windows-sys` (ya está en el árbol; sin crates nuevas pero con código `unsafe` propio); (c) no leerlo: confiar con `--trust-server-cert-failures` por operación, sin huella ni anclaje (contradice «no aceptar certificados arbitrarios» de §68).
2. **Cómo darle la frase de paso del certificado de cliente a `svn`** (M6). Opciones: (a) `--config-option` por `argv`: simple, la frase es visible a procesos del mismo usuario durante la operación; (b) un directorio de configuración temporal por operación con el `servers` combinado y una unión de directorios hacia el `auth` real (la frase no va en `argv` ni queda en disco tras la operación; más código y casos límite); (c) un directorio de configuración propio de la aplicación (la frase queda en disco en claro con permisos del usuario; separa también el auth cache del de TortoiseSVN).
3. **Listado ante nombres con `:`** (M7): reintento con `info --depth immediates` solo tras detectar la caída (menos llamadas), o usar siempre `info --depth immediates` (una sola vía, evita la caída). Lo decide la medición de rendimiento de I5 salvo que prefieras una.
