# Plan — Fase 3: Marketplace

> Producto de `/bossdream-plan`. Referencia: `spec.md` (QUE) y `design.md` (COMO). Primera de las cuatro fases diferidas del roadmap (3 a 6); las Fases 1, 2A y 2B están aceptadas y este plan se apoya en su código real, leído para escribirlo. **v2:** incorpora la revisión adversarial, el auditor de completitud, el explorador de skills y la decisión del usuario sobre certificados SSL, `svn+ssh`, auth cache y externals.

## Razon de ser
Que el usuario pueda guardar los repositorios que usa (incluidos servidores https con certificado interno), navegarlos sin descargar nada, ver qué es cada elemento y si ya lo tiene, y traerlo (como working copy o como copia limpia) con un panel de descargas. Hoy solo existe el `checkout` por URL escrita a mano en el panel de proyecto y la sección Marketplace está deshabilitada.

## Justificacion
Core Tenet 1 («la aplicación es el cliente, Subversion es el motor», `CLAUDE.md`): todo es `svn list`, `info`, `proplist`, `propget`, `export` y `checkout`. Reglas duras: todo destino por `Workspace::resolve`, nunca `tauri-plugin-shell` hacia el frontend (ADR-0001), solo Rust lanza `svn.exe`. Credenciales por la interfaz y `stdin`, sin guardarlas (ADR-0003). Decisiones y descartes en `design.md` §0, §1 y §8.

## Flujo (que / por que)
Medir primero lo incierto (auth cache, salida XML real, certificados, revisión de carpeta, rutas largas) → registro de repositorios y errores clasificados en Rust → su interfaz y el cambio de sección → certificados SSL (sin ellos no se navega un https interno) → listado e info remotos → navegador y detalle → índice y estado local → descarga en Rust → administrador de descargas → diálogo de descarga → documentación → QA. El Rust va antes que la interfaz que lo consume, y el administrador de descargas antes del diálogo que lanza descargas, para poder cancelar y ver progreso desde el primer día.

## Clasificacion
tipo: add-to-flow (reutiliza `checkout`, `OperationManager`, `config.json`, `wc_status_map`, `CredentialsModal`, `AppShell`, `runOperation`) y new (registro, errores de red y certificado, listado remoto, índice, `export`, descargas) · complejidad: large

## Investigacion (research-log)
| Pregunta | Tool/agente | Hallazgo | Como informo el plan |
|---|---|---|---|
| ¿Qué existe ya para descargar? | Lectura de `src-tauri/src/svn/commands.rs:84-105,182-193`, `app/operations.rs:187-205`, `app/state.rs:344-366`, `app/args.rs:6-16` | `CheckoutRequest` ya tiene revisión, `Depth` e `ignore_externals`; `start_checkout` pasa por `scoped(&args.dest, false)` → `Workspace::resolve(.., allow_overwrite=false)` | I8 reutiliza `Operations::checkout`; ver fila siguiente |
| ¿`checkout` acepta una carpeta vacía? | Revisión adversarial sobre `workspace.rs:76` y `tests/app_state.rs:569-578` | **No**: `resolve(.., false)` devuelve `DestinationExists` también para una carpeta vacía (hay una prueba que lo exige) | Se corrigió la spec: el destino debe **no existir** (CA-8); la interfaz elige carpeta del árbol del workspace + nombre nuevo, como `CheckoutForm.vue` |
| ¿Qué clases de error tiene hoy `svn`? | Revisión adversarial sobre `svn/error.rs:22-31`, `app/error.rs:18-50,198-223` | Solo `AuthRequired`, `UntrustedCertificate`, `WorkingCopyTooOld`, `WorkingCopyLocked`, `Cancelled`, `TimedOut`, `Other`; **no hay red ni no-encontrado** | I2 agrega `Network` y `NotFound` (supuesto — verificar los códigos con M2: red `E170013`, `E731001`, `E731004`, `E730061`; no encontrado `E170000`, `E160013`) y los lleva al contrato |
| ¿Qué pasa con una descarga cancelada o fallida? | Auditor de completitud ([svnbook checkout](https://svnbook.red-bean.com/en/1.7/svn.ref.svn.c.checkout.html), 2026-10-23) y `operations.rs:289-293`, `runner.rs:136-138` | `kill()` deja la copia a medias, que responde a `svn info`; el reintento chocaría con `DestinationExists` y el índice la vería «descargada» | I8: Rust borra el destino que creó al cancelar, fallar o vencer el plazo; `LocalState::Incomplete` para lo que SVN marque incompleto |
| ¿Cómo se clasifica un external «de otro servidor»? | Auditor de completitud ([svnbook externals](https://svnbook.red-bean.com/en/1.7/svn.advanced.externals.html), 2026-10-23) | Formas `../`, `^/`, `//`, `/`, `^/../REPO`, absolutas, con `-rN` y `@peg`, y externals de archivo; las credenciales de la línea de comandos viajan a todo el checkout | I8: parser de externals con matriz de pruebas; decisión del usuario: con credencial se bloquea «Incluir externals» |
| ¿Y los certificados? | Auditor de completitud ([release notes 1.9](https://subversion.apache.org/docs/release-notes/1.9.html), [svnbook httpd](https://svnbook.red-bean.com/en/1.7/svn.serverconfig.httpd.html), 2026-10-23); `svn help -v` local | `--trust-server-cert-failures` solo con `--non-interactive`; aceptar «permanentemente» es un diálogo interactivo que la app no puede mostrar; los certificados de cliente son PKCS#12 con `ssl-client-cert-file`. No está citado qué imprime `--non-interactive` ante un certificado no confiable | I1 (M5, M6) lo mide con `openssl s_server`; I4 lo implementa; decisión del usuario: hay que soportar todos los tipos |
| ¿`svn+ssh`? | Auditor de completitud ([svnbook svnserve](https://svnbook.red-bean.com/en/1.7/svn.serverconfig.svnserve.html), 2026-10-23) | La autenticación la hace un programa `ssh` externo que SlikSVN no trae; T-1 ya admite cuelgues | Decisión del usuario: fuera del Marketplace (CA-1) |
| ¿Dónde se guardan las credenciales? | `docs/adr/0003-…md`; auditor de completitud ([svnbook netmodel](https://svnbook.red-bean.com/en/1.7/svn.serverconfig.netmodel.html), 2026-10-23) | `svn.exe` cachea por defecto en `%APPDATA%\Subversion\auth` (cifrado en Windows), compartido con otros clientes; `--password-from-stdin` y su camino de caché no están medidos | I1 (M1) mide `svn://`; http(s) queda declarado como no medido; I3 muestra el aviso y la casilla «No recordar» |
| ¿Cómo se persiste `config.json` sin pisar la interfaz? | Revisión adversarial sobre `state.rs:173-183`, `config/mod.rs:38-90` | El `Mutex<AppConfig>` serializa de verdad (clona, cambia, guarda y asigna bajo candado); `lenient` convierte un `marketplace` corrupto en vacío y el siguiente guardado de `ui` lo borraría | I2 usa el mismo patrón y copia de seguridad si el registro no parsea; `update` se ejecuta en `spawn_blocking` |
| ¿Cómo escuchan los eventos las operaciones? | Revisión adversarial sobre `services/tauri.ts:294-298` | `project.ts` no escucha eventos: usa `runOperation`, que filtra por `OperationId`; los ids empiezan en 0 | I9: `downloads.ts` usa `runOperation`; sin comprobaciones del tipo `if (id)`. Riesgo cross-flow cerrado |
| ¿Cómo es hoy la sección Marketplace? | `AppShell.vue:28-49`, `AppShell.test.ts:17-45`, `App.vue:42-47`, `tests/e2e/real-app/shell.e2e.ts:207-213` | Es un `<button aria-disabled>` con un aviso; hay una E2E y una fila de `docs/security.md` que lo afirman; cambiar de sección con `v-if` desmontaría `TabContent` (Monaco, PDF, Office; T-40) | I3 usa `v-show`/`KeepAlive` y reescribe las pruebas y la E2E |
| ¿Cómo se cierra la ventana con trabajo en curso? | Revisión adversarial sobre `composables/useWindowClose.ts:14-17`, `app/closing.rs:4` | El punto de enganche es `registerCloseGuard`, con `HOLD_KEEPALIVE_TIMEOUT` de 6 s; `kill_on_drop` no corre al salir el proceso | I9: un `CloseGuard` cancela y espera el `svn://done` de cada descarga |
| ¿Cómo se registra un command nuevo? | `src-tauri/tests/commands_registry.rs:1-40`, `lib.rs`, `src/services/tauri.ts` | Se declara, se registra en `lib.rs`, se compara en `commands_registry.rs` y se envuelve en `services/tauri.ts`; contrato en `tests/contract.rs:38`, `contract.json`, `contract.test.ts` | Cada increment de Rust lo hace en el mismo paso |
| ¿Dónde está el filtro de `.svn` y qué excluye `Workspace`? | Revisión adversarial | El filtro de `.svn` vive en `files/mod.rs:43,349-355`; `workspace.rs` no excluye nada; `archive/safety.rs:7` conoce `_svn` | I7 reutiliza el filtro y reconoce `_svn` |
| ¿Hay servidores para probar? | Bash sobre `.tools/apache-subversion`, `C:\Program Files\Git\usr\bin\openssl.exe` | Existen `svnadmin`, `svnserve` y `openssl.exe`; no hay dependencia de TLS en `Cargo.toml` | Autenticación con `svnserve`; TLS con `openssl s_server` (autorización del usuario en `CLAUDE.md`: entorno SVN libre) |
| ¿Skills aplicables? | `bossdream-document-explorer` (un despacho con los 10 increments de la v1) | Aplican `test-gen`, `flow-test-gen`, `theme-first`, `docs-rewrite`, `adr-new`, `tech-debt`, `qa-increment`, `qa-run`, `test-checks`; `docs-rewrite` no cubre `plans/` | `Conexiones` por increment; los candidatos sin skill (cableado de commands, teclado y foco, fixtures) son falsos positivos de un solo uso; el teclado reutiliza `src/utils/listFocus.ts`, que ya existe |

## Impacto cross-flow
| Flujo afectado | Verificado con | ¿Choca? | Mitigacion |
|---|---|---|---|
| `AppShell`, `AppShell.test.ts`, `shell.e2e.ts:207-213` y `docs/security.md` (Marketplace deshabilitado) | lecturas | Sí | I3 las reescribe a la vez que el componente |
| `App.vue` y `useTabsSession` | `App.vue:15-47` | Sí: cambiar de sección no puede desmontar `TabContent` | I3: `v-show`/`KeepAlive` + E2E de texto sin guardar |
| `AppConfig` / `config.json` | `state.rs:173-183`, `config/mod.rs:38-90` | Sí: dos escritores | I2: mismo `Mutex<AppConfig>`; prueba de concurrencia con `ui_state_set` |
| `is_safe_checkout_url` (lo usan `start_checkout` y el panel de proyecto) | `svn/commands.rs:182-193`, `state.rs:349` | Sí: endurecerla cambia el `checkout` de la Fase 1 | I2 la endurece con pruebas y corre `ProjectPanel.test.ts` y `tests/app_state.rs` |
| `SvnErrorKind` / `CommandErrorKind` / contrato | `svn/error.rs:22-31`, `app/error.rs`, `tests/contract.rs:38`, `contract.test.ts` | Sí: tipo compartido Rust/TS | I2 y I4 actualizan el contrato en el mismo paso |
| `InfoEntry` (nuevo campo `lock`) | `models.rs:92-105` | Sí | I5 lo agrega como opcional y actualiza el contrato |
| `RunOptions` / `SvnRunner` (opciones de red) | `runner.rs:100` | Sí: argumentos nuevos tras `--non-interactive` | I2 e I4 los agregan con pruebas de orden de argv y de que ningún secreto llega a `argv` |
| `ProgressEvent` y `relay` | `progress.rs:56-65`, `operations.rs:346` | Sí: hoy reenvía líneas de `stdout` sin límite | I9: limitador de eventos y tope de largo |
| `StatusCache` / `wc_status_map` | `wc_status.rs:15,179-180,198-205` | Sí: trunca a 20 000 y corre con ignorados | I7 lo consume sin ignorados y trata el truncado como `Unknown` |
| `OperationManager` (candado por ruta, T-7) | `operations.rs:113-125` | Sí | I8: `try_lock_for_write` (+ `are_nested`) sin tomar dos veces el mismo candado; prueba de ancestro y descendiente |
| Cierre de ventana (ADR 0009) | `useWindowClose.ts:14-17`, `closing.rs:4` | Sí | I9 |
| `tests/common/mod.rs` (`SVNSERVE_CONF`) | `tests/common/mod.rs:106-128` | Sí: no tiene `authz-db` | I2 lo extiende para «permisos denegados» |
| CSP y protocolo `workspace-file` | `docs/security.md` | No: el Marketplace solo usa IPC | I6 prueba que no hay peticiones de red del WebView |

## Deuda tecnica (informativa, NO bloqueante)
| Ubicacion | Deuda | Impacto | Remediacion | Esfuerzo | ¿Se paga en este plan? |
|---|---|---|---|---|---|
| `src-tauri/src/app/state.rs` (702 líneas) | T-3 y T-19: `AppState` mezcla responsabilidades | Alto: este plan agrega servicio | Lógica en `app/marketplace/`; `AppState` solo delega con métodos finos (`ConfigHandle` es privado: el registro se pasa por funciones puras) | low | Parcial |
| `operations.rs` T-7 | Subcarpeta no se serializa contra la raíz | Medio | I8 rechaza ancestro y descendiente con `are_nested` | low | Parcial (I8) |
| `src/stores/project.ts` T-8 y T-25 | Store mezcla responsabilidades; dos caminos de estado | Medio | `downloads.ts` reutiliza `runOperation` y no toca `project.ts` | medium | No |
| `runner.rs` T-1 | Hijo que hereda los pipes cuelga | Medio | `svn+ssh` queda fuera del Marketplace | medium | No (se evita) |
| `src/documents/windowClose.ts` T-24 | Cierre orquestado en documentos | Bajo | I9 usa `registerCloseGuard`, no `windowClose.ts` | low | No |
| `files/mod.rs` T-15 | Ventana entre validar y abrir una ruta | Medio | El borrado de limpieza (I8) vuelve a validar y no sigue enlaces | medium | Parcial |

## Decisiones (opcion elegida vs descartadas)
Ver `design.md` §0 y §8. Resumen: extender `SvnClient` y reutilizar `Operations::checkout` y `OperationManager` (descartado: servicio propio con SQLite); `svn.exe` guarda su auth cache y la app no persiste contraseñas, con aviso y «No recordar» (descartados: Credential Manager, pedir siempre, botón «Olvidar»); archivo suelto solo con `export` (descartado: working copy parcial por archivo); índice de copias del workspace (descartados: registro de descargas propias, escaneo por elemento); destino inexistente con limpieza al fallar (descartados: aceptar carpeta vacía, reanudar); URL construida una sola vez en Rust (descartado: URL del frontend); certificados con consentimiento explícito, almacén propio e importación de autoridad (descartados: `--trust-server-cert` global, dejar https interno fuera). ADR: `docs/adr/0014-marketplace-sobre-svn-list-info-export-e-indice-de-copias.md` (propuesto; se amplía con certificados en el I4).

## Increments

### Increment 1: Medir SVN antes de construir — cubre spec [CA-2, CA-3, CA-4]
- Justificacion / fuentes: el ADR 0003 deja sin verificar el auth cache en modo no interactivo; no está citado qué hace `--non-interactive` ante un certificado no confiable ni cómo darle a `svn` la frase de paso de un certificado de cliente; la regla de investigación (§130) pide comprobar con `svn.exe` y fijar en una prueba antes de implementar.
- Pasos:
  - [x] 1.1 Crear `plans/fase-3-marketplace/medidas.md` con una sección por medición (pregunta, método, salida literal saneada, veredicto, consecuencia) — fuente: `plans/fase-2b-documentos/spikes.md`; porque: evidencia y consecuencias.
  - [x] 1.2 **M1, auth cache (`svn://`)**: con `svnserve` y `password-db` (patrón `tests/common/mod.rs:106-128`), `svn list` con `--username u --password-from-stdin --non-interactive` y luego **sin** credenciales, con `--config-dir` aislado y con el predeterminado, variando `store-passwords` y `store-plaintext-passwords`, y con `--no-auth-cache`; registrar dónde queda la credencial. **Declarar que http(s) no se mide** (no hay mod_dav_svn). Supuesto — verificar.
  - [x] 1.3 **M2, salida real y códigos de error**: contra un repositorio `svnadmin` + `file:///` con nombres con espacios, acentos, `%`, `#`, `@`, emoji, carpeta vacía, archivo bloqueado, propiedades (`svn:mime-type`, `svn:externals` con cada forma de external) y externals hacia otro repositorio: salida literal de `list --xml`, `info --xml` (archivo y carpeta, con y sin `<lock>`), `proplist -v --xml`, `propget svn:externals` y `export` (carpeta y archivo, línea final); y los códigos reales de error con `svnserve` detenido (red), URL inexistente (no encontrado), `authz` denegado (permisos) y credencial errónea. Guardar los XML **saneados** (rutas y UUID de ejemplo, sin nombres de usuario reales) en `src-tauri/tests/fixtures/` — fuente: `propuesta.md` §21, §25, §130; porque: parsers y clasificación se prueban con salida real.
  - [x] 1.4 **M3, revisión de una carpeta y `info --depth immediates`**: con dos copias, comprobar que la revisión de commit de `svn list` para una carpeta sube cuando cambia algo dentro, que `svn info --depth immediates <carpeta local> --xml` entrega la última revisión local de cada hijo en una sola llamada, y qué da una copia con revisiones mixtas tras un commit parcial — fuente: `design.md` §2; porque: sostiene la regla «desactualizado» de CA-7 sin ser condicional.
  - [x] 1.5 **M4, URL y codificación**: comprobar que `list`/`info`/`export` aceptan URL con `%XX`, `#`, `@`, espacios codificados y emoji codificado con el terminador `@` de `peg_safe`, y que cada clase hostil de CA-1 queda rechazada por la validación endurecida antes de llegar a `svn` — fuente: `svn/commands.rs:176-193`; porque: CA-1, CA-5, CA-11.
  - [x] 1.6 **M5, certificado de servidor no confiable**: con `openssl s_server` (`C:\Program Files\Git\usr\bin\openssl.exe`) y certificados generados con `openssl req/x509`: autofirmado, firmado por una autoridad propia, vencido, con nombre distinto; medir qué imprime `svn list` en modo `--non-interactive` (¿trae emisor y huella?), si `--config-option servers:global:ssl-authority-files=<ruta>` (con espacios) hace confiable el autofirmado y la autoridad, qué combinación hace falta para vencido y nombre distinto (`--trust-server-cert-failures=…`), si la confianza concedida es solo para ese certificado, y si el apretón de manos TLS basta aunque el servidor no hable HTTP de Subversion — fuente: [release notes 1.9](https://subversion.apache.org/docs/release-notes/1.9.html); porque: decide el diseño de I4. **Si la salida de `svn` no trae la huella y hace falta una sonda TLS propia que exija una dependencia nueva, se detiene y se consulta al usuario.**
  - [x] 1.7 **M6, certificado de cliente**: con `openssl s_server -Verify 1` y un PKCS#12 con frase de paso: ¿`svn` acepta `ssl-client-cert-file` por `--config-option`?, ¿cómo se le da la frase de paso sin prompt (`ssl-client-cert-password` en un `servers` de un `--config-dir` temporal y privado, caché de Subversion)?, ¿qué queda en disco y por cuánto? — fuente: [svnbook httpd](https://svnbook.red-bean.com/en/1.7/svn.serverconfig.httpd.html); porque: la frase de paso no puede ir en `argv` (CA-4, CA-11). Si ninguna forma segura funciona, se detiene y se consulta.
  - [x] 1.8 **M7, Windows**: árbol profundo (>260 caracteres) con `svn` 1.14.5, nombres no representables (`aux.txt`, `a:b`, `x.`, `A.txt`/`a.txt`) y qué error da cada uno — fuente: `workspace.rs:105-124,181`; porque: CA-2 («ruta demasiado larga») y CA-7.
  - [x] 1.9 **Puerta de decisión** (resuelta el 2026-10-23, `medidas.md`: leer el certificado con Schannel vía `windows-sys`; frase del certificado de cliente con configuración temporal por operación y unión al `auth` real; listado con `svn list` y reintento por `svn info --depth immediates` tras una caída): M1 define si «No recordar» y las credenciales de sesión en Rust son opcionales u obligatorias; M5 y M6 definen el diseño de I4 y si hace falta consultar por una dependencia; M3 confirma la regla de «desactualizado» (la alternativa `status -u` solo para «Actualizar estado»). Si algo obliga a cambiar el alcance, **se detiene y se consulta al usuario**; no se cambia en silencio.
  - [x] 1.10 pruebas unitarias — test-gen: no aplica, son mediciones; lo que se convierta en prueba (fixtures, comportamiento de auth y TLS) pasa a I2, I4, I5 e I8.
  - [x] 1.11 doc-check — `docs-rewrite` no cubre `plans/`: se revisa a mano que `medidas.md` y los fixtures no contengan datos reales.
- Conexiones: `rules-comentarios` (aplica también a `.ps1`). Resto sin skill aplicable (mediciones de un solo uso; `docs-rewrite` no cubre `plans/`).
- Pipeline del increment: `format` (`plans/` y fixtures); sin `build` ni `unit` nuevos.
- Criterio de aceptacion: `medidas.md` con M1 a M7, veredictos y consecuencias, y los XML reales saneados commiteados.
- Verificacion funcional: datos — ejecución real de `svn.exe` 1.14.5 contra `svnserve`, `file:///` y `openssl s_server`; no aplica navegador.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 2: Registro, errores clasificados y probar conexión (Rust) — cubre spec [CA-1, CA-2, CA-3, CA-11]
- Justificacion / fuentes: §22 y §67. `config.json` ya guarda el estado de la interfaz con el patrón `lenient` (`config/mod.rs:38-54`) y `ui_state_set` muestra cómo mutar y guardar bajo el candado (`state.rs:173-183,321-328`). El `Mutex<AppConfig>` serializa de verdad.
- Pasos:
  - [x] 2.1 `config/marketplace.rs`: `RepoEntry { id, name, url, username, favorite, last_path, client_cert, uuid?, root? }` (`uuid` y `root` se rellenan con el `svn info` de «Probar conexión»; la Fase 5 los usa para construir URL bajo la raíz real y clasificar por UUID) y `MarketplaceConfig { next_id, repos, trusted }`, y el campo `marketplace` en `AppConfig`; una configuración sin el campo carga; si el campo existe pero no parsea, se copia `config.json` a `config.json.marketplace.bad` una sola vez y se avisa por el resultado del command, no se pierde en silencio — fuente: `config/mod.rs:38-54`; porque: CA-1. **Nota de implementación:** `client_cert` y `trusted` se agregan en el Increment 4; el borrado de `remote_url` queda excluido hasta el Increment 5 (excepción acordada con el auditor); validación laxa pendiente de endurecer: `svn://` sin host y peg vacío (`r@`).
  - [x] 2.2 **Endurecer `is_safe_checkout_url`** (la usa también el `checkout` de la Fase 1): rechazar host que empiece por `-`, `file://` con servidor distinto de vacío o `localhost`, espacios, caracteres de control, `\`, `?`, `#` y `@N` final; y agregar `is_marketplace_url` = anterior + exclusión de `svn+ssh` — fuente: `svn/commands.rs:182-193`; porque: CA-1, CA-11 (UNC filtra el hash NTLM; el host con `-` es la clase CVE-2017-9800).
  - [x] 2.3 `app/marketplace/registry.rs`: funciones puras `add`, `update`, `rename`, `remove`, `set_favorite`, `set_last_path`; validan nombre no vacío y sin repetir (sin distinguir mayúsculas), URL con `is_marketplace_url`, URL no repetida (sin barra final), tope `MAX_REPOS` (100); `id` del contador `next_id` persistido, nunca reutilizado; `last_path` es una ruta relativa sin `..`, sin `\` y sin esquema — fuente: `design.md` §2; porque: CA-1.
  - [x] 2.4 `app/marketplace/url.rs`: `remote_url(repo, ruta_relativa)` única: codifica por segmento (todo lo que no sea alfanumérico o `-._~`), rechaza `..` y cualquier salida de la raíz registrada y devuelve ASCII — fuente: `propuesta.md` §130; M4; porque: CA-5 y la mitigación del best-fit de CVE-2024-45720 (`locator.rs:23`).
  - [x] 2.5 Errores: `SvnErrorKind::Network` y `NotFound` (más permisos denegados si M2 los distingue), tabla de códigos de M2 (clasificar por el **código interno**, no por el envoltorio `E170013`: no encontrado `W160013`/`E200009`, `E160013`, `E210005`, `E180001`, `E160006`; red `E730061`, `E731001`, `E175012`; **`E170001` se divide por mensaje**: «Authorization failed» = permisos denegados, «Password incorrect»/«Can't get password» = autenticación; `E120171` = certificado de cliente o frase; salida con violación de acceso = `SvnCrashed`), mapeo a `CommandErrorKind` (`app/error.rs:198-223`), mensajes en español, y actualización del contrato (`tests/contract.rs:38`, `contract.json`, `src/services/tauri.ts:17`, `contract.test.ts`) — fuente: `svn/error.rs:22-31`; porque: CA-2.
  - [x] 2.6 Opciones de red por operación: `RunOptions` gana `no_auth_cache` (→ `--no-auth-cache`); el runner las coloca antes de `--non-interactive` y ninguna lleva secretos — fuente: `runner.rs:18,100`; porque: CA-3.
  - [x] 2.7 `svn/commands.rs` y `client.rs`: `RemoteInfoRequest { url, username }` y `SvnClient::remote_info` (reutiliza `parse_info`); descartado: agregar `username` a `InfoRequest`, que tocaría a `wc_info` — fuente: `commands.rs:26-39`; porque: Core Tenet 1.
  - [x] 2.8 `AppState` (métodos finos): `marketplace_repos`, `marketplace_repo_save`, `marketplace_repo_remove`, `marketplace_repo_favorite`, `marketplace_repo_test`; la persistencia usa el mismo `Mutex<AppConfig>` y se ejecuta en `spawn_blocking`; credenciales de sesión en Rust (`repo_id → (username, Password)`) solo si «No recordar», limpiadas al quitar o editar el repositorio y al cerrar — fuente: `state.rs:173-205`; porque: CA-1, CA-3.
  - [x] 2.9 `commands/marketplace.rs` + registro en `lib.rs`, `commands/mod.rs` y `tests/commands_registry.rs` — fuente: `commands/mod.rs`; porque: el frontend solo invoca commands tipados.
  - [x] 2.10 `tests/common/mod.rs`: agregar `authz-db` a `SVNSERVE_CONF` para «permisos denegados» — fuente: `tests/common/mod.rs:106-128`; porque: CA-2.
  - [x] 2.11 pruebas unitarias — `test-gen`: cada clase hostil de URL (también sobre `start_checkout`), validadores del registro, ids no reutilizados, configuración sin el campo y con el campo dañado, **escrituras concurrentes** del registro y de `ui_state_set` sin pérdida, clasificación de errores con `svnserve` detenido / URL inexistente / `authz` / credencial errónea, `remote_url` con `%41`, `a b`, `x@y`, `#`, acentos y emoji, orden de argv y ausencia de secretos, y que la contraseña no aparece en `config.json`, errores ni `SvnError.command` — fuente: `tests/app_state.rs`, `tests/ui_state.rs`; porque: CA-1, CA-2, CA-3, CA-11. Se corren `ProjectPanel.test.ts` y `tests/app_state.rs` (el `checkout` comparte la validación).
  - [x] 2.12 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (alta, edición, baja, favorito y prueba como flujo), `adr-new` (ADR 0014 propuesto, ya escrito), `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`.
- Criterio de aceptacion: el registro se guarda y recarga; «Probar conexión» da éxito o un error clasificado; las URL hostiles se rechazan en Rust; ninguna contraseña en disco ni en mensajes.
- Verificacion funcional: datos — leer `config.json` real tras guardar y comprobar el contenido sin contraseñas.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 3: Sección Marketplace y repositorios (interfaz) — cubre spec [CA-1, CA-3, CA-13, CA-14]
- Justificacion / fuentes: el botón está deshabilitado (`AppShell.vue:28-49`); `App.vue:42-47` monta una sola instancia de cada ranura; `BaseModal`, `CredentialsModal`, `ConfirmDialog`, `ErrorBanner` y `utils/listFocus.ts`/`ticketGate.ts` ya existen; estilo DocuMalia (memoria `feedback-diseno-documalia`).
- Pasos:
  - [x] 3.1 Selector de sección accesible en `AppShell.vue` con `section: 'files' | 'marketplace'` poseído por `App.vue` (`v-model`); la sección de archivos se mantiene **montada** con `v-show`/`KeepAlive` para no destruir Monaco, PDF ni Office (T-40) — fuente: `AppShell.vue:28-49`, `App.vue:42-47`; porque: CA-14. Reescribir `AppShell.test.ts` y la E2E `shell.e2e.ts:207-213` y la fila de `docs/security.md`.
  - [x] 3.2 `App.vue`: en Marketplace monta `sidebar` = lista de repositorios; `content` y `bottom` quedan como **ranuras vacías con un texto de estado** hasta I6 e I9 — fuente: `App.vue`; porque: no referenciar componentes que aún no existen.
  - [x] 3.3 `services/marketplaceApi.ts` (envoltorios tipados de I2) y `stores/marketplace.ts` (repositorios, seleccionado, estado de la prueba, errores) con `createTicketGate` — fuente: `utils/ticketGate.ts`, `services/filesApi.ts`; porque: reutilizar.
  - [x] 3.4 `components/marketplace/RepoList.vue` (favoritos primero; teclado con `utils/listFocus.ts`: flechas, Enter, F2 renombrar, Supr con confirmación) y `RepoForm.vue` (`BaseModal`: nombre, URL, usuario opcional; validación en línea; «Probar conexión»; casilla **«No recordar»**; **aviso** «Subversion recordará esta credencial…» y aviso si la URL es `http://`) con `CredentialsModal` cuando el servidor lo exige — fuente: `CredentialsModal.vue`; porque: CA-1, CA-3.
  - [x] 3.5 Estilos solo con tokens (`theme-first`), claymorphism — fuente: `src/styles/`; porque: CA-13.
  - [x] 3.6 pruebas unitarias — `test-gen`: store (alta, edición, baja, favorito, error de red sin afectar a otros repositorios, respuesta atrasada, id 0 válido), `RepoList` y `RepoForm` (teclado, foco, avisos, nombre duplicado), `AppShell` y `App` (la sección de archivos conserva las pestañas) con Vitest.
  - [x] 3.7 E2E (`marketplace.e2e.ts`, nuevo): agregar un repositorio `file:///`, reiniciar y verlo; probar uno inexistente; **editar texto sin guardar, ir a Marketplace, volver y comprobar que sigue y que el cierre lo detecta** — fuente: `tests/e2e/real-app/editor-close.e2e.ts`; porque: CA-14.
  - [x] 3.8 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first` (cita: «Todo valor de identidad visual … sale del tema (tokens/variables), nunca quemado en el componente»), `docs-rewrite`, `rules-comentarios`. Auditoría visual con `bossdream-design-auditor` y `a11y` en la implementación.
- Pipeline del increment: `build` (`vue-tsc`), `unit`, `format`, `theme-check`.
- Criterio de aceptacion: se gestionan repositorios desde la interfaz; la lista sobrevive al reinicio; la sección de archivos no pierde su estado.
- Verificacion funcional: navegador — ventana real vía CDP (`harness.ts`).
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 4: Certificados SSL — cubre spec [CA-2, CA-3, CA-4, CA-11]
- Justificacion / fuentes: decisión del usuario (conectar con servidores de todo tipo) y §68 de la propuesta (consentimiento explícito, sin equivalentes peligrosos de `--trust-server-cert`). El diseño exacto depende de M5 y M6 (`design.md` §8).
- Pasos:
  - [ ] 4.1 `svn/` y `RunOptions`: opciones de confianza por operación — autoridades (`--config-option servers:global:ssl-authority-files=<ruta>`), fallos tolerados limitados a los motivos concedidos (`--trust-server-cert-failures=…`, solo tras consentimiento) y certificado de cliente — con pruebas de que ningún secreto llega a `argv` — fuente: M5, M6; porque: CA-4, CA-11.
  - [ ] 4.2 `app/marketplace/certs.rs`: almacén propio en la carpeta de configuración de la app (`certs/`), importación de `.crt`/`.pem` validada (formato, tamaño, no ejecutable), lista, huella SHA-256 y revocación; `TrustedCert` en `config.json` — fuente: `design.md` §8; porque: CA-4.
  - [ ] 4.3 Información del certificado a mostrar (decisión del usuario del 2026-10-23, M5: `svn` no da emisor ni huella): sonda TLS de **solo lectura** con **Schannel vía `windows-sys`** (nuevas features del crate ya presente, sin crates nuevas), código `unsafe` acotado en un módulo propio con pruebas, que hace solo el apretón de manos, lee el certificado presentado (DER), calcula su huella SHA-256 con `sha2` (ya es dependencia) y emisor/vigencia/motivo, y nunca envía credenciales ni datos; el mismo certificado leído es el que se guarda en el almacén (anclaje exacto) — fuente: M5, `Cargo.toml` (`windows-sys`, `sha2`); porque: no aceptar en silencio (§68). Se prueba contra los cinco servidores de `openssl s_server`.
  - [ ] 4.4 Certificado de cliente (decisión del usuario del 2026-10-23, M6): asociación PKCS#12 por repositorio; la frase se pide en la interfaz y, por operación, se crea un **directorio de configuración temporal** privado (permisos solo del usuario) con el `servers` combinado del usuario más `ssl-client-cert-file`, `ssl-client-cert-password` y las autoridades de confianza, copia del `config` y una **unión de directorio hacia el `auth` real** (el cache sigue siendo el de svn.exe); se borra siempre con `Drop`, quitando primero la unión sin seguirla, y en el arranque siguiente se purgan los restos (patrón de `message_file.rs`); nada de esto va a `argv` ni a `config.json`; rutas de Windows en `--config-dir` (con rutas POSIX svn lo ignora, M6) — fuente: M6, T-6; porque: CA-4.
  - [ ] 4.5 Commands `marketplace_cert_trust`, `marketplace_cert_import`, `marketplace_cert_list`, `marketplace_cert_revoke`, `marketplace_client_cert_set`, con registro, contrato y envoltorios — fuente: `commands/mod.rs`; porque: CA-4.
  - [ ] 4.6 Interfaz: diálogo «Certificado no confiable» (servidor, emisor, huella, vigencia, motivo; **Cancelar** / **Confiar**, foco inicial en Cancelar), pantalla de certificados de confianza (ver, importar autoridad, revocar) y campo de certificado de cliente en `RepoForm` — fuente: `BaseModal.vue`, `ChoiceDialog.vue`; porque: CA-4, CA-13.
  - [ ] 4.7 pruebas unitarias — `test-gen` y `flow-test-gen`: con `openssl s_server`: autofirmado (rechazado sin consentimiento, aceptado tras «Confiar», **otro certificado distinto vuelve a preguntar**), firmado por una autoridad importada, vencido, nombre distinto, exige certificado de cliente (con frase correcta e incorrecta), revocación de la confianza; el diálogo y su teclado con Vitest; E2E en `marketplace.e2e.ts`; comprobar que `argv`, `config.json` y errores no contienen la frase de paso — fuente: `tests/common/mod.rs`; porque: CA-4, CA-11. Se declara que la respuesta HTTP de mod_dav_svn no se emula.
  - [ ] 4.8 ADR 0014: ampliarlo con certificados (decisión, almacén propio, límites) y, si hay consulta por dependencia, un ADR aparte — fuente: `docs/adr/0000-template.md`; porque: decisión significativa.
  - [ ] 4.9 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (consentimiento → reintento → revocación), `adr-new`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se navega un https con certificado interno, autofirmado o de cliente tras consentimiento explícito; nada se acepta en silencio; la confianza se ve y se revoca.
- Verificacion funcional: navegador — ventana real vía CDP contra `openssl s_server`: ver el diálogo, confiar, reintentar, revocar.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 5: Listado e info remotos (Rust) — cubre spec [CA-2, CA-5, CA-6]
- Justificacion / fuentes: §21 y §25. Los XML reales y los códigos de error salen de I1; `remote_url` y la clasificación de errores, de I2.
- Pasos:
  - [ ] 5.1 `svn/models.rs` y `parsers.rs`: `ListEntry`, `RemoteDetail` (`InfoEntry` + `lock: Option<InfoLock>`) y `RemoteProps` con tope `MAX_PROP_VALUE_BYTES`; `parse_list`, `parse_remote_info`, `parse_proplist` con `quick_xml` — fuente: `parsers.rs:131-166`; porque: «el frontend nunca recibe stdout como texto».
  - [ ] 5.2 `commands.rs` y `client.rs`: `ListRequest`, `RemotePropsRequest` y `SvnClient::list`, `remote_props` — argumentos separados, `@` final — fuente: `commands.rs:26-62`; porque: CA-11.
  - [ ] 5.3 `app/marketplace/browse.rs`: `list(repo_id, ruta)` con `remote_url`, opciones de red de I2/I4, caché por URL y revisión (`LIST_CACHE_TTL`) invalidada al descargar, **cancelación por vista** (un `Notify` que cancela el listado anterior), parseo en `spawn_blocking`, tope `MAX_LIST_ENTRIES` con bandera `truncated`, orden (carpetas primero, nombres sin distinguir mayúsculas); **si `svn list` termina con violación de acceso** (M7: nombre con `:`, exit 139, informe y minidump en `%TEMP%`) se reintenta con `svn info --depth immediates --xml` y se avisa «nombres no válidos en Windows», y se purgan `svn-crash-log*` de `%TEMP%`; la medición de rendimiento con miles de entradas puede cambiar la vía primaria (decisión del usuario: `list` con reintento) — fuente: `RunOptions.cancel` hoy sin uso, M7; porque: CA-5 sin acumular procesos `svn`.
  - [ ] 5.4 `info(repo_id, ruta)` que combina `remote_info` y `remote_props` y entrega cada dato opcional; los nombres y valores se entregan sin interpretar (el escape de controles y bidi lo hace la interfaz y se prueba) — fuente: spec CA-6; porque: «un dato ausente se muestra como ausente».
  - [ ] 5.5 Commands `marketplace_list`, `marketplace_info` y `marketplace_repo_set_last_path` (validado como en I2); registro, `commands_registry.rs`, contrato Rust/TS y envoltorios — fuente: `commands/mod.rs`; porque: tipados.
  - [ ] 5.6 pruebas unitarias — `test-gen`: parsers con la salida real saneada de I1 (espacios, acentos, `%`, `#`, `@`, emoji, carpeta vacía, bloqueo, propiedades enormes, MIME) y XML truncado o inválido; `..`, `\`, absoluta y esquema rechazados; integración contra repositorio real y `svnserve` (raíz, subcarpeta, revisión específica, inexistente, permisos denegados, credenciales); caché (acierto, vencimiento, invalidación); cancelación de un listado en vuelo; listado mayor que `MAX_LIST_ENTRIES` — fuente: `tests/svn_read.rs`, `tests/svn_layer.rs`; porque: CA-5, CA-6.
  - [ ] 5.7 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (navegación por rutas), `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: los commands devuelven datos tipados correctos contra un repositorio real y rechazan rutas hostiles.
- Verificacion funcional: datos — invocar los commands y cotejar con la salida directa de `svn`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 6: Navegador remoto y panel de detalle (interfaz) — cubre spec [CA-5, CA-6, CA-13]
- Justificacion / fuentes: §23-25, §120: seleccionar una carpeta entra; seleccionar un archivo **no lo abre** y muestra un panel lateral.
- Pasos:
  - [ ] 6.1 `components/marketplace/RemoteBrowser.vue`: entradas con iconos (`components/icons`), migas dentro de la raíz registrada, subir un nivel, cargando / vacío / error / truncado en línea, teclado con `utils/listFocus.ts` (flechas, Enter entra, Retroceso sube), selección única — fuente: `components/explorer/`; porque: CA-5, CA-13.
  - [ ] 6.2 `components/marketplace/RemoteDetail.vue`: tipo, tamaño, revisión, autor, fecha, URL, ruta, propiedades, bloqueo y MIME, «—» si no existe; **escapa caracteres de control y bidireccionales**; marca las propiedades truncadas; ranura para «Descargar» (I10) y para el estado local (I7); descarta respuestas atrasadas — fuente: `design.md` §2; porque: CA-6.
  - [ ] 6.3 `stores/marketplace.ts`: ruta, entradas, selección, detalle y errores por repositorio; navegar guarda `last_path`; cambiar de repositorio no mezcla datos; ante `AuthRequired` abre `CredentialsModal` y repite; ante `UntrustedCertificate` abre el diálogo de I4 — fuente: I3, I4; porque: CA-3, CA-4, CA-5.
  - [ ] 6.4 Montar `RemoteBrowser` y `RemoteDetail` en las ranuras `content` de `App.vue` — fuente: I3 paso 3.2; porque: completar la sección.
  - [ ] 6.5 E2E (`marketplace.e2e.ts`): navegar a una subcarpeta con espacios, acentos y `#`, seleccionar un archivo y ver el detalle sin abrir visor, verificar que **el WebView no hace peticiones de red**, y **recorrer la sección solo con el teclado** — fuente: `tests/e2e/real-app/explorer.e2e.ts`; porque: ADR 0008, CA-5, CA-13.
  - [ ] 6.6 pruebas unitarias — `test-gen`: navegación (entrar, subir, no subir por encima de la raíz, migas), detalle (ausente, bloqueo, truncado, bidi, respuesta atrasada), teclado y foco, errores en línea, repositorio vacío, aviso de truncado con Vitest.
  - [ ] 6.7 `a11y` sobre la sección — fuente: `CLAUDE.md` global; porque: CA-13.
  - [ ] 6.8 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`; auditoría con `bossdream-design-auditor`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E del Marketplace.
- Criterio de aceptacion: se navega un repositorio real y se ve el detalle de un archivo sin abrirlo.
- Verificacion funcional: navegador — ventana real vía CDP, flujo feliz y validaciones.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 7: Índice de copias de trabajo y estado local — cubre spec [CA-6, CA-7, CA-13]
- Justificacion / fuentes: §28-30: el estado sale de SVN y la correspondencia es por UUID y URL. Reutiliza `svn info` local (`InfoEntry`), `wc_status_map` y el filtro de `.svn` de `files/mod.rs:43,349-355`.
- Pasos:
  - [ ] 7.1 `app/marketplace/wc_index.rs`: recorre el Workspace Root buscando `.svn` y `_svn` (`archive/safety.rs:7`), **en `spawn_blocking`**, sin entrar en una copia ya encontrada, usando `file_type().is_symlink()` y no atributos de reanálisis (OneDrive), con `MAX_SCAN_DEPTH` 4 y `MAX_INDEXED_COPIES` 500; `svn info` por copia con concurrencia limitada; una copia dañada o de formato 1.6 (`E155036`) se omite y se cuenta; si se trunca, el índice lo declara — fuente: `design.md` §2; porque: CA-7, rendimiento (§86).
  - [ ] 7.2 `app/marketplace/local_state.rs`: `match_local(url: &str, revision: u64, index: &[WcIndexEntry]) -> Option<WcMatch>` con comparación **por segmentos**; la ruta local se resuelve con `Workspace::resolve` y, si no es representable en Windows (M7), el elemento se omite del cruce sin romper el listado — fuente: `workspace.rs:105-124`; porque: CA-7.
  - [ ] 7.3 `LocalState`: `NotDownloaded` (sin copia o no existe en disco), `Incomplete` (estado `incomplete`/`obstructed`), `Conflict` (`conflicted`/`tree_conflicted`), `Modified` (`modified`, `added`, `deleted`, `replaced`, `missing`), `Outdated` (última revisión remota del elemento > última revisión **local del elemento** de `svn info --depth immediates`, M3), `Unknown` (estado truncado o fallido) y `Downloaded`, en ese orden de precedencia; el estado se pide **sin ignorados** y de forma perezosa para los elementos visibles — fuente: `wc_status.rs:15,179-180,198-205`; porque: CA-7. «Actualizar estado» usa `status -u` (con credenciales) solo a petición.
  - [ ] 7.4 Commands `marketplace_index_refresh` (completo o solo un destino), `marketplace_local_state(repo_id, rutas[])` y `marketplace_local_open` (devuelve la ruta local para abrirla como pestaña); la reconstrucción se dispara al abrir la sección, tras cada `svn://done` de una descarga (solo el destino) y con el botón «Reindexar» — fuente: `commands/mod.rs`; porque: CA-7.
  - [ ] 7.5 Interfaz: distintivo de estado en `RemoteBrowser` y bloque «Estado local» en `RemoteDetail` con revisión local y remota, «índice incompleto» y la working copy relacionada, con un enlace «Abrir carpeta local» que la abre como pestaña en «Mis archivos»; estados explicados por texto además del color — fuente: `components/explorer/` (distintivos SVN); porque: CA-6, CA-7, CA-13.
  - [ ] 7.6 pruebas unitarias — `test-gen` y `flow-test-gen`: copia al día, desactualizada (otro commit desde una segunda copia), **commit parcial con revisiones mixtas (no debe salir desactualizada)**, modificada, en conflicto, anidada, parcial (`--depth empty`), incompleta, eliminada del disco, dos repositorios con el mismo árbol y distinto UUID, URL hermana con prefijo común (`/repo/app` frente a `/repo/app2`), copia fuera del root, enlace simbólico, nombres `aux.txt`, `a:b` y `A.txt`/`a.txt`, mapa de estado truncado, índice con una copia dañada y con límites de profundidad y cantidad; Vitest para los distintivos — porque: CA-7.
  - [ ] 7.7 doc-check — `docs-rewrite` (documentar que los externals que son su propia copia no se indexan).
- Conexiones: `test-gen`, `flow-test-gen` (matriz de estados), `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`.
- Criterio de aceptacion: cada estado de la spec se produce con un repositorio real y la correspondencia no se confunde por nombre, prefijo ni revisiones mixtas.
- Verificacion funcional: navegador — ventana real vía CDP: descargar con `svn` por fuera, ver «descargado», hacer commit desde otra copia y ver «desactualizado», modificar un archivo y ver «modificado».
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 8: Descarga (Rust) — cubre spec [CA-8, CA-9, CA-11]
- Justificacion / fuentes: §26, §27, §31, §32. `Operations::checkout` ya existe completo (`operations.rs:187-205`); lo nuevo es `export`, la URL construida en Rust, la limpieza, los externals y el endurecimiento.
- Pasos:
  - [ ] 8.1 `svn/commands.rs` y `client.rs`: `ExportRequest { url, dest, revision, depth, ignore_externals, username }` (`export [-r N] [--depth d] [--ignore-externals] <url>@ <dest>`; **sin `--force`**) y `SvnClient::export` — fuente: `CheckoutRequest` (`commands.rs:84-105`); porque: §27. Descartado: `--force`, que sobrescribiría sin que el usuario lo decida.
  - [ ] 8.2 `svn/progress.rs`: agregar `"Exported revision "` a `REVISION_PREFIXES` (sin tomar `Exported external at revision N.` como revisión final; el `export` de un archivo termina con `Export complete.` y no tiene revisión) y probar la salida real de `export` de carpeta, archivo y raíz con externals (`fixtures/marketplace/export-*.txt`), que llega en la página de códigos OEM: la decodificación tolera bytes no UTF-8 — fuente: `progress.rs:15-20`, M2; porque: el progreso termina con esa línea.
  - [ ] 8.3 `Operations::export`, `AppState::start_export` y el command **`marketplace_download(repo_id, ruta, opciones)`** que reconstruye la URL con `remote_url`, valida con `is_marketplace_url`, resuelve el destino con `scoped(&dest, false)` (**debe no existir**), rechaza un destino que sea directorio al exportar un archivo, avisa si cae dentro de otra WC, y rechaza ancestro o descendiente de una operación en curso con `try_lock_for_write`/`are_nested` **soltando esos guards antes de `guarded`** para no bloquearse a sí mismo — fuente: `operations.rs:113-125,187-205`, `state.rs:344-366`; porque: CA-8, CA-9.
  - [ ] 8.4 **Limpieza**: si la operación termina `Cancelled`, `TimedOut` o con error y el destino no existía antes, Rust lo borra (revalida la ruta, no sigue enlaces ni puntos de reanálisis, informa lo que no pudo borrar —archivo bloqueado u OneDrive, como T-39— y marca `needs_cleanup` si queda una copia) — fuente: `operations.rs:289-293`, `runner.rs:136-138`, T-15, T-39; porque: CA-8 («nunca queda una copia a medias presentada como buena») y para que el reintento parta limpio.
  - [ ] 8.5 `app/marketplace/externals.rs`: `propget svn:externals` con plazo y tope; **parser de definiciones** (formato anterior y posterior a 1.5, `-rN`, `@peg`, espacios escapados, externals de archivo) que resuelve las formas `../`, `^/`, `//`, `/`, `^/../REPO` y absolutas contra la URL del directorio y la raíz del repositorio y devuelve cuáles apuntan a **otro host o esquema**; se omite con profundidad `empty` o `files`; si falla o vence, «no se pudo comprobar»; con credencial y externals externos o no comprobables, `marketplace_download` fuerza `--ignore-externals` y lo informa — fuente: [svnbook externals](https://svnbook.red-bean.com/en/1.7/svn.advanced.externals.html); decisión del usuario; porque: CA-8. Límite documentado: los externals anidados dentro de externals no se ven.
  - [ ] 8.6 Command `marketplace_externals(repo_id, ruta)`, registro, `commands_registry.rs`, contrato y envoltorios; `svn_checkout` queda para el panel de proyecto — fuente: `commands/mod.rs:102-110`; porque: tipados.
  - [ ] 8.7 pruebas unitarias — `test-gen`: `ExportRequest::args` (orden, URL con `@`, sin `--force`); progreso con salida real; `marketplace_download` con destino existente, fuera del root, con `..`, dentro de otra WC, directorio al exportar archivo, ancestro y descendiente concurrentes, enlace simbólico; **cancelación, fallo y plazo borran el destino creado y un reintento posterior funciona**; `svnserve` con credencial correcta, errónea y cancelación; **matriz del parser de externals** (cada forma, mismo host/otro host/otro esquema, archivo, no comprobable) y descarga con externals en otro repositorio — fuente: `tests/svn_operations.rs`, `tests/app_state.rs:569-578`; porque: CA-8, CA-9, CA-11.
  - [ ] 8.8 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (descarga → cancelación → limpieza → reintento), `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: una carpeta se descarga como WC y como export, un archivo como copia limpia, solo a destinos nuevos del workspace; lo cancelado no deja rastro; los externals ajenos no reciben la credencial.
- Verificacion funcional: datos — descargar contra un repositorio de prueba y comprobar en disco (presencia o ausencia de `.svn`, destino borrado tras cancelar).
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 9: Administrador de descargas — cubre spec [CA-10, CA-11, CA-13]
- Justificacion / fuentes: §121. Los eventos `svn://progress` y `svn://done` identifican la operación por `OperationId`; `runOperation` (`services/tauri.ts:294-298`) ya filtra por id y guarda eventos tempranos.
- Pasos:
  - [ ] 9.1 `relay` (`operations.rs:346`) y `ProgressEvent`: limitador de eventos por operación (`PROGRESS_EVENTS_PER_SECOND` 10, con coalescencia) y tope de largo de línea; el canal deja de ser ilimitado — fuente: `progress.rs:56-65`, `commands/mod.rs:45-55`; porque: un checkout grande emite un evento IPC por archivo (CA-10, CA-11).
  - [ ] 9.2 `stores/downloads.ts`: lista (id de operación, nombre, destino, tipo, estado `pending|running|done|failed|cancelled`, progreso, líneas acotadas) con `runOperation`; cola con `MAX_PARALLEL_DOWNLOADS` 3 y `pending` real; **sin comprobaciones del tipo `if (id)`** (los ids empiezan en 0) — fuente: `services/tauri.ts:294-298`; porque: CA-10.
  - [ ] 9.3 Acciones: cancelar (`op_cancel`), reintentar (relanza con los mismos parámetros; la contraseña **no** se conserva en JS y, si falló por autenticación, se vuelve a pedir con `CredentialsModal`; el destino ya fue limpiado por I8), abrir ubicación (pestaña en «Mis archivos» con `stores/tabs.ts`) y detalles — fuente: `stores/tabs.ts`, `CredentialsModal.vue`; porque: CA-10 sin aplicaciones externas.
  - [ ] 9.4 `components/marketplace/DownloadsPanel.vue` en la ranura `bottom`: filas con `role="progressbar"`, estado en texto, acciones con teclado, `aria-live` — fuente: `ProgressLog.vue`, `InfoPanel.vue`; porque: CA-10, CA-13.
  - [ ] 9.5 **Cierre de ventana**: registrar un `CloseGuard` con `registerCloseGuard` (`composables/useWindowClose.ts:14-17`) que llama a `opCancel` en cada descarga y **espera el `svn://done` de cada una** dentro de `HOLD_KEEPALIVE_TIMEOUT` (6 s, `closing.rs:4`, con el latido existente) antes de devolver — fuente: ADR 0009; porque: `kill_on_drop` no corre al salir el proceso y quedarían `svn.exe` huérfanos (CA-10).
  - [ ] 9.6 E2E (`marketplace.e2e.ts`): dos descargas simultáneas sin mezclarse, una tercera pendiente, cancelar una (destino borrado), reintentar una fallida, abrir la ubicación, **cerrar la ventana con una en curso y comprobar que no queda ningún `svn.exe`** — fuente: `tests/e2e/real-app/editor-close.e2e.ts`; porque: CA-10.
  - [ ] 9.7 pruebas unitarias — `test-gen` y `flow-test-gen`: transiciones (`pending→running→done|failed|cancelled`, reintento, cancelar una terminada, evento ajeno ignorado, duplicado o fuera de orden), tope de simultáneas, salida acotada, limitador de eventos, panel con teclado y `aria`, `CloseGuard`, con Vitest y Stryker en el código nuevo.
  - [ ] 9.8 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (máquina de estados de una descarga), `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: varias descargas se siguen, se cancelan y se reintentan sin mezclarse, y cerrar la ventana no deja procesos.
- Verificacion funcional: navegador — ventana real vía CDP: lanzar descargas con la API de test, cancelar, reintentar y cerrar.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 10: Diálogo de descarga — cubre spec [CA-8, CA-9, CA-12, CA-13]
- Justificacion / fuentes: §26, §31, §32. El panel de descargas (I9) y `marketplace_download` (I8) ya existen; el selector del destino no puede ser el diálogo nativo (`pickDirectory`, `tauri.ts:264`, sin restricción) sino el árbol del workspace más un nombre nuevo, como `CheckoutForm.vue`.
- Pasos:
  - [ ] 10.1 `components/marketplace/DownloadDialog.vue` (`BaseModal`): modo «Working copy» / «Export limpio», revisión (HEAD o número validado), profundidad (completa, archivos, inmediatos, vacía), «Incluir externals» (marcada; **bloqueada con el motivo** si I8 detecta externals ajenos con credencial o no pudo comprobarlos), destino = carpeta del árbol del workspace (reutilizar `FileTree`) + nombre nuevo, aviso si el destino queda dentro de otra WC o si destino + ruta remota supera el umbral de ruta larga (M7) — fuente: `CheckoutForm.vue`, `FileTree.vue`; porque: CA-8, CA-13.
  - [ ] 10.2 Para archivos: solo «Copia limpia» con el texto de que SVN trabaja por carpetas y que no es byte a byte, y el enlace «Descargar la carpeta para seguirlo»; un nombre ya existente se rechaza y se pide otro — fuente: spec CA-9; porque: CA-9, CA-12.
  - [ ] 10.3 Botón «Descargar» en `RemoteDetail` y en el menú de la lista; al aceptar, crea la fila en `stores/downloads.ts`; al terminar, se refresca el índice (solo el destino) y se invalida la caché de listado — fuente: I5 paso 5.3, I7 paso 7.4; porque: CA-8.
  - [ ] 10.4 E2E (`marketplace.e2e.ts`): descargar una carpeta como WC y verificar `.svn`; exportar y verificar su ausencia; exportar un archivo; destino existente rechazado; carpeta con externals ajenos y credencial (casilla bloqueada); verificar que ningún comando lleva URL del frontend — fuente: `tests/e2e/real-app/`; porque: CA-8, CA-9, CA-11.
  - [ ] 10.5 Comprobar que no aparecen acciones de fases posteriores (log, diff, branch, merge) en ningún menú de la sección — fuente: spec CA-12; porque: CA-12 (prueba de componente y E2E).
  - [ ] 10.6 pruebas unitarias — `test-gen`: validación de revisión y profundidad, foco y teclado, casilla bloqueada, avisos, archivo vs carpeta, con Vitest; `a11y` sobre el diálogo.
  - [ ] 10.7 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (diálogo → descarga → índice), `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: desde el detalle se descarga una carpeta (WC o export) y un archivo, solo a destinos nuevos, con avisos honestos.
- Verificacion funcional: navegador — ventana real vía CDP: descargar carpeta y archivo y comprobar en disco y en el estado local.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 11: Documentación — cubre spec [CA-12, CA-16]
- Justificacion / fuentes: §126 pide `marketplace.md`; el roadmap ya lo prevé con la Fase 3.
- Pasos:
  - [ ] 11.1 Crear `docs/marketplace.md` (repositorios, navegación, detalle, estado local y su regla, certificados, descargas, **límites**: revisiones mixtas, externals anidados, rutas largas, nombres no representables, copia limpia no byte a byte, auth cache de http(s) no medido) con frontmatter y símbolos reales — fuente: `docs/svn-integration.md` (formato); porque: CA-12, CA-16.
  - [ ] 11.2 Actualizar `docs/svn-integration.md` (peticiones nuevas, opciones de red, M1 a M7), `docs/security.md` (validación de URL endurecida, destinos, credenciales, certificados, qué ve el WebView; quitar la fila de Marketplace deshabilitado), `docs/testing.md` (fixtures reales saneados, `openssl s_server`, E2E de Marketplace), `docs/ARCHITECTURE.md` (módulo `app/marketplace/`, commands) y `docs/roadmap.md` (Fase 3 hecha; 4 a 6 diferidas) — fuente: cada documento; porque: código = fuente de verdad.
  - [ ] 11.3 `docs/adr/0014-…` a `accepted` con la evidencia de M1 a M7; deuda nueva a `docs/TECH_DEBT.md` — fuente: `docs/adr/0000-template.md`; porque: CA-16.
  - [ ] 11.4 `docs-rewrite --check` sobre `docs/` y verificación de enlaces — fuente: skill `docs-rewrite`; porque: sin referencias rotas.
  - [ ] 11.5 pruebas unitarias — `test-gen`: no aplica, solo documentación.
  - [ ] 11.6 doc-check — `docs-rewrite`.
- Conexiones: `docs-rewrite`, `adr-new`, `tech-debt`.
- Pipeline del increment: `format`.
- Criterio de aceptacion: documentación coherente con el código real, ADR aceptado, deuda registrada.
- Verificacion funcional: no aplica: solo documentación; se cotejan afirmaciones con el código.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 12: QA Increment — cubre spec [CA-15]
- Justificacion / fuentes: `completion.json` exige `qa-manager` (`bossdream-qa-planner`) en el último increment; cada fase anterior cerró con QA ACCEPTED.
- Pasos:
  - [ ] 12.1 `qa-increment` (modo de `bossdream.json > qa.mode`): Test Inventory del Marketplace con `bossdream-qa-gatekeeper`; `qa-run` con el auditor adversarial de pruebas y el flow-breaker (estados de una descarga, índice, registro, consentimiento de certificados) — fuente: skills `qa-increment`, `qa-run`, `test-checks`; porque: veredicto independiente.
  - [ ] 12.2 `test-checks`: `cargo check`, `cargo test`, `npm test`, `npm run build`, mutación de Rust y de frontend sobre el código nuevo, la suite E2E de la 2A y la 2B sin regresiones, la E2E de Marketplace y `tauri build` — fuente: `pipeline.json`, `stryker.config.json`; porque: CA-15.
  - [ ] 12.3 Corregir lo que halle el QA y repetir hasta ACCEPTED; marcar cada CA de la spec con `[x]` o `[~]` y su motivo — fuente: cierre de `plans/fase-2b-documentos/spec.md`; porque: honestidad.
  - [ ] 12.4 pruebas unitarias — `test-gen`: las que pida el QA.
  - [ ] 12.5 doc-check — `docs-rewrite`.
- Conexiones: `qa-increment`, `qa-run`, `test-checks`, `flow-test-gen`, `docs-rewrite`.
- Pipeline del increment: todos los gates de `completion.json`.
- Criterio de aceptacion: QA Increment ACCEPTED con evidencia mostrada.
- Verificacion funcional: navegador — E2E de Marketplace completo sobre el ejecutable de depuración y el de release.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

## Revision adversarial
Revisión de un subagente `general-purpose` (solo lectura) contra el código real, más `bossdream-completeness-auditor` y `bossdream-document-explorer`. Aplicado:

| Hallazgo | Resolución |
|---|---|
| A1 `checkout` rechaza también carpeta vacía | Spec CA-8: destino inexistente; I8 y I10 |
| A2 faltan clases de error de red y no encontrado | I2 paso 2.5 |
| A3 cancelar deja basura y rompe el reintento | I8 paso 8.4; `Incomplete` en I7 |
| A4 cierre de ventana mal enganchado | I9 paso 9.5 (`registerCloseGuard`) |
| A5 `stdout` reenviado sin límite | I9 paso 9.1; CA-11 reformulado |
| A6 `project.ts` no escucha eventos | Riesgo cerrado; I9 usa `runOperation` |
| A7 citas desfasadas y nombres | Corregidos en esta versión |
| B1 URL: UNC, host con `-`, `@rev` | I2 paso 2.2 |
| B2 credencial hacia externals ajenos; formas de external (también bloqueante del auditor) | I8 paso 8.5; decisión del usuario |
| B3 codificación de URL duplicada | I2 paso 2.4 y `marketplace_download` |
| B4 política de contraseña | Spec CA-3; I2 paso 2.8; I3 paso 3.4 |
| B5 selector de destino inexistente | I10 paso 10.1 |
| B6 propiedades enormes y bidi | I5 y I6 |
| C1 falso «desactualizado» con revisiones mixtas | Regla definida con `info --depth immediates` (I7 paso 7.3) |
| C2 a C7 estados, nombres de Windows, rutas largas, OneDrive, índice, `export` | I7, I8, I10 y M7 |
| D1 orden de increments | Administrador (I9) antes del diálogo (I10); I3 con ranuras vacías |
| D2 y D3 sección de archivos y E2E del shell | I3 pasos 3.1 y 3.7 |
| D4 candado ancestro/descendiente | I8 paso 8.3 |
| D5 a D7 huecos de cobertura, ids, cancelación | I2, I5, I6, I10 |
| E1 a E4 firmas, constantes, fixtures, progreso | Constantes en `design.md` §2; fixtures saneados; I8 paso 8.2 |
| Completitud: `svn+ssh`, certificados, auth cache, externals de otro servidor | Decisiones del usuario del 2026-10-23 (CA-1, CA-3, CA-4, CA-8) |

Lo que sigue siendo `supuesto — verificar` y se resuelve en I1: auth cache con `--password-from-stdin` (M1), códigos de error de red y no encontrado (M2), `info --depth immediates` (M3), el comportamiento de `--non-interactive` ante certificados no confiables y la entrega de la frase de paso de un certificado de cliente (M5, M6).
