# Plan — Fase 1: Fundación

> Producto de `/bossdream-plan`. Referencia: `spec.md` (QUE), `design.md` (diseño aprobado 2026-10-12).

## Razon de ser
Base segura y probada contra un repo SVN real: Workspace Root, localizar `svn.exe`, `info`, `status`, `checkout`, `update`, `commit`, cancelación y cleanup, y un shell Vue mínimo. Hoy el código es solo el scaffold de Tauri (`src-tauri/src/lib.rs`: `greet`; `src/App.vue` de plantilla).

## Justificacion
Capas `commands → app → svn` y solo Rust lanza `svn.exe` (`design.md` §1-§2, `CLAUDE.md` reglas duras). Decisión sin shell: ADR-0001.

## Flujo (que / por que)
Se construye de adentro hacia afuera: seguridad de rutas (I1) → ejecución de svn (I2) → lectura tipada (I3) → operaciones que mutan (I4) → superficie IPC (I5) → UI (I6) → QA (I7). Cada capa se prueba contra svn real antes de montar la siguiente.

## Clasificacion
tipo: new · complejidad: large

## Investigacion (research-log)
| Pregunta | Tool/agente | Hallazgo | Como informo el plan |
|---|---|---|---|
| ¿Qué hay implementado? | Glob/Read | Solo scaffold: `src-tauri/src/lib.rs`, `src/App.vue`; sin `src-tauri/tests` | Todo es `new` |
| ¿Hay svn y qué versión? | Bash | `C:\Program Files\SlikSvn\bin\svn.exe` 1.14.2, fuera del PATH | Tests lo localizan con `svn_locator`, no por PATH (I2) |
| ¿Existe la referencia visual? | Bash | `C:\Users\spook\Downloads\malia-documalia-master\src` con `WindowTitleBar`, `BaseModal`, `ConfirmDialog`, `ResizeHandle`, `ContextMenu`, `TabBar`, composables `usePersistedPreference`, `useTheme`, `useFocusTrap`, `useResizablePanel` | I6 adapta; en Fase 1 no se trae `ContextMenu`/`TabBar`/`ResizeHandle` (YAGNI) |
| ¿Qué falta en `package.json`? | Read | Sin script `test`; sí vitest, stryker, pinia, monaco-editor | I6.1 agrega `test`; CA-18 |
| ¿Qué falta en `Cargo.toml`? | Read | Sin tokio, quick-xml, thiserror, tempfile, dialog | I1-I5 agregan cada dep donde se usa |
| ¿Requisitos duros de Subversion? | `bossdream-completeness-auditor` (CHANGES oficial, svnbook, release notes 1.10/1.14, 2026-10-12) | `--password-from-stdin` desde 1.10; auth con `--non-interactive` falla E170001; TLS no confiable falla; WC ≤1.7 falla E155036; matar svn deja lock E155004; encoding en Windows sin fuente | CA-3, CA-9, CA-14..17; `wc_cleanup`; test con tildes |
| ¿Skills aplicables? | `bossdream-document-explorer` ×6 | Solo `test-gen`, `docs-rewrite`, `theme-first` y `rules-comentarios` aplican; lo demás sin skill | `Conexiones` por increment |

## Impacto cross-flow
| Flujo afectado | Verificado con | ¿Choca? | Mitigacion |
|---|---|---|---|
| Ninguno: no hay flujos existentes | Glob de `src`/`src-tauri` | No | Reemplazar `greet` y `App.vue` de scaffold (I5/I6) |

## Deuda tecnica (informativa, NO bloqueante)
`docs/TECH_DEBT.md` vacío; sin código previo que auditar.
| Ubicacion | Deuda | Impacto | Remediacion | Esfuerzo | ¿Se paga en este plan? |
|---|---|---|---|---|---|
| `src-tauri/src/lib.rs` | `greet` de plantilla | Bajo | Se elimina en I5 | low | Sí |
| `pipeline.json` | Etapa `unit` falla hasta haber tests; sin stack-pack Rust | Medio | Tests desde I1; etapas `rust-*` ya manuales | low | Sí |

## Decisiones (opcion elegida vs descartadas)
| Decision | Elegida | Descartadas + por que | ADR |
|---|---|---|---|
| Lanzar svn | Commands Rust tipados | `tauri-plugin-shell`: inyección de comandos | ADR-0001 |
| Editor | Monaco (Fase 7) | CodeMirror: preferencia del usuario | ADR-0002 |
| Credenciales remotas | UI pide usuario/contraseña por `--password-from-stdin`, sin persistir | Solo auth cache: bloquea repos sin login previo | ADR-0003 (I5) |
| TLS no confiable | Fallar con error guiado | Confiar explícito / no soportar: más superficie en Fase 1 | ADR-0004 (I2) |
| WC formato antiguo | Error con instrucción de `svn upgrade` | Upgrade desde la app: cambio irreversible | ADR-0004 (I2) |
| Cancelación | Kill + `wc_cleanup` | Solo "sugerir cleanup": no ejecutable desde la app | — |
| Versión mínima svn | 1.10 | Sin umbral: `--password-from-stdin` no existiría | — |

## Increments

### Increment 1: Workspace seguro — cubre spec [CA-1, CA-2]
- Justificacion / fuentes: toda operación depende de `ScopedPath`; `design.md` §3.
- Pasos:
  - [x] 1.1 Agregar `thiserror` y dev `tempfile` a `src-tauri/Cargo.toml` — fuente: `src-tauri/Cargo.toml` (hoy solo tauri, opener, serde); porque: errores tipados y dirs temporales en tests.
  - [x] 1.2 `src-tauri/src/app/workspace.rs`: `WorkspaceRoot` (ruta canónica), `ScopedPath` (solo construible vía `Workspace::resolve`), rechazo de `..`, `\\.\`, UNC inesperada, nombres reservados; canonicalizar ancestro existente más profundo; `starts_with` por componentes sin distinguir mayúsculas; `DestinationExists` sin `allow_overwrite` — bossdream-coder · fuente: `design.md` §3 puntos 1-4; porque: núcleo de seguridad.
  - [x] 1.3 `Workspace::revalidate(&ScopedPath)` para TOCTOU antes de ejecutar — fuente: `design.md` §3 punto 5.
  - [x] 1.4 pruebas unitarias — test-gen (adversarial primero: `..`, junction que escapa, `C:\SVN2` vs `C:\SVN`, mayúsculas, CON/NUL, `\\.\`; happy path al final); solo lógica.
  - [x] 1.5 doc-check — `docs-rewrite`.
- Conexiones: `test-gen` (cita: "adversarial primero, happy path al final"), `docs-rewrite` (modo `--check`), `rules-comentarios`. Sin skill de rutas/Rust: sin duplicación existente (no hay código previo).
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: CA-1 y CA-2 con pruebas en verde, incluida una junction real creada en el test.
- Verificacion funcional: no aplica: capa Rust sin UI ni persistencia; la cubren las pruebas con filesystem real.
- Revision de planeacion: PASO

### Increment 2: Capa svn base — cubre spec [CA-3, CA-10, CA-13, CA-15, CA-16, CA-17]
- Justificacion / fuentes: nada de svn funciona sin runner, errores y locator; `design.md` §4; hallazgos del auditor (versión ≥1.10, E170001/E155036/E155004, encoding).
- Pasos:
  - [x] 2.1 Agregar `tokio` (process, time, sync, macros) — fuente: `design.md` §4 ("timeout y cancelación (kill del hijo)").
  - [x] 2.2 `src-tauri/src/svn/error.rs`: `SvnError` por código `E######` conservando comando/stdout/stderr/exit/timestamp sin contraseñas; variantes tipadas para E170001 (autenticación), certificado no confiable, E155036 (WC antigua), E155004 (WC bloqueada) — fuente: `design.md` §4; auditor 2026-10-12.
  - [x] 2.3 `src-tauri/src/svn/runner.rs`: `SvnRunner::run(args, cwd)` sin shell, `--non-interactive`, timeout, cancelación por kill, contraseña por stdin con `--password-from-stdin`, nunca en argv ni logs; entorno del hijo fijado según resultado de 2.6 — fuente: `design.md` §4.
  - [x] 2.4 `src-tauri/src/app/svn_locator.rs`: manual → PATH → `%ProgramFiles%\TortoiseSVN\bin` → SlikSVN → Apache; valida con `svn --version --quiet` y rechaza < 1.10 — fuente: `design.md` §4; auditor (CHANGES 1.10.0).
  - [x] 2.5 `src-tauri/tests/common/mod.rs`: helper que crea repo con `svnadmin create` + `file:///` en `tempfile`, localizando binarios con `svn_locator`; falla con mensaje claro si no hay svn — fuente: `design.md` §7; hoy svn fuera del PATH (research-log).
  - [x] 2.6 Experimento empírico de encoding: ruta con tildes/ñ/espacios y stderr de svn 1.14.2; decidir decodificación o variable de entorno del hijo y registrarlo en ADR-0004 — fuente: auditor (sin fuente documental, "verificar empíricamente").
  - [x] 2.7 `/adr-new` ADR-0004 (TLS, WC antigua, encoding).
  - [x] 2.8 pruebas unitarias — test-gen (comparación de versión 1.9/1.10/1.14, mapeo de códigos, sin contraseña en `SvnError`, kill por timeout).
  - [x] 2.9 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: locator encuentra SlikSVN 1.14.2 real y rechaza versión menor simulada; runner mata un proceso colgado por timeout; ninguna contraseña aparece en argv/`SvnError`; prueba con ruta con tildes en verde.
- Verificacion funcional: no aplica: capa Rust sin UI ni persistencia; la cubren pruebas de integración con svn real.
- Revision de planeacion: PASO

### Increment 3: info y status tipados — cubre spec [CA-4, CA-5]
- Justificacion / fuentes: lectura sin efectos antes de operaciones que mutan; `design.md` §4 (parsers `quick-xml` + serde).
- Pasos:
  - [x] 3.1 Agregar `quick-xml` con feature `serde` — fuente: `design.md` §4.
  - [x] 3.2 `src-tauri/src/svn/models.rs` y `parsers.rs` para `svn info --xml` y `svn status --xml` (con y sin `-u`) — fuente: `design.md` §4.
  - [x] 3.3 `InfoRequest`/`StatusRequest` que producen `Vec<OsString>`; prueba que fija la construcción — fuente: `design.md` §4.
  - [x] 3.4 Fixtures XML capturados de un repo real creado con el helper de 2.5 (modificado, sin versionar, añadido, borrado) — fuente: `design.md` §7 ("parsers con XML real").
  - [x] 3.5 pruebas unitarias e integración — test-gen (XML truncado, entradas desconocidas, rutas con tildes; happy path al final).
  - [x] 3.6 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: CA-4 y CA-5 contra una WC real; WC formato antiguo simulada produce el error normalizado de CA-16.
- Verificacion funcional: no aplica: capa Rust sin UI; verificada con repo real en integración.
- Revision de planeacion: PASO

### Increment 4: checkout, update, commit y cleanup — cubre spec [CA-6, CA-7, CA-8, CA-9, CA-14]
- Justificacion / fuentes: ciclo mínimo de trabajo; `design.md` §4 (gestor de operaciones, progreso); auditor (lock E155004).
- Pasos:
  - [x] 4.1 `src-tauri/src/svn/commands.rs`: `CheckoutRequest { url, dest: ScopedPath, revision, depth, ignore_externals }`, `UpdateRequest`, `CommitRequest`, `CleanupRequest` → `Vec<OsString>`; `--username` y contraseña por stdin — fuente: `design.md` §4; decisión de credenciales.
  - [x] 4.2 `src-tauri/src/svn/progress.rs`: parseo línea a línea de stdout de update/checkout, aislado — fuente: `design.md` §9 (riesgo "progreso no estructurado").
  - [x] 4.3 `src-tauri/src/app/operations.rs`: `OperationManager` con `HashMap<WcRoot, Mutex>`, ids de operación, cancelación por kill que deja la WC marcada como "requiere cleanup", `cleanup` sobre `ScopedPath` — fuente: `design.md` §4; auditor.
  - [x] 4.4 pruebas de integración contra repo real: checkout, update, commit, conflicto, cancelación a mitad de update + cleanup posterior, serialización por WC y paralelismo entre WC distintas — fuente: `design.md` §7.
  - [x] 4.5 pruebas unitarias — test-gen (args exactos, contraseña ausente de argv, mensaje de commit vacío/multilínea; happy path al final).
  - [x] 4.6 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`. `flow-test-gen` queda para el QA Increment (su trigger es ese, no el paso 4.4).
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: CA-6..CA-9 y CA-14 en verde con svn real; tras cancelar un update, `wc_cleanup` devuelve la WC a estado operable.
- Verificacion funcional: no aplica: capa Rust sin UI; la ejercitan pruebas de integración con repo real (la UI llega en I6).
- Revision de planeacion: PASO

### Increment 5: Commands Tauri, config y capabilities — cubre spec [CA-1, CA-3, CA-11]
- Justificacion / fuentes: única superficie hacia el frontend; `design.md` §5-§6.
- Pasos:
  - [x] 5.1 `src-tauri/src/config/`: `config.json` en `app_config_dir` (workspace root, ruta de svn, preferencias), sin secretos — fuente: `design.md` §6.
  - [x] 5.2 `src-tauri/src/commands/`: `workspace_get`, `workspace_set`, `svn_detect`, `svn_set_path`, `wc_info`, `wc_status`, `svn_checkout`, `wc_update`, `wc_commit`, `op_cancel`, `wc_cleanup`; eventos `svn://progress` y `svn://done`; todo destino vía `Workspace::resolve`; registrar en `lib.rs` y quitar `greet` — fuente: `design.md` §5; `src-tauri/src/lib.rs`.
  - [x] 5.3 Agregar `tauri-plugin-dialog`; `src-tauri/capabilities/default.json` solo `core:default` y `dialog` (se retira `opener:default` si ningún command lo usa) — fuente: `design.md` §3 última línea; `src-tauri/capabilities/default.json`.
  - [x] 5.4 `/adr-new` ADR-0003 (credenciales por UI y stdin, sin persistir).
  - [x] 5.5 pruebas unitarias — test-gen (config corrupta, ruta fuera del root rechazada en cada command, JSON sin campos secretos).
  - [x] 5.6 doc-check — `docs-rewrite` (actualiza `ARCHITECTURE.md` con las capas ya reales).
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: ningún command acepta una ruta sin pasar por `resolve`; `capabilities` sin `fs`; config reabre tras reinicio.
- Verificacion funcional: no aplica: sin UI hasta I6; los commands se ejercitan en pruebas y la UI los consume en I6.
- Revision de planeacion: PASO

### Increment 6: Shell Vue mínimo — cubre spec [CA-11, CA-12, CA-14, CA-15, CA-16]
- Justificacion / fuentes: `design.md` §0 y §8; `src/App.vue` es plantilla; `src/styles/tokens.css` ya existe (123 líneas).
- Pasos:
  - [x] 6.1 Script `"test": "vitest run"` en `package.json` — fuente: `package.json` (sin script `test`); `vitest.config.ts`.
  - [x] 6.2 `src/services/tauri.ts`: único punto de `invoke()` tipado y escucha de `svn://progress`/`svn://done` — fuente: `design.md` §2.
  - [x] 6.3 Stores Pinia `src/stores/workspace.ts` y `project.ts` — fuente: `design.md` §2.
  - [x] 6.4 Adaptar de DocuMalia `tokens.css`, `WindowTitleBar`, `BaseModal`, `ConfirmDialog`, `usePersistedPreference`, `useTheme`, `useFocusTrap` (copiar con criterio, sin dominio MaliAPI) — fuente: `design.md` §8; `theme-first` ("cero valores de identidad quemados").
  - [x] 6.5 Vistas `OnboardingView` (elegir Workspace Root con dialog, detectar/fijar svn, aviso de versión < 1.10) y `ProjectPanel` (info, estado, update, commit, cancelar, cleanup, formulario de credenciales, errores TLS/WC antigua con su guía); reemplazar `App.vue` — fuente: spec CA-12, CA-14..16.
  - [x] 6.6 pruebas Vitest de stores y servicio — test-gen (error de command, evento de progreso fuera de orden, credenciales no persistidas en el store; happy path al final); presentación UI exenta (`presentacion-ui`).
  - [x] 6.7 Verificación en navegador con Playwright sobre `vite dev` con `invoke` simulado — fuente: `skill bossdream-plan` (Verificacion funcional).
  - [x] 6.8 a11y de los modales y formulario (foco atrapado, etiquetas) — `a11y` MCP.
  - [x] 6.9 doc-check — `docs-rewrite`.
- Conexiones: `theme-first` (sección "Mini-pipeline de token: reusar antes de crear"), `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build` (`vue-tsc`), `format`, `theme-check`, `unit` (vitest), `mutation` (stryker).
- Criterio de aceptacion: CA-12 y CA-11 (el frontend no importa `fs` ni shell); `npm test` y `npm run build` en verde.
- Verificacion funcional: navegador (flujo feliz de onboarding y panel con `invoke` simulado, más validaciones: ruta inválida, svn ausente, auth requerida).
- Revision de planeacion: PASO

### Increment 7 (ultimo): QA Increment — cubre spec [CA-1..CA-18]
- Pasos:
  - [ ] 7.1 skill `qa-increment`: inventario de pruebas, QA Manager, `qa-run` en el modo de `bossdream.json > qa.mode` (`costoso`), Test Critic, re-verificación
- Conexiones: `qa-increment`, `qa-run`, `bossdream-qa-planner`, `bossdream-qa-auditor`, `flow-test-gen` (flujo checkout→modificar→update→commit y cancelación→cleanup)
- Pipeline del increment: `test-checks` en verde con veredicto `QA VERDICT: ACCEPTED`
- Criterio de aceptacion: veredicto ACCEPTED sin razones abiertas
- Verificacion funcional: la ejecuta `qa-run` (Playwright si hay UI, dbhub no aplica: sin base de datos)
- Revision de planeacion: PASO

## Supuestos (verificar en implementacion)
- supuesto — verificar: versiones de `tokio`, `quick-xml`, `tauri-plugin-dialog` compatibles con Tauri 2 y rustc 1.88; confirmar con context7 en el increment que las agrega.
- supuesto — verificar: `junction` creable en el test sin privilegios de administrador en Windows 11 (`mklink /J`).
- supuesto — verificar: Playwright puede correr sobre `vite dev` con `invoke` simulado; la ventana Tauri real queda para verificación manual.
- supuesto — verificar: `--password-from-stdin` combinado con `--non-interactive` en svn 1.14.2 (el auditor no halló doc en svnbook).
