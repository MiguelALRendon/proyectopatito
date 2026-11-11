---
status: proposed
date: 2026-10-23
deciders: [usuario]
---

# 0014. Marketplace sobre `svn list`, `svn info`, `svn export` y un índice de copias de trabajo

## Context and Problem Statement

La Fase 3 necesita explorar repositorios remotos, mostrar si lo remoto ya existe localmente y descargarlo. SVN no tiene un catálogo de repositorios ni un modo de traer un archivo suelto como working copy; hay que decidir de dónde sale cada dato y cómo se relaciona lo remoto con lo local sin duplicar el motor (Core Tenet 1).

## Considered Options

- Extender `SvnClient` (`list`, `info` remoto, `proplist`, `export`), reutilizar `checkout`, `OperationManager` y `config.json`, e indexar en memoria las copias del Workspace Root.
- Servicio propio con SQLite para caché remota, descargas y correspondencia.
- Registrar solo lo que la aplicación descargó, sin escanear el workspace.

## Decision Outcome

Elegida la primera, decisión del usuario del 2026-10-23: el registro de repositorios vive en `config.json`; el listado y la info salen de `svn list --xml`, `svn info --xml` y `svn proplist -v --xml`; el archivo suelto se baja solo con `svn export` (copia limpia) y lo rastreable se descarga como carpeta con `svn checkout`; la correspondencia local/remota usa UUID y URL de un índice de copias reconstruido al abrir la sección y tras cada descarga; las credenciales las guarda el auth cache de `svn.exe` y la aplicación no persiste contraseñas (ADR 0003).

### Consequences

- Positiva: casi todo el código reutilizado; sin dependencias nuevas; el estado sale de SVN.
- Negativa: el índice recorre el workspace (acotado por profundidad y cantidad) y la caché de listados es solo de memoria, así que no hay modo sin conexión.
- Neutral: si M1 (`plans/fase-3-marketplace/medidas.md`) muestra que el auth cache no persiste en modo no interactivo, la interfaz pedirá la contraseña en cada operación remota; este ADR se actualiza con el resultado y pasa a `accepted` al cerrar la fase.

### Certificados

Decisión del usuario del 2026-10-23 (medidas M5 y M6): un https interno con certificado propio debe poder conectarse, con consentimiento explícito.

- **Qué se lee.** `svn` en modo no interactivo solo dice `E230001` con los motivos («issuer is not trusted», «certificate issued for a different hostname», «certificate has expired»); no entrega emisor, huella ni vigencia. Una sonda de solo lectura (`app/marketplace/tls_probe.rs`) hace el apretón de manos TLS con Schannel por `windows-sys` (features `Win32_Security_Authentication_Identity`, `Win32_Security_Credentials`, `Win32_Security_Cryptography` y `Win32_Foundation`; ninguna crate nueva), sin validar el certificado, lo copia (DER), calcula su SHA-256 con `sha2` y cierra sin enviar datos de aplicación ni credenciales. El `unsafe` vive solo en ese módulo, en funciones con sufijo `_unsafe`, con tipos que liberan en `Drop` (credenciales, contexto de seguridad, contexto de certificado).
- **Dónde se guarda.** En la carpeta de configuración de la aplicación, hermana de `config.json`: `certs/<sha256>.pem` (DER a PEM con base64 propio de 64 columnas) y la entrada `TrustedCert` en `config.json` (huella, sujeto, emisor, vigencia, tipo `pinned` o `authority`, alcance `host:puerto`, motivos concedidos y fecha). Tope `MAX_TRUSTED` de 200; una lista incoherente se trata como el resto del registro (copia `config.json.marketplace.bad` y se carga vacía).
- **Anclaje exacto.** «Confiar» vuelve a sondear el servidor y solo guarda si la huella coincide con la que el usuario vio (anti-TOCTOU). La confianza se concede a un `host:puerto` y a esa huella y un certificado distinto en el mismo `host:puerto` vuelve a ser `UntrustedCertificate`. Hay dos clases:
  - *Autofirmado* (emisor igual al sujeto): es ancla. Se pasa a `svn` como `--config-option servers:global:ssl-authority-files=<pem;pem>` (rutas con barras normales, solo los archivos que existen) y no lleva `unknown-ca`.
  - *No autofirmado* (hoja firmada por una autoridad ausente): OpenSSL no la acepta como ancla, así que no va en `ssl-authority-files`. Se guarda con `allowed` que incluye `unknown-ca` y, antes de cada operación, `CertService::network_for` (bloqueante; se ejecuta en `spawn_blocking`, acotado por los plazos de la sonda) sondea el `host:puerto` y solo si la huella presentada es la guardada agrega `--trust-server-cert-failures` con sus motivos, `unknown-ca` incluido. Si la huella cambió o la sonda falla no concede nada: `svn` responde `UntrustedCertificate` y la interfaz vuelve a preguntar.
  - Nombre distinto, vencido, aún no válido u «otro» se conceden por motivos, solo para ese alcance, con `--trust-server-cert-failures=…` en esa invocación. `unknown-ca` por bandera solo existe en la clase no autofirmada y bajo la pre-comprobación; la validación de `config.json` rechaza `unknown-ca` en las autoridades y en los autofirmados. Si falta algún motivo, `svn` informa todos los fallos del certificado (no solo los no cubiertos), y no concede nada.
- **Autoridad de la empresa.** «Importar autoridad» acepta `.crt`, `.pem`, `.cer` o `.der` de hasta 64 KiB, con un solo bloque `CERTIFICATE` o un DER exacto, validado como X.509 con `CertCreateCertificateContext`, y vale para todos los repositorios.
- **Certificado de cliente (PKCS#12).** Se asocia por repositorio (`RepoEntry.client_cert`: ruta absoluta de Windows, `.p12` o `.pfx`, hasta 1024 caracteres, sin caracteres de control; la existencia del archivo se comprueba al usarlo). La frase de paso se pide por operación (`RepoTestArgs.client_cert_passphrase`), nunca se guarda en `config.json`, en `SessionCredentials` ni en otro estado, y no viaja en `argv` (`--config-option` la dejaría visible a otros procesos del usuario). En su lugar, por operación `svn/temp_config.rs` crea `%TEMP%\dakedaduck-svnconf-<pid>-<n>` (nuevo, nunca reutilizado) con copia del `config` del usuario, su `servers` más una sección `[global]` adicional (`ssl-client-cert-file`, `ssl-client-cert-password`, `ssl-authority-files`; svn fusiona secciones repetidas y la última clave gana, verificado) y una unión de directorio `auth` hacia el `auth` real de `%APPDATA%\Subversion` para que el caché de credenciales siga siendo el de `svn.exe`. `NetworkOptions.config_dir` lleva una ruta de Windows. Un objeto RAII lo borra siempre (éxito, error o cancelación): quita la unión sin seguirla, sobrescribe `servers` con ceros y elimina el directorio. Al arrancar un hilo purga los restos de más de 2 h sin seguir uniones. El directorio de usuario de Subversion y el temporal son inyectables (`ConfigArea`) para las pruebas.
- **Límites.** (1) Una hoja firmada por una autoridad no importada no puede ser ancla (OpenSSL no la acepta, medido), por eso se concede con la pre-comprobación descrita arriba; entre la pre-comprobación y la conexión de `svn` hay una ventana TOCTOU declarada: un servidor que alternara certificados entre ambas podría hacer que `svn` vea otro certificado bajo la concesión de la huella guardada (acotada a ese `host:puerto` y a un atacante con control del servidor o de la red). Importar la autoridad elimina la ventana. (2) Las banderas por motivo se aplican a lo que svn vea en ese `host:puerto` y cuya cadena ya sea confiable (excepto `unknown-ca` de los no autofirmados, que sí cubre la cadena, bajo la pre-comprobación). (3) Una ruta de configuración con `;` no se puede pasar a `ssl-authority-files` (el separador no se escapa): la operación falla con un error visible y no confía a ciegas. (4) `ssl-authority-files` aborta con `OPENSSL_Uplink: no OPENSSL_Applink` en el SlikSVN 1.14.2 del sistema; con el 1.14.5 incluido funciona. (5) Las pruebas usan `openssl s_server`: el apretón de manos TLS es real, pero la respuesta HTTP de mod_dav_svn no se emula. (6) La frase del certificado de cliente no puede llevar caracteres de control (se rechaza antes de escribir la configuración temporal; espacios en los extremos, `%(`, `#`, `;` y acentos se probaron y funcionan); el directorio temporal hereda los permisos del `%TEMP%` del usuario (no se fija una ACL propia) y la frase existe en disco, en claro, solo mientras dura la operación. (7) `mklink` se invoca con `cmd.exe` y las rutas entre comillas; se rechazan rutas con `%` o `"`.

## More Information

`plans/fase-3-marketplace/design.md`, `spec.md` y `plan.md`; ADR 0001, 0003 y 0005; `propuesta.md` §21-32.
