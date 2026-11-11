---
fecha: 2026-10-23
estado: secciones 1 a 4 aprobadas por el usuario (2026-10-23); correcciones de la revisión adversarial y §8 (certificados SSL) agregadas el mismo día por decisión del usuario, pendientes de su lectura
fase: 3
---

# Diseño — Fase 3: Marketplace

Fuente: `propuesta.md` §21 a §32, §67, §68, §120 y §121. Base: Fases 1, 2A y 2B (aceptadas). El Marketplace es un explorador remoto de contenido SVN; no abre documentos y no finge que SVN sea una tienda.

## 0. Decisiones del usuario

| Tema | Decisión |
|---|---|
| Credenciales | `svn.exe` guarda su propia caché de autenticación; la app pasa usuario y contraseña por stdin y no persiste ninguna contraseña. Aviso de que svn recordará la credencial y casilla «No recordar» (`--no-auth-cache`) |
| Archivo suelto | Solo `svn export` del archivo (copia limpia). Lo rastreable se descarga como carpeta (working copy) |
| Estado local | Índice de working copies del Workspace Root (UUID + URL + revisión), cruzado con la URL remota |
| Enfoque | A: extender `SvnClient` y reutilizar `Operations::checkout`, `OperationManager`, `config.json` y `wc_status_map`. Sin SQLite ni caché persistente |
| `svn+ssh` | Fuera del Marketplace (necesita un cliente ssh que SlikSVN no trae; deuda T-1) |
| Certificados SSL | Hay que poder conectar con servidores de todo tipo (https con certificado interno es normal en una empresa): entra en alcance (§8) |
| Externals hacia otro servidor | Con credencial, «Incluir externals» se bloquea con el motivo y se descarga con `--ignore-externals` |

## 1. Arquitectura

- **`svn/`**: `list --xml`, `info --xml <URL>`, `proplist -v --xml <URL>`, `propget svn:externals` y `export`; parsers y modelos tipados en `parsers.rs` y `models.rs`; opciones de red por operación (`--no-auth-cache`, autoridades de confianza, `--trust-server-cert-failures`, certificado de cliente) en `RunOptions`.
- **`app/marketplace/`**: registro de repositorios, construcción de URL, navegación, índice de WCs, estado local, externals y credenciales de sesión. Es lógica pura y de orquestación; la persistencia pasa por métodos finos de `AppState`.
- **`commands/`**: comandos tipados; el frontend nunca recibe `stdout` ni envía una URL de origen: envía `repo_id` y una ruta relativa.
- **Frontend**: se habilita la sección Marketplace (hoy un botón deshabilitado): repositorios, navegador, panel de detalle, diálogo de descarga y panel de descargas. La sección de archivos se conserva montada (`v-show`/`KeepAlive`) al cambiar de sección.

## 2. Modelo de datos

| Modelo | Campos | Dónde vive |
|---|---|---|
| `RepoEntry` | `id` (contador monótono persistido, no se reutiliza), `name`, `url`, `username?`, `favorite`, `last_path`, `client_cert?` (ruta del PKCS#12), `uuid?` y `root?` (de `svn info` al probar la conexión; los usa la Fase 5) | `config.json`, `marketplace.repos` |
| `ListEntry` | `name`, `kind`, `size`, `revision`, `author`, `date` | memoria (caché de 60 s) |
| `RemoteDetail` | `ListEntry` + `url`, `relative_url`, `repository_root`, `uuid`, `lock`, `mime`, `props` (con tope por valor) | memoria |
| `WcIndexEntry` | `root`, `uuid`, `url`, `revision` | memoria; se reconstruye (completo o solo el destino) |
| `LocalState` | `NotDownloaded`, `Downloaded`, `Outdated`, `Modified`, `Conflict`, `Incomplete`, `Unknown` | calculado |
| `TrustedCert` | `repo_id`, huella SHA-256, motivo, fecha | `config.json`, `marketplace.trusted` |

Constantes: `MAX_REPOS` 100, `MAX_LIST_ENTRIES` 10 000, `LIST_CACHE_TTL` 60 s, `MAX_PROP_VALUE_BYTES` 64 KiB, `MAX_SCAN_DEPTH` 4, `MAX_INDEXED_COPIES` 500, `MAX_PARALLEL_DOWNLOADS` 3, `PROGRESS_EVENTS_PER_SECOND` 10.

**Estado local.** `Outdated` = última revisión remota del elemento > última revisión **local de ese elemento**, leída con `svn info --depth immediates` sobre la carpeta local equivalente (una sola llamada por listado); la revisión base de la raíz de la copia no sirve (una copia con revisiones mixtas, tras un commit parcial, saldría desactualizada sin estarlo). `Modified`, `Conflict` e `Incomplete` salen de `wc_status_map` de esa copia sin ignorados; si el mapa se trunca o el estado falla, `Unknown`. Nunca timestamps. Una WC corresponde a un elemento si comparten `uuid` y la URL de la copia contiene la del elemento **por segmentos** (`/app` no contiene `/app2`); la ruta local se resuelve con `Workspace::resolve` y, si el nombre no es representable en Windows, el elemento se omite del cruce sin romper el listado.

## 3. Flujos

- **URL.** Una sola función Rust `remote_url(repo, ruta_relativa)` codifica por segmento (todo lo que no sea alfanumérico o `-._~`), valida que la ruta no suba por encima de la raíz registrada y deja el argumento en ASCII. Ningún comando recibe una URL de origen del frontend.
- **Navegar.** `list` con caché y cancelación por vista; el XML se interpreta en `spawn_blocking`; al seleccionar se pide `info` y `proplist`.
- **Descargar carpeta.** `marketplace_download(repo_id, ruta, opciones)` reconstruye la URL y llama a `Operations::checkout` o `Operations::export`. El destino debe **no existir** (`Workspace::resolve` con `allow_overwrite=false` ya lo exige; el árbol del workspace más un nombre nuevo, como `CheckoutForm`). Si la operación termina cancelada, vencida o con error, Rust borra el destino que creó.
- **Descargar archivo.** `export` a un destino inexistente; sin `--force`.
- **Externals.** Antes de descargar con profundidad completa o inmediatos se consulta `svn propget svn:externals` (con plazo y tope) y se resuelve cada definición contra la URL de su directorio y la raíz del repositorio; si apunta a otro host o esquema y hay credencial —o no se pudo comprobar— se descarga con `--ignore-externals` y se explica.
- **Errores.** `SvnErrorKind` gana `Network` y `NotFound`; junto con `AuthRequired` y `UntrustedCertificate` se mapean a `CommandErrorKind`, al contrato y a mensajes en español. Un fallo en un repositorio no afecta a los demás.

## 4. Seguridad

- Destino dentro del Workspace Root, inexistente, y no ancestro ni descendiente de otra operación (`try_lock_for_write` con `are_nested`, sin tomar dos veces el mismo candado).
- `is_safe_checkout_url` se **endurece** (protege también el `checkout` de la Fase 1): rechaza host que empiece por `-`, `file://` con servidor distinto de vacío o `localhost` (UNC), espacios, controles y `\`, `?`, `#` y `@N` final. Para el Marketplace se agrega la exclusión de `svn+ssh`. Argumentos separados (sin shell) y terminador `@` (`peg_safe`).
- Contraseña por stdin con el tipo `Password`; nunca en `argv`, `config.json`, errores ni JavaScript tras enviarla. Con «No recordar» vive solo en memoria de Rust. Aviso al enviarla por `http`.
- El progreso que ve la interfaz son eventos ya interpretados, con largo acotado y a lo sumo `PROGRESS_EVENTS_PER_SECOND` por operación.
- Las propiedades remotas llegan con tope de bytes, y nombres y valores se muestran escapando caracteres de control y bidireccionales.
- Si algo no se puede hacer con el `svn` incluido, se dice; no se simula.

## 5. Fuera de la Fase 3

Caché remota persistente (§105), modo sin conexión (§106), búsqueda remota (§75), arrastrar y soltar (§82), sparse checkout (§53), relocate (§56), `svn+ssh`, reanudar descargas interrumpidas, y credenciales de un segundo servidor para externals.

## 6. Pruebas

- **Rust**: integración con repositorio real (`svnadmin` + `file:///`) y `svnserve` de `.tools/` para autenticación (con `authz-db` para permisos denegados): `list`, `info`, `export`, `checkout` con revisión, profundidad y externals (segundo repositorio). Parsers con XML real saneado (nombres con espacios, acentos, `%`, `#`, `@`, emoji).
- **TLS real**: `openssl s_server` (de Git for Windows) con certificado autofirmado, firmado por una autoridad, vencido, con nombre distinto y exigiendo certificado de cliente.
- **Adversariales**: URL hostil (todas las clases de §4), ruta remota con `..`, destino existente, fuera del root o dentro de otra WC, ancestro/descendiente concurrente, repositorio inexistente, servidor detenido, credenciales erróneas, cancelación a mitad de descarga (con comprobación de que el destino se borró), nombres no representables en Windows, rutas largas.
- **Estado local**: WC al día, desactualizada (commit desde otra WC), commit parcial con revisiones mixtas, modificada, con conflicto, anidada, parcial (`--depth empty`), incompleta, eliminada del disco, mismo árbol con distinto UUID, URL hermana con prefijo común, copia fuera del root, enlace simbólico, mapa truncado.
- **Frontend**: Vitest y Stryker (registro, navegador, detalle, certificados, descargas, máquina de estados).
- **E2E** en la ventana real (CDP): agregar repositorio, navegar, detalle, confiar en un certificado, descargar carpeta y archivo, cancelar, reintentar, recorrer la sección con teclado, conservar el texto sin guardar al cambiar de sección, cerrar con una descarga en curso sin `svn.exe` huérfano.
- **Cierre**: `cargo check`, `cargo test`, `npm test`, `npm run build`, mutación y QA Increment, con evidencia.

## 7. Increments previstos

1. Medir SVN antes de construir. 2. Registro, errores clasificados y probar conexión (Rust). 3. Sección Marketplace y repositorios (interfaz). 4. Certificados SSL. 5. Listado e info remotos (Rust). 6. Navegador y detalle (interfaz). 7. Índice y estado local. 8. Descarga (Rust). 9. Administrador de descargas. 10. Diálogo de descarga. 11. Documentación. 12. QA Increment.

## 8. Certificados SSL (ampliación del 2026-10-23)

Decisión del usuario: la aplicación debe conectar con servidores de todo tipo; un certificado interno en una empresa es normal, así que no puede quedar fuera (§68 de la propuesta lo pide con consentimiento explícito).

- **Servidor no confiable.** El error `UntrustedCertificate` lleva el motivo (autoridad desconocida, autofirmado, caducado, nombre distinto). La interfaz muestra servidor, emisor, huella SHA-256, vigencia y motivo con **Cancelar** y **Confiar**.
- **Cómo se obtiene el certificado a mostrar** se decide con la medición **M5**: si la salida de `svn` ya trae emisor y huella, se usa; si no, Rust lo lee con una sonda TLS que solo hace el apretón de manos, nunca envía credenciales ni datos y solo lee el certificado presentado. Si la sonda exige una dependencia nueva (hoy no hay ninguna de TLS en `Cargo.toml`), **se consulta al usuario antes de agregarla**.
- **«Confiar»** guarda el certificado presentado en un almacén propio de la aplicación (en su carpeta de configuración, no en el de Subversion) y lo pasa a `svn` como autoridad de confianza por operación (`--config-option servers:global:ssl-authority-files=…`), de modo que solo ese certificado queda confiado y un certificado distinto vuelve a preguntar. Para fallos que una autoridad no resuelve (caducado, nombre distinto) la confianza se concede solo para esa huella y reintentando con `--trust-server-cert-failures` limitado a los motivos mostrados, tras el consentimiento. M5 confirma qué combinación funciona.
- **Autoridad de la empresa.** «Importar autoridad certificadora» copia un `.crt`/`.pem` al mismo almacén; todos los servidores que firme pasan a ser confiables sin preguntar. Cada confianza se puede ver y revocar.
- **Certificado de cliente.** Se asocia a un repositorio un PKCS#12 (`ssl-client-cert-file`); la frase de paso se pide en la interfaz y **no** viaja en `argv` ni se guarda: **M6** mide cómo entregársela a `svn` en modo no interactivo (caché de Subversion, o un directorio de configuración temporal y privado que se borra al terminar). Si ninguna forma segura funciona, se detiene y se consulta al usuario.
- **Límite honesto.** Las pruebas usan `openssl s_server` y comprueban el apretón de manos TLS; la respuesta HTTP de un servidor Subversion real (mod_dav_svn) no se emula, y se declara.
