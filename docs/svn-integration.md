---
id: ref-svn-integration
title: Integración con Subversion
type: reference
status: current
source: code
last_verified: 2026-10-16
symbols: [SvnRunner, SvnClient, SvnBinary, locate, WcStatusReader, StatusCache, OperationManager, Operations, SvnError]
related: [ref-architecture, ref-workspace, ref-security, adr-0001, adr-0003, adr-0004, adr-0005, adr-0012]
---

# Integración con Subversion

La aplicación es el cliente y Subversion es el motor (Core Tenet 1). Todo equivalente de `svn.exe` se ejecuta con el cliente oficial; no se reimplementa el protocolo.

## Quién lanza `svn.exe`

Solo Rust, y solo el módulo `src-tauri/src/svn/` ([ADR 0001](adr/0001-sin-tauri-plugin-shell.md)). Capas `commands → app → svn`: `svn/` no importa `app/`, `commands/` ni `tauri` (comprobado con `grep` sobre `src-tauri/src/svn`), y `app/` y `config/` tampoco usan `tauri`. El frontend solo invoca commands tipados y nunca recibe `stdout` como texto. Ni `Cargo.toml`, ni `Cargo.lock`, ni `package.json` incluyen `tauri-plugin-shell`.

| Módulo | Responsabilidad |
|---|---|
| `svn/runner.rs` | `SvnRunner::run`: lanza el proceso, supervisa, decodifica |
| `svn/commands.rs` | Una struct de petición por subcomando; `args()` arma `argv` separado |
| `svn/parsers.rs`, `svn/models.rs` | XML de `svn info` y `svn status` a modelos tipados |
| `svn/client.rs` | `SvnClient`: `info`, `status`, `checkout`, `update`, `commit`, `cleanup` |
| `svn/error.rs` | `SvnError` y `SvnErrorKind` por código `E######` |
| `svn/progress.rs`, `svn/message_file.rs` | Progreso a partir de la salida y archivo temporal del mensaje de commit |
| `svn/locator.rs`, `svn/bundled.rs` | Localiza `svn.exe` (configurado, incluido y verificado por hash, sistema) y comprueba su versión |
| `app/operations.rs` | `Operations` y `OperationManager` |
| `app/wc_status.rs` | `wc_status_map` |

## Localizador y versión mínima

`locate(manual)` (`src-tauri/src/svn/locator.rs`):

- Con ruta manual, solo prueba esa ruta. Sin ella recorre `PATH` y luego `%ProgramFiles%\TortoiseSVN\bin`, `SlikSvn\bin` y `Apache Subversion\bin` (en ese orden, `search_dirs`).
- Cada candidato se prueba con `svn --version --quiet` (sin ventana, plazo `PROBE_TIMEOUT` de 5 s). `parse_version` exige tres números y descarta el sufijo.
- **Versión mínima 1.10** (`MIN_VERSION`), por `--password-from-stdin` ([ADR 0004](adr/0004-errores-svn-tls-wc-antigua-encoding.md)). Errores: `NotFound`, `Invalid(ruta)` y `TooOld`. Si hay un candidato antiguo y otro válido gana el válido.
- `AppState::svn_set_path` solo acepta un archivo llamado `svn.exe` y guarda `svn_path` en `config.json`. `AppState::detect` prueba primero `svn_path` y, si falla, la búsqueda normal; el resultado se cachea en memoria.

Pruebas: `src-tauri/tests/svn_layer.rs`. Deuda abierta: la primera detección puede bloquear un hilo hasta 5 s por candidato (**T-5**) y **T-18** propone mover el localizador a `svn/`.

## `SvnRunner`

| Aspecto | Comportamiento (`svn/runner.rs`) |
|---|---|
| Argumentos | `Vec<OsString>` separados, sin shell; `--non-interactive` va siempre al final; `--password-from-stdin` solo si hay contraseña |
| Entorno | `LANGUAGE=en` (la salida de progreso se interpreta en inglés y es solo para la interfaz); `CREATE_NO_WINDOW`; `kill_on_drop` |
| Plazo | `DEFAULT_TIMEOUT` de 120 s; las operaciones largas usan `OPERATION_TIMEOUT` de 1 h (`operations.rs`) |
| Cancelación | Un `Notify` por operación; al vencer el plazo o cancelar se mata el proceso (`TimedOut` / `Cancelled`) |
| Salida | `--xml` en UTF-8; `stderr` se decodifica como UTF-8 y, si no es válido, como Latin-1 (ADR 0004) |
| Contraseña | Tipo `Password` (su `Debug` imprime `Password(***)`); se escribe por stdin **sin salto de línea final** y se cierra stdin ([ADR 0005](adr/0005-password-por-stdin-sin-salto-de-linea.md)) |
| Redacción | `redact_command` oculta el valor de `--password` y `--password=` en `SvnError.command` |

Pruebas: `tests/svn_layer.rs` (plazo, cancelación, contraseña por stdin y no por argv, `--non-interactive` al final) y `tests/app_state.rs` (autenticación real contra `svnserve`). Deuda: un hijo de `svn` que herede los pipes (por ejemplo `ssh` de `svn+ssh`) puede colgar la operación hasta el plazo (**T-1**).

## Peticiones (`svn/commands.rs`)

| Petición | Argumentos |
|---|---|
| `InfoRequest` | `info --xml <ruta>@` |
| `StatusRequest` | `status --xml [--show-updates] [--no-ignore] [--username u] <ruta>@` |
| `CheckoutRequest` | `checkout [-r n] --depth <empty\|files\|immediates\|infinity> [--ignore-externals] [--username u] <url>@ <destino>` |
| `UpdateRequest` | `update [-r n] [--ignore-externals] [--username u] <ruta>@` |
| `CommitRequest` | `commit -F <archivo> --encoding UTF-8 [--username u] <ruta>@` |
| `CleanupRequest` | `cleanup <ruta>@` |

- `peg_safe` agrega `@` a cada ruta para que un `@` dentro del nombre no se lea como revisión pegada.
- `is_safe_checkout_url` solo admite los esquemas `http`, `https`, `svn`, `svn+ssh` y `file`, y rechaza contraseñas incrustadas (`usuario:clave@`), un host que empiece por `-`, `file://` con un servidor distinto de vacío o `localhost` (UNC), espacios, caracteres de control, `\`, `?`, `#` y una revisión pegada final (`@12`, `@HEAD`). `is_marketplace_url` agrega la exclusión de `svn+ssh` (Fase 3).
- `RemoteInfoRequest` (`info --xml [--username u] <url>@`) consulta una URL sin copia de trabajo; `RunOptions.no_auth_cache` agrega `--no-auth-cache` justo antes de `--non-interactive`, que sigue siendo el último argumento.
- El mensaje de commit va en un archivo temporal `dakedaduck-commit-<pid>-<n>.txt` en el directorio temporal, con finales de línea normalizados a LF (svn rechaza finales mezclados, E135000), y se borra al soltar `MessageFile`. Si la aplicación muere a mitad de un commit el archivo queda (**T-6**).
- Los nombres de subcomando y las banderas son constantes (`INFO_SUBCOMMAND`, `XML_FLAG`, ...); no se concatena texto del usuario a un argumento.

## Parsers

`parse_info` y `parse_status` (`svn/parsers.rs`) usan `quick-xml` sobre la salida `--xml`.

- `InfoEntry`: ruta, tipo, revisión, URL, URL relativa, raíz y UUID del repositorio, raíz de la copia (`wcroot-abspath`) y último cambio. Una salida sin entradas es `ParseError::MissingEntry`.
- `StatusReport`: `entries` y `against_revision` (solo con `--show-updates`). Cada `StatusEntry` trae `item`, `props`, `revision`, `remote_item`, `remote_props`, `wc_locked`, `tree_conflicted`, `copied`, `switched` y `lock` (el local o, si no hay, el remoto).
- `StatusItem` cubre `normal`, `unversioned`, `added`, `modified`, `deleted`, `missing`, `replaced`, `conflicted`, `ignored`, `incomplete`, `external`, `obstructed`, `merged`, `none` y `Unknown(texto)` para valores nuevos.
- Los parsers se prueban con XML real guardado en `src-tauri/tests/fixtures/` (`info.xml`, `status.xml`, `status-remote.xml`, `status-states.xml`, `status-tree-conflict-remote-lock.xml`, `status-wc-locked.xml`) desde `tests/svn_read.rs`.

## Errores tipados

`SvnError` conserva `codes`, `kind`, `command` (redactado), `stdout`, `stderr`, `exit_code` y `timestamp` para el log técnico (Core Tenet 9). `SvnErrorKind::from_codes` toma el primer código reconocido de la cadena:

| Código | `SvnErrorKind` |
|---|---|
| `E170001` con «Authorization failed» | `PermissionDenied` (no pide credenciales) |
| `E170001` (otro mensaje), `E215004`, `E215001` | `AuthRequired` |
| `E230001` | `UntrustedCertificate` |
| `E730061`, `E731001`, `E175012` | `Network` |
| `W160013`, `E200009`, `E160013`, `E210005`, `E180001`, `E160006` | `NotFound` |
| `E120171` | `ClientCertificate` |
| código de salida NTSTATUS de error (`0xC0000000`+) | `Crashed` (tiene prioridad; `svn list` se cae con nombres que contienen `:`) |
| `E155036` | `WorkingCopyTooOld` |
| `E155004` | `WorkingCopyLocked` |
| (sin código) | `Cancelled`, `TimedOut`; cualquier otro, `Other` |

`CommandError` (`app/error.rs`) es lo que llega al frontend: `kind` en `snake_case`, `message` en español, `codes` y `detail` (hasta 2000 caracteres de `stderr`). Los `kind` de archivos y rutas (`forbidden_path`, `cloud_only`, `file_changed`, `working_copy_busy`, ...) comparten el mismo tipo. El certificado no confiable y la copia antigua no se resuelven desde la aplicación: el mensaje indica aceptar el certificado o ejecutar `svn upgrade` con otro cliente ([ADR 0004](adr/0004-errores-svn-tls-wc-antigua-encoding.md)).

## `wc_status_map`

Comando que alimenta los distintivos del explorador (`src-tauri/src/app/wc_status.rs`). Convive con `wc_status` (informe completo de la Fase 1, que la UI de ese panel sigue pidiendo con `remote=false`).

- Una sola ejecución recursiva de `svn status --xml --no-ignore` por copia (más `--show-updates` si `remote`). Nunca se ejecuta por evento de ratón.
- **Solo lo que no es normal**: se descartan las entradas sin cambio local, sin cambio remoto y sin marcas (`wc_locked`, `tree_conflicted`, `copied`, `switched`, `lock`). Las rutas salen relativas al Workspace Root.
- Orden: primero conflictos, faltantes, obstruidos, propiedades en conflicto, conflictos de árbol y copias bloqueadas; luego cambios; al final los ignorados.
- `changed_folders`: ancestros (dentro de la copia) de toda entrada no ignorada, calculados **antes** de truncar.
- Tope `MAX_STATUS_ENTRIES` (20 000) con `truncated: true`.
- **Caché** (`StatusCache`): clave `(copia en minúsculas, remote)`. Solo se lee cuando la petición no es remota ni lleva `refresh`; el resultado siempre se guarda. Cada `lookup` que falla devuelve la **generación**; `store` descarta el resultado si la generación cambió mientras se ejecutaba `svn` (una respuesta atrasada no pisa una invalidación).
- **Invalidación** (`invalidate`): sube la generación y borra las entradas de rutas anidadas con la copia. Se dispara al terminar update, commit, cleanup y checkout (`spawn_operation`) y tras cada `write_text` exitoso.
- **Credenciales**: `username` como `--username` y la contraseña por stdin (`StatusMapArgs`); la contraseña nunca se guarda. Con `password` sin `username` el command falla antes de lanzar `svn`.
- No toma el candado de la copia: consultar estado no hace cola detrás de un update.

Pruebas: `tests/wc_status.rs` y `tests/svn_read.rs`.

## Operaciones largas

`Operations` (`app/operations.rs`) ejecuta checkout, update, commit y cleanup sobre `ScopedPath`. `OperationManager` reparte los ids, guarda la señal de cancelación de cada operación, un `Mutex` de tokio **por copia de trabajo** (clave: ruta en minúsculas) y la marca de cleanup.

- La operación espera su turno con `acquire`; si se cancela mientras está en cola termina como `Cancelled` sin lanzar `svn`. Tras tomar el candado revalida el destino ([workspace](workspace.md)).
- `try_lock_for_write` toma sin esperar los candados de todas las rutas anidadas con la copia; lo usa el guardado de texto y devuelve `WorkingCopyBusy` si hay una operación en curso.
- Una operación cancelada o vencida marca la copia con «necesita cleanup» (`wc_needs_cleanup`); la marca vive solo en memoria y un cleanup exitoso la limpia (**T-13**). Operar sobre una subcarpeta no se serializa contra la raíz (**T-7**).
- Eventos hacia la interfaz: `svn://progress` (`ProgressEvent` sacado de las líneas de `stdout`) y `svn://done` (`OperationResult` con la revisión o el `CommandError`). Tras checkout y update la revisión se consulta con `svn info` (**T-4**); en commit sale de la salida.

Pruebas: `tests/svn_operations.rs` contra un repositorio real.

## Credenciales

Decisión del usuario ([ADR 0003](adr/0003-credenciales-por-ui-y-stdin.md)): como todo corre con `--non-interactive`, cuando falta autenticación la interfaz pide usuario y contraseña (`CredentialsModal`) y reintenta. La aplicación no guarda la contraseña ni la pasa en argumentos; no usa `--no-auth-cache`, así que la credencial puede quedar en el auth cache de Subversion según su configuración. Detalle de seguridad en [seguridad](security.md).

## Certificados y opciones de red (Fase 3, Increment 4)

`RunOptions.network` (`svn/network.rs`, reexportado por `runner.rs`) agrega, **antes** de `--password-from-stdin`, `--no-auth-cache` y `--non-interactive` (que sigue siendo lo último): `--config-dir <dir>` (ruta de Windows; con rutas POSIX svn la ignora), un `--config-option archivo:sección:clave=valor` por opción (el valor se parte solo en el primer `=`) y `--trust-server-cert-failures=a,b` con los motivos ordenados y sin repetir (`unknown-ca`, `cn-mismatch`, `expired`, `not-yet-valid`, `other`), que exige `--non-interactive`. Ninguna lleva secretos. `svn::error::untrusted_reasons(stderr)` lee los motivos de `E230001`.

Almacén propio (`app/marketplace/certs.rs`): `<carpeta de config>/certs/<sha256>.pem` más `MarketplaceConfig.trusted` en `config.json`. `CertService::network_for(url)` (solo `https`; bloqueante, se invoca en `spawn_blocking`) une como `servers:global:ssl-authority-files` todas las autoridades importadas y los certificados autofirmados anclados a ese `host:puerto`. Un anclado cuyo emisor difiere del sujeto no sirve de ancla en OpenSSL: se guarda con `unknown-ca` entre sus motivos y, antes de cada operación, `network_for` sondea el servidor y solo si la huella presentada es la guardada agrega `--trust-server-cert-failures` con sus motivos (si cambió o la sonda falla no concede nada). Los motivos de los anclados autofirmados también se agregan como `--trust-server-cert-failures`. «Probar conexión» lo aplica; la interfaz llama a `marketplace_cert_inspect` (sonda Schannel más un `svn info` sin confianza adicional para leer los motivos), `marketplace_cert_trust`, `marketplace_cert_import`, `marketplace_cert_list` y `marketplace_cert_revoke`. Detalle y límites en el [ADR 0014](adr/0014-marketplace-sobre-svn-list-info-export-e-indice-de-copias.md). Pruebas: `tests/marketplace_certs.rs` (servidores `openssl s_server` reales) y `tests/marketplace_trust_rules.rs`.

### Certificado de cliente (PKCS#12)

`RepoEntry.client_cert` guarda solo la ruta absoluta del `.p12`/`.pfx`; la frase llega por operación (`RepoTestArgs.client_cert_passphrase`) y no se guarda en ningún estado. Con un `https` y un certificado de cliente, `app/marketplace/client_cert.rs` crea un `TempConfig` (`svn/temp_config.rs`): `%TEMP%\dakedaduck-svnconf-<pid>-<n>` con copia del `config` del usuario, su `servers` más una sección `[global]` con `ssl-client-cert-file`, `ssl-client-cert-password` y `ssl-authority-files`, y una unión de directorio `auth` hacia `%APPDATA%\Subversion\auth` (creada con `cmd.exe /C mklink /J`). `NetworkOptions.config_dir` apunta a ese directorio; la frase nunca va en `argv`. `Drop` quita la unión sin seguirla, sobrescribe `servers` con ceros y borra el directorio; al arrancar un hilo purga los restos de más de 2 h sin seguir uniones. Pruebas: `tests/marketplace_client_cert.rs`.

## `svn.exe` empaquetado y CVE-2024-45720 (Increment 10)

El instalador lleva **SlikSVN 1.14.5** ([ADR 0012](adr/0012-svn-exe-como-recurso-del-instalador.md)) en la carpeta `svn` de los recursos: `svn.exe`, 19 DLL de SlikSVN (OpenSSL 3, Berkeley DB 4.4, APR, SASL, gettext y las `libsvn_*`) y `vcruntime140.dll`, `vcruntime140_1.dll` y `msvcp140.dll` del redistribuible de Visual C++ (14.51.36247.0), más los textos de licencia en `svn/licenses`. Se prepara con `scripts/bundle-svn.ps1` (descarga el zip fijado en `third_party/svn.lock.json`, comprueba su SHA-256, extrae el MSI con `msiexec /a`, copia solo esos 23 archivos y, con `-WriteManifest`, escribe `third_party/svn.manifest.json`); el contenido de `src-tauri/resources/svn` no se commitea, el manifiesto con el hash de cada archivo sí.

**Orden del localizador** (`locate_full`, `src-tauri/src/svn/locator.rs`): 1) el `svn_path` de `config.json`; 2) el svn incluido; 3) `PATH` y las carpetas conocidas de `ProgramFiles`. Si el `svn_path` falla se sigue con los demás (`detect_svn`). El svn incluido solo se usa si `svn/bundled.rs::verify` comprueba, contra el manifiesto embebido con `include_str!`, que **cada** archivo existe, tiene el tamaño y el SHA-256 esperados y que la carpeta no contiene ningún archivo que el manifiesto no liste (una DLL de más es un riesgo de carga lateral); las subcarpetas (`licenses`) se ignoran. Si falla, se ignora con el motivo (`SvnDetection.warning`) y, si no hay otro `svn.exe`, el error es `BundleDamaged`. Esto es una **comprobación de integridad** (instalación corrupta o incompleta), no una defensa frente a otro proceso del mismo usuario, que puede escribir en la carpeta de instalación.

`AppState::with_bundled_svn(resource_dir)` recibe la carpeta desde `lib.rs` (`app.path().resource_dir()`), y `setup` lanza `warm_svn` en segundo plano para que la primera detección no bloquee un comando (paga **T-5**). En desarrollo, `tauri build`/`tauri dev` dejan los recursos junto al ejecutable (`target/<perfil>/svn`).

**Aviso por versión.** Un `svn` anterior a 1.14.4 (`RECOMMENDED_VERSION`) se acepta (la mínima sigue siendo 1.10, decisión del usuario) pero `SvnDetection.warning` lleva un aviso persistente con el motivo (CVE-2024-45720: inyección de argumentos por la conversión «best fit» de Windows) y la versión; lo muestran el onboarding, el panel de información y «Acerca de». `SvnDetection.binary.origin` es `configured`, `bundled` o `system`.

Pruebas: `src-tauri/tests/svn_bundled.rs` (20), contrato en `contract.rs`/`contract.test.ts`, `AboutDialog.test.ts` y `installed.e2e.ts` (instalación en un perfil aislado sin Subversion).
