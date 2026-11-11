# Plan — Fase 4: SVN avanzado y operaciones de archivo

> Producto de `/bossdream-plan`. Referencia: `spec.md` (QUE) y `design.md` (COMO, borrador v2 del 2026-10-23). **Prerrequisito: la Fase 3 implementada** (parser de externals, `remote_url`, opciones de red, credenciales de sesión, registro de repositorios). El Increment 1 lo verifica contra el código real. **v2:** incorpora la revisión adversarial (probada contra `svn` 1.14.2), el auditor de completitud, el explorador de skills y las decisiones del usuario del 2026-10-23.

## Razon de ser
Cubrir el uso diario de TortoiseSVN que falta: historial, diff, blame, deshacer, bloqueos, propiedades y operaciones de archivo que conservan la historia, más un Centro de cambios con commit selectivo.

## Justificacion
Core Tenet 1: todo lo hace `svn.exe`. Reglas duras: rutas por `Workspace::resolve`, sin `tauri-plugin-shell` hacia el frontend, solo Rust lanza `svn`. §58 prohíbe el `rename` del sistema sobre elementos versionados; §81 exige confirmación en lo destructivo. Decisiones en `design.md` §0.

## Flujo (que / por que)
Medir → fundaciones comunes que todo lo demás necesita (candado, tope de salida, nombres, token de confirmación, pruebas multiusuario) → pestañas y menú → operaciones de archivo (lo más peligroso), primero Rust y luego interfaz → lecturas (log, diff, blame) → escrituras menores (propiedades, locks) → commit selectivo y Centro de cambios → cleanup → documentación → QA. Rust antes de la interfaz que lo consume.

## Clasificacion
tipo: add-to-flow (reutiliza `OperationManager`, `wc_status_map`, `FileService`, Monaco, `CredentialsModal`, `runOperation`) y new (parsers, pestañas de vista, menú contextual, respaldo, commit selectivo) · complejidad: large

## Investigacion (research-log)
| Pregunta | Tool/agente | Hallazgo | Como informo el plan |
|---|---|---|---|
| ¿Dónde viven las pestañas y qué se persiste? | `config/ui.rs:48-53`, `app/ui_state.rs:14,137-155`, `stores/tabs.ts:79-81,112,118-126,236-252`, `TabContent.vue:12-16,33-34`, `TabBar.vue:202` | `snapshot()` envía todas las pestañas y Rust falla al deserializar un `TabKind` desconocido (se perdería el guardado de toda la sesión); `open` deduplica por `pathKey(path)`; `duplicate` copia solo `{kind,path,title}`; `TabContent` renderiza solo la activa y trata todo lo que no es `folder` como documento | I3: `svn_view` en la misma lista con `ephemeral`; `snapshot` filtra; identidad propia; store por pestaña |
| ¿Puede `Workspace::resolve` renombrar solo mayúsculas? | Revisión adversarial sobre `workspace.rs:74,76` (probado) | `resolve` canonicaliza (devuelve el nombre del disco) y con `allow_overwrite=false` da `DestinationExists`; `svn mv f.txt F.txt` sí funciona | I2: validador de nombres de hoja propio; destino = `padre.join(nombre)` |
| ¿`@` en el destino de `move`/`copy`? | Revisión adversarial (probado) | `svn mv 'r@s.txt@' 'u@v.txt@'` crea el archivo `u@v.txt@`; el destino no admite peg | I4: `peg_safe` solo en orígenes |
| ¿Qué opciones tiene `svn cleanup`? | `svn help cleanup` (probado) y el código fuente de 1.14.5 (`svn.c`, `cleanup-cmd.c`) | Solo `--remove-unversioned`, `--remove-ignored`, `--vacuum-pristines`, `--include-externals`, `-q`; no hay `--fix-timestamps` ni dry-run; sin opciones rompe bloqueos y arregla marcas de tiempo; con `--remove-*` no rompe bloqueos | CA-12 corregido; I17 |
| ¿`--remove-unversioned` borra una WC anidada? | Revisión adversarial (probado) | La borra entera con su `.svn`; `svn rm --force carpeta` también borra los no versionados | I5 e I17: vista previa con token, respaldo y bloqueo si hay WC anidada |
| ¿Sirve `wc_status_map` para decidir si algo está versionado? | `wc_status.rs:35-39,174,179-180,203,249-252` | Descarta las entradas `normal`, trunca a 20 000, corre con `ignored:true` y su clave de caché no incluye `ignored` | I4 decide con `svn info`/`svn status <ruta>`; I2 agrega `ignored` a la clave |
| ¿Qué lee hoy el parser de bloqueos? | `parsers.rs:115-129,189`, `models.rs:107-111` | Solo `owner` y `comment`; mezcla el bloqueo local con el remoto; los ajenos solo salen con `status -u` | I14 amplía el parser; decisión del usuario sobre cuándo consultar |
| ¿El runner limita `stdout`? | `runner.rs:158-174` | No: acumula todo en memoria | I2: `max_stdout` en `RunOptions` |
| ¿`blame --xml` trae el texto? | Revisión adversarial (probado) y svnbook | No; solo `line-number` y `commit`; un binario se detecta por `svn:mime-type` y `svn` responde con éxito y salida vacía | I12: texto por `svn cat` |
| ¿`log --search` y `--limit`? | Auditor de completitud (código de 1.14.5, [release notes 1.8](https://subversion.apache.org/docs/release-notes/1.8.html)) | La búsqueda se evalúa en el cliente de `svn` y `--limit` cuenta revisiones examinadas | I8: cursor por revisiones examinadas con búsqueda |
| ¿Qué contrato tiene el commit hoy? | `commands.rs:126-145`, `tests/svn_operations.rs:125-131,273-277`, `contract.rs:183,273`, `tauri.ts:143-146` | `CommitRequest.target` y `CommitArgs.path` los fijan pruebas y contrato; el modal solo pide usuario | I15: ampliación aditiva (`extra_paths`, `no_unlock`) |
| ¿Cómo falla un commit con padre nuevo no incluido? | Revisión adversarial (probado) | `E200009` | I15: clausura de padres y del par del `move` |
| ¿Funciona `createDiffEditor` con CSP y workers? | Revisión adversarial sobre `tauri.conf.json:24`, `documents/monaco/setup.ts:34-57` | Viable: `worker-src 'self'`, workers por `?worker`; el diff comparte el fragmento de Monaco (no es «su propio fragmento»); la configuración compartida es privada de `setup.ts`; modelos con URI distinta | I10 exporta/refactoriza la configuración; usa la prueba existente contra `ts.worker` (T-22) |
| ¿Soporta `ContextMenu.vue` submenús y foco? | `ContextMenu.vue:5-11,107-135` | Lista plana sin `aria-haspopup`, sin retorno de foco | I3 lo amplía; Ignorar usa un diálogo si no se justifica el submenú |
| ¿Las pruebas multiusuario existen? | `tests/common/mod.rs`, E2E `fixtures.ts` | `TestServer::start` configura un solo usuario sin `authz` ni hooks; la E2E no arranca `svnserve` | I2 agrega usuarios, `authz`, hooks y fixtures E2E; coordinado con `SVNSERVE_CONF` de la Fase 3 |
| ¿Qué choca con la Fase 3? | `plans/fase-3-marketplace/plan.md` (I10 paso 10.5) | La 3 afirma que el Marketplace no ofrece log ni diff | I9 reescribe esa prueba; las pestañas `svn_view` abiertas desde el Marketplace cambian de sección |
| ¿Skills aplicables? | `bossdream-document-explorer` | `test-gen`, `flow-test-gen`, `theme-first`, `docs-rewrite`, `adr-new`, `tech-debt`, `qa-*`, `test-checks`; `test-gen` excluye presentación, Monaco, contratos Tauri, mutación de Rust y rendimiento | Los candidatos sin skill son piezas de un solo uso (falso positivo); el cableado de commands se repite en las Fases 3 a 6 y se anota en `TECH_DEBT.md` como candidato a skill, sin crearla |

## Impacto cross-flow
| Flujo afectado | Verificado con | ¿Choca? | Mitigacion |
|---|---|---|---|
| `Tab`, `snapshot`, `normalize_tabs`, `TabBar`, `TabContent`, límite de 64 | ver investigación | Sí | I3 con pruebas de restauración de sesión antigua y de guardado con `svn_view` abiertas |
| `ContextMenu.vue` | lectura | Posible | I3 lo amplía sin cambiar las pruebas de pestañas |
| `CommitRequest`/`CommitArgs`, `ProjectPanel`, `project.ts`, `CommitModal` | ver investigación | Sí | I15 aditivo; corre `ProjectPanel.test.ts`, `project.test.ts`, `svn_operations.rs`, `contract.rs`, `contract.test.ts` |
| `OperationManager` y todas las operaciones de escritura (update, commit, cleanup, checkout) | `operations.rs:105-125,257-310` | Sí: hoy `acquire` bloquea la clave exacta y `update`/`commit`/`cleanup` no usan `try_lock_for_write` | I2: candado por raíz de copia para **todas**; una operación toma un candado; el mapa de candados se limpia |
| `StatusCache` / `wc_status_map` | `wc_status.rs:35-39,203` | Sí: la Fase 3 (I7) quiere sin ignorados y la 4 (I17) con ignorados | I2: `ignored` en `CacheKey` y `StatusKey`, una vez |
| `FileService` (renombrar, mover, borrar) | `files/mod.rs:272,281,292`, `edit.rs:99-104` | Sí | I4 las agrega aparte de `write_text`; `symlink_metadata` y `cloud_only` antes |
| Pestañas, favoritos y vistas con rutas | `tabs.ts` (sin remapeo) | Sí: rename/move/delete dejan rutas muertas y texto sin guardar huérfano | I4 comprueba dirty y remapea |
| Marketplace (Fase 3) | su plan | Sí: log/propiedades/locks sobre `Remote` | `SvnTarget::Remote` con `remote_url`; reescritura de la prueba 10.5 de la 3 |
| Cierre de ventana | `useWindowClose.ts:14-18`, `closing.rs` | Sí: la Fase 3 solo da un guard para sus descargas | I4 registra un `CloseGuard` para las operaciones de escritura de esta fase (no se asume uno general) |
| `documents/monaco/setup.ts`, `vite.config.ts` | `typescriptAlias.test.ts` | Posible | I10 prueba que `dist/assets` no trae `ts.worker` |
| E2E existentes | lectura | Posible | Cada increment de interfaz corre las suites que toca |

## Deuda tecnica (informativa, NO bloqueante)
| Ubicacion | Deuda | Impacto | Remediacion | Esfuerzo | ¿Se paga en este plan? |
|---|---|---|---|---|---|
| `operations.rs` T-7 | El candado cubre la clave exacta y no a todas las operaciones | Alto | Candado por raíz de copia en I2 | medium | **Sí** (I2) |
| `app/state.rs` T-3/T-19 | `AppState` sigue creciendo | Alto | `app/vcs/` con métodos finos | low | Parcial |
| `files/mod.rs` T-15 | Ventana entre validar y abrir | Medio | `revalidate` + `symlink_metadata` antes de cada operación destructiva | medium | Parcial |
| `TabBar.vue` T-31 | `aria-required-children` en el `tablist` | Bajo | Botón de nueva pestaña fuera del `tablist` | low | Sí (I3) |
| `stores/project.ts` T-8/T-25 | Dos caminos de estado SVN | Medio | No se toca | medium | No |
| Cableado de commands Tauri repetido | Registro, contrato y envoltorio se repiten en las Fases 3 a 6 | Medio | Candidato a skill; se evalúa con `tech-debt` al cierre | low | No |

## Decisiones (opcion elegida vs descartadas)
Ver `design.md` §0. Resumen: Monaco para el diff (descartado: interpretar el diff unificado); `svn_view` en la lista con `ephemeral` (descartado: persistirlas, y un store aparte, que rompe límite, orden y cierre); token de confirmación y respaldo propio en carpeta de la aplicación (descartado: confirmación booleana y la papelera de Windows, que exigiría una dependencia); candado por raíz de copia; destino sin `@`; valores por `-F`; `--search` con cursor por revisiones examinadas; bloqueos ajenos bajo demanda y en preflight (decisión del usuario); solo `svn:log` editable (decisión del usuario). ADR: `docs/adr/0015-vistas-svn-en-memoria-y-diff-con-monaco.md` (propuesto en I3; el número se reserva al implementar porque la Fase 3 puede crear otro).

## Increments

### Increment 1: Medir antes de construir — cubre spec [CA-2, CA-3, CA-6, CA-7, CA-8, CA-10, CA-11, CA-12]
- Justificacion / fuentes: regla de investigación (§130); la revisión ya probó varios comportamientos en 1.14.2 y aquí se repiten con el `svn` empaquetado y el mínimo, y se miden los que faltan.
- Pasos:
  - [ ] 1.1 **Prerrequisitos de la Fase 3** (`app/marketplace/externals.rs`, `remote_url`, opciones de red en `RunOptions`, credenciales de sesión, `marketplace_download`, `RepoEntry`): comprobarlos contra el código real y ajustar este plan — fuente: `plans/fase-3-marketplace/plan.md`; porque: se escribió antes de que existan.
  - [ ] 1.2 `plans/fase-4-svn-avanzado/medidas.md`: cada medición anota la **versión de `svn`** usada (empaquetada 1.14.5 y mínima 1.10) — fuente: `plans/fase-3-marketplace/medidas.md`; porque: evidencia reproducible.
  - [ ] 1.3 **M1, Monaco diff**: `createDiffEditor` en la ventana real con dos modelos: fragmento, workers, ausencia de `'unsafe-eval'` y de `ts.worker`, 5 MiB, teclado; «ignorar espacios»: `ignoreTrimWhitespace` frente a normalizar el texto — fuente: `documents/monaco/setup.ts`; porque: CA-7.
  - [ ] 1.4 **M2, salidas reales saneadas**: `log --xml` con y sin `-v` (copias, renombrados, mensajes con `<`, `&`, control y emoji, UTF-8 inválido), `log --search -l`, `blame --xml` (rango, binario por `svn:mime-type`, `eol-style=native`), `diff --summarize --xml`, `cat -r`, `lock`/`info`/`status -u` con bloqueo propio y ajeno, `proplist -v --xml` (valores base64), `propget`; fixtures en `src-tauri/tests/fixtures/` — fuente: `propuesta.md` §33, §60; porque: parsers con salida real.
  - [ ] 1.5 **M3, operaciones de archivo en Windows**: renombrar solo mayúsculas, mover entre copias y fuera del root, mover con cambios locales, borrar con y sin `--force`, carpeta con WC anidada, nombres reservados y con `@`, rutas de más de 260 caracteres, `add` recursivo, `copy` de un versionado, un archivo abierto sin compartir (comportamiento de OneDrive) y una unión de Windows dentro del root — fuente: `propuesta.md` §58; porque: CA-3.
  - [ ] 1.6 **M4, `cleanup`**: cada opción real en 1.14.5 y el comportamiento sin opciones; lista previa con `status --no-ignore`; WC anidada; qué hace `--remove-unversioned` con ella — fuente: `svn help cleanup`; porque: CA-12.
  - [ ] 1.7 **M5, `svn:log` y bloqueos con servidor**: `propset --revprop -r N svn:log` con y sin hook `pre-revprop-change`; `lock`/`unlock`/`--force` con dos usuarios y con acceso anónimo de escritura; error de cada caso — fuente: [svnbook](https://svnbook.red-bean.com/en/1.7/svn.ref.reposhooks.pre-revprop-change.html); porque: CA-6, CA-10.
  - [ ] 1.8 **M6, commit selectivo**: varias rutas y `--targets`, alta previa de no versionados, carpeta nueva con `--depth empty`, hijo con padre nuevo no incluido (`E200009`), par de `move`, elemento `missing`, rutas con espacios y `@`, bloqueo ajeno, conflicto presente, `status -v` para revisión mezclada — fuente: `svn help commit`; porque: CA-11.
  - [ ] 1.9 **M7, commit por hunks (§18)**: investigar vías viables y sus riesgos de pérdida de datos; el veredicto se documenta y **no se implementa** — fuente: documentación de TortoiseSVN; porque: la propuesta lo pide.
  - [ ] 1.10 **Puerta de decisión**: M1 fija «ignorar espacios»; M3 el flujo del renombrado de mayúsculas y el trato de OneDrive; M4 la vista previa del cleanup; M5 los mensajes de error. Si algo obliga a cambiar el alcance, **se detiene y se consulta al usuario**.
  - [ ] 1.11 pruebas unitarias — test-gen: no aplica, mediciones; fixtures y comportamientos pasan a los increments siguientes. doc-check — revisión manual (`docs-rewrite` no cubre `plans/`); fixtures saneados (rutas y UUID de ejemplo, sin nombres reales).
- Conexiones: `rules-comentarios` (scripts `.ps1`). Resto sin skill (mediciones de un solo uso).
- Pipeline del increment: `format`.
- Criterio de aceptacion: `medidas.md` M1 a M7 con versión de `svn`, veredictos y fixtures saneados.
- Verificacion funcional: datos y navegador — `svn.exe` real y ventana real (M1).
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 2: Fundaciones comunes (Rust) — cubre spec [CA-3, CA-5, CA-7, CA-10, CA-13]
- Justificacion / fuentes: lo que la revisión halló que todos los increments siguientes comparten.
- Pasos:
  - [ ] 2.1 **Candado por raíz de copia**: `OperationManager::acquire` toma el candado de `working_copy_root` para toda operación de escritura (update, commit, cleanup, checkout y las nuevas); una operación, un candado; los candados sin uso se purgan; las pruebas de T-7 (ancestro y descendiente) y `are_nested` se conservan — fuente: `operations.rs:105-125,257-310`, T-7; porque: el plan decía pagar T-7 y no era cierto.
  - [ ] 2.2 `RunOptions.max_stdout`: el runner mata el proceso y devuelve `OutputTooLarge` al pasarlo; probado con un archivo de 50 MB — fuente: `runner.rs:158-174`; porque: `svn cat` no se puede acotar.
  - [ ] 2.3 `ignored` en `CacheKey` y `StatusKey` de `StatusCache` con pruebas de que dos consultas distintas no se sirven mutuamente; el truncado se expone como `truncated` — fuente: `wc_status.rs:35-39,203`; porque: Fases 3, 4 y 17 piden valores distintos.
  - [ ] 2.4 `app/vcs/names.rs`: validador de nombre de hoja (reservados, punto o espacio final, `:`, `<>"|?*`, longitud, ruta total con umbral de M3) y `symlink_or_reparse(path)`/`is_cloud_only(path)` previos a operar — fuente: `workspace.rs:105-124`, `files/mod.rs:272,281,292`; porque: CA-3.
  - [ ] 2.5 `app/vcs/preview.rs`: `Preview { items, token }` con token = huella de la lista exacta; `verify(token, recomputed)`; respaldo en la carpeta de la aplicación (`backup.rs`: copia con ruta relativa, tope `MAX_BACKUP_BYTES`, limpieza por antigüedad, ubicación en el resultado) — fuente: `propuesta.md` §81; porque: CA-5. Sin dependencias nuevas.
  - [ ] 2.6 `app/vcs/props_req.rs`: **una** petición de propiedades (`Propset/Propget/Propdel/Proplist`) con valores por archivo temporal `-F` (patrón de `message_file.rs`, sin normalizar CRLF) — fuente: `message_file.rs`; porque: la usan I5 (ignorar) e I13; evita `argv` hostil.
  - [ ] 2.7 Pruebas multiusuario: `tests/common/mod.rs` gana varios usuarios, `authz-db` y hooks `.bat` (coordinado con `SVNSERVE_CONF` de la Fase 3), y los fixtures E2E arrancan `svnserve` — fuente: `tests/common/mod.rs:106-128`, `tests/e2e/real-app/fixtures.ts`; porque: locks, permisos y revprops.
  - [ ] 2.8 pruebas unitarias — `test-gen`: candado por raíz (dos operaciones anidadas y hermanas), `max_stdout`, clave de caché, validador de nombres, token (cambia si cambia la lista), respaldo (tope, limpieza, ruta relativa) — fuente: `tests/svn_operations.rs`, `tests/wc_status.rs`; porque: CA-3, CA-5.
  - [ ] 2.9 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (preview → token → ejecución), `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: las fundaciones existen y las operaciones actuales siguen pasando.
- Verificacion funcional: datos — pruebas de integración con `svnserve` multiusuario.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 3: Pestañas de vista SVN y menú contextual — cubre spec [CA-1, CA-2, CA-14]
- Justificacion / fuentes: todas las vistas son pestañas y todas las acciones salen del menú. `snapshot()` envía todas las pestañas y Rust falla ante un tipo desconocido (`tabs.ts:118-126`, `ui_state.rs:137-155`).
- Pasos:
  - [ ] 3.1 `Tab` (solo TypeScript) gana `kind: 'svn_view'`, `view` y `ephemeral`; `snapshot()` las filtra y fija `active_tab` en la persistida más cercana; `open` deduplica por la identidad (tipo, objetivo, parámetros); `duplicate` copia `view`; el límite de 64 cuenta el total; `TabBar` usa la lista única — fuente: `tabs.ts:79-126,236-252`, `TabBar.vue:202`; porque: CA-2.
  - [ ] 3.2 `TabContent.vue`: caso para `svn_view` con registro de componentes por tipo y caída segura; el estado de cada vista vive en un store por `tabId` que sobrevive al cambio de pestaña — fuente: `TabContent.vue:12-36`; porque: CA-2.
  - [ ] 3.3 `svn_view` participa en `setDirty`/`isDirty` y en el cierre de pestaña y de ventana — fuente: `tabs.ts:116,206,319-323`, `useWindowClose.ts:14-18`; porque: CA-2.
  - [ ] 3.4 `ContextMenu.vue`: retorno del foco, `aria-haspopup` y submenús por teclado solo si se justifican; `entryMenuItems(entry, svnState, selection)` pura, omite lo que no aplica; clic derecho, tecla de menú y Mays+F10; conectado a cuadrícula, lista, detalles y árbol con `useSelection` — fuente: `ContextMenu.vue:5-11,107-135`, `contextMenuPosition.ts`; porque: CA-1.
  - [ ] 3.5 Botón de nueva pestaña fuera del `tablist` (T-31) — fuente: `TECH_DEBT.md` T-31; porque: no heredar el defecto.
  - [ ] 3.6 ADR 0015 (propuesto): vistas SVN efímeras en la lista y diff con Monaco — fuente: `docs/adr/0000-template.md`; porque: decisión significativa.
  - [ ] 3.7 pruebas unitarias — `test-gen`: `snapshot` sin `svn_view` (y active reasignada), restauración de una sesión antigua, guardado con `svn_view` abiertas, identidad (log de X no activa la carpeta X), duplicado, límite, `entryMenuItems` por estado, foco y teclado, store que sobrevive al cambio; E2E (`vcs-tabs.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `adr-new`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: el menú existe con teclado y las pestañas `svn_view` no rompen la sesión ni sobreviven al reinicio.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 4: Operaciones de archivo (Rust) — cubre spec [CA-3, CA-13]
- Justificacion / fuentes: §58. El `rename` del sistema sobre un elemento versionado produce «borrado + alta».
- Pasos:
  - [ ] 4.1 `svn/`: `AddRequest` (`--parents`, `--depth` explícito), `DeleteRequest`, `MoveRequest`, `CopyRequest` (local→local; la Fase 5 usará `RepoCopyRequest` para URL), `MkdirRequest` — `peg_safe` **solo en orígenes**, el destino sin `@` — fuente: `commands.rs:84-180`, M3; porque: CA-3.
  - [ ] 4.2 `app/vcs/fileops.rs`: decide la vía por elemento con `svn info`/`svn status <ruta>` (un fallo de `svn` es error, nunca cae a la vía del sistema); versionado → `svn`; no versionado → `FileService` sobre el padre resuelto; nombres con el validador de I2; el destino de un renombrado es `padre.join(nombre)` y solo se acepta «ya existe» si es la misma entrada y difiere en mayúsculas; mover fuera del root, sobre sí mismo, a destino existente o a una raíz de copia ocupada se rechaza — fuente: `workspace.rs:74,76`; porque: CA-3.
  - [ ] 4.3 Comprobaciones previas: `symlink_or_reparse`, `is_cloud_only` (aviso), `svn add` de carpeta devuelve primero cuántos elementos agregaría (`--depth empty` + selección o confirmación con conteo y muestra) — fuente: I2, M3; porque: CA-3.
  - [ ] 4.4 Documentos abiertos: `fileops` recibe del frontend la lista de rutas abiertas y sucias bajo la ruta afectada y las incluye en la confirmación; Rust no ejecuta si hay sucias sin `confirmed_dirty` — fuente: `tabs.ts` (sin remapeo); porque: CA-3 (texto sin guardar huérfano).
  - [ ] 4.5 Toma el candado por raíz de copia y registra un `CloseGuard` propio (`registerCloseGuard`) mientras haya operaciones de escritura en curso — fuente: I2, `useWindowClose.ts:14-18`; porque: CA-13.
  - [ ] 4.6 Commands `vcs_new_file`, `vcs_mkdir`, `vcs_rename`, `vcs_move`, `vcs_copy`, `vcs_add_preview`, `vcs_add`; registro, `commands_registry.rs`, contrato y envoltorios — fuente: `commands/mod.rs`; porque: tipados.
  - [ ] 4.7 pruebas unitarias — `test-gen` y `flow-test-gen`: cada operación contra repositorio real en versionados y no versionados; reservados, `@` en el nombre, punto/espacio final, `:`, longitud, solo mayúsculas, duplicado, mover fuera del root, sobre sí mismo, a carpeta bloqueada, ancestro y descendiente, unión de Windows, `cloud_only`, `add` de carpeta grande, sucias bajo la ruta — fuente: `tests/svn_operations.rs`, `tests/files.rs`; porque: CA-3.
  - [ ] 4.8 doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: las operaciones conservan la historia en lo versionado y no pierden texto sin guardar.
- Verificacion funcional: datos — `svn log` y `svn status` reales tras cada operación.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 5: Vista previa, respaldo, revert e ignorar (Rust) — cubre spec [CA-4, CA-5, CA-13]
- Pasos:
  - [ ] 5.1 `RevertRequest` (rutas explícitas, `--depth` explícito), `DeleteRequest --force` y borrado de no versionados pasan por `preview` → token → respaldo → ejecución; la vista previa lista lo que se descartará con sus tamaños — fuente: I2, M3; porque: CA-5.
  - [ ] 5.2 Ejecutar recalcula la lista, compara el token y rechaza si cambió; antes de descartar ediciones guarda el respaldo y devuelve su ubicación; nunca toca no versionados en `revert` ni otras copias — fuente: `backup.rs`; porque: CA-5.
  - [ ] 5.3 `app/vcs/ignore.rs`: calcula el nuevo valor de `svn:ignore` (archivo, en su carpeta) o `svn:global-ignores` (extensión y patrón, en la carpeta elegida) sin duplicar y conservando saltos de línea; solo para no versionados o ya ignorados; «editar reglas» guarda el texto completo; el valor va por `-F` — fuente: `props_req.rs`, `propuesta.md` §59; porque: CA-4.
  - [ ] 5.4 Commands `vcs_revert_preview`, `vcs_revert`, `vcs_delete_preview`, `vcs_delete`, `vcs_ignore_get`, `vcs_ignore_set`; registro, contrato y envoltorios.
  - [ ] 5.5 pruebas unitarias — `test-gen`: revert sin token o con token viejo (rechazado), la lista cambia entre previa y ejecución (rechazado), carpeta con no versionados (intactos), respaldo creado y recuperable, `delete --force` con cambios locales, ignorar sin duplicar y con valores previos, valor con `-` inicial y saltos de línea, ignorar un versionado (rechazado) — fuente: `tests/svn_operations.rs`; porque: CA-4, CA-5. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: nada destructivo corre sin token válido y todo lo que descarta deja respaldo.
- Verificacion funcional: datos — recuperar un archivo desde el respaldo tras un revert.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 6: Operaciones de archivo, acciones simples (interfaz) — cubre spec [CA-1, CA-3, CA-14]
- Pasos:
  - [ ] 6.1 `services/vcsApi.ts` y `stores/vcs.ts` (envoltorios tipados, estado de la operación, errores, `createTicketGate`) — fuente: `services/filesApi.ts`; porque: patrón existente.
  - [ ] 6.2 Acciones del menú: Nuevo archivo/carpeta, Renombrar (F2 en línea), Duplicar, Eliminar (Supr), Agregar a SVN (con el conteo de I4) — fuente: `FileTree.vue`; porque: CA-3.
  - [ ] 6.3 Antes de renombrar o borrar con documentos abiertos o sucios bajo la ruta: diálogo con la lista; después se remapean pestañas, favoritos y vistas (o se cierran) y se refrescan todas las pestañas de las carpetas afectadas — fuente: `stores/tabs.ts`, `explorer.refreshStatus`; porque: CA-3.
  - [ ] 6.4 Errores clasificados en línea (nombre inválido, ya existe, bloqueado por otra operación, solo en la nube, enlace) — fuente: I2; porque: CA-3.
  - [ ] 6.5 E2E (`vcs-fileops.e2e.ts`): renombrar un versionado y comprobar con `svn log` que conserva la historia, solo mayúsculas, nuevo, duplicar, eliminar, con teclado — fuente: `tests/e2e/real-app/explorer.e2e.ts`; porque: CA-3, CA-14.
  - [ ] 6.6 pruebas unitarias — `test-gen`: store, F2 en línea, validación de nombres, remapeo, respuestas atrasadas, con Vitest; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`; auditoría con `bossdream-design-auditor`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se crean, renombran, duplican, borran y agregan elementos desde el menú sin perder historia ni texto.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 7: Acciones con diálogo — mover, ignorar y revertir (interfaz) — cubre spec [CA-4, CA-5, CA-14]
- Pasos:
  - [ ] 7.1 Mover: selector de carpeta destino dentro del root (árbol del workspace) con las mismas comprobaciones — fuente: `CheckoutForm.vue`, `FileTree.vue`; porque: CA-3.
  - [ ] 7.2 Ignorar: diálogo (`ChoiceDialog`) con las cuatro opciones o submenú si I3 lo habilitó; editor de reglas con vista previa de a qué afecta — fuente: `ChoiceDialog.vue`, `BaseModal.vue`; porque: CA-4.
  - [ ] 7.3 Confirmación destructiva con la **lista de la vista previa**, tamaños, ubicación del respaldo, foco inicial en «Cancelar» y botón con el verbo («Revertir 3 archivos»); usa el token — fuente: `ConfirmDialog.vue`; porque: CA-5.
  - [ ] 7.4 E2E (`vcs-destructive.e2e.ts`): revertir con confirmación y recuperar del respaldo, mover, ignorar — porque: CA-5.
  - [ ] 7.5 pruebas unitarias — `test-gen`: diálogos (foco, lista, teclado), editor de reglas, token vencido; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: revertir, mover e ignorar funcionan con confirmaciones atadas a la lista exacta.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 8: Log (Rust) — cubre spec [CA-6, CA-13]
- Pasos:
  - [ ] 8.1 Modelos y `parse_log` (`LogEntry`, `ChangedPath` con acción y `copyfrom`), que **degrada por entrada** ante caracteres de control o UTF-8 inválido; tope de mensaje — fuente: `parsers.rs:131-166`, M2; porque: CA-6.
  - [ ] 8.2 `LogRequest { target, peg, start, limit, stop_on_copy, search?, author?, range? }` **sin `-v`**; `range` tipado (`u64`, fecha o `HEAD`); `log -v -r N -l 1` para las rutas cambiadas de una revisión — fuente: M2; porque: acotar `stdout`.
  - [ ] 8.3 `app/vcs/log.rs`: `log_page(target, cursor)`; sin búsqueda el cursor es «última devuelta menos 1»; **con búsqueda avanza por revisiones examinadas** (inicio − `limit`) aunque la página traiga 0 coincidencias; tope `MAX_LOG_LOADED`; cancelación por vista; parseo en `spawn_blocking`; objetivo local o remoto (`remote_url` + opciones de red) — fuente: [release notes 1.8](https://subversion.apache.org/docs/release-notes/1.8.html), M2; porque: CA-6.
  - [ ] 8.4 `revprop_edit_log(target, revision, value, confirmed)`: **solo `svn:log`**, valor por `-F`, confirmación en Rust con el valor actual, error clasificado de hook ausente — fuente: M5; porque: CA-6, decisión del usuario.
  - [ ] 8.5 Commands `vcs_log_page`, `vcs_log_changed_paths`, `vcs_log_cancel`, `vcs_revprop_get`, `vcs_log_set_message`; registro, contrato y envoltorios.
  - [ ] 8.6 pruebas unitarias — `test-gen`: parser con la salida real (copias, renombrados, mensajes vacíos y multilínea, `<`, `&`, control, emoji, UTF-8 inválido), paginación sin repetir ni saltar (con y sin búsqueda, página con 0 coincidencias), 5 000+ revisiones, peg de ruta borrada, objetivo remoto con `svnserve`, cancelación, edición de `svn:log` con y sin hook y sin confirmación (rechazada) — fuente: `tests/svn_read.rs`; porque: CA-6. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (paginación), `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: el log pagina sin errores con y sin búsqueda en miles de revisiones.
- Verificacion funcional: datos — cotejar con `svn log` directo.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 9: Log (interfaz) — cubre spec [CA-1, CA-6, CA-13, CA-14]
- Pasos:
  - [ ] 9.1 Vista `svn_view` de log: lista virtualizada (revisión, autor, fecha, mensaje), siguiente página al llegar al final (también cuando una página de búsqueda devuelve 0), filtros de texto, autor y rango, «detener en copia», estados cargando/vacío/error/truncado — fuente: `ticketGate.ts`, `HexViewer.vue` (virtualización; `FileList.vue` no la tiene); porque: CA-6.
  - [ ] 9.2 Panel de detalle: mensaje completo y rutas cambiadas pedidas al abrir la revisión, todo escapado y acotado — fuente: Fase 3 I6 (`RemoteDetail`); porque: CA-13.
  - [ ] 9.3 Acciones **que ya existen**: comparar/ver revisión y blame quedan como ranuras vacías hasta I10 e I12 (cada uno agrega su acción); checkout/export reutilizan `marketplace_download` (una copia sin repositorio registrado ofrece registrarlo); copiar detalles; editar mensaje con la confirmación de I8 — fuente: Fase 3 I8/I10; porque: CA-6.
  - [ ] 9.4 Entradas «Historial» del menú contextual de archivo, carpeta y repositorio, y desde el Marketplace (una `svn_view` abierta desde allí cambia de sección); **reescribir la prueba de la Fase 3 (paso 10.5)** que afirma que el Marketplace no ofrece log — fuente: Fase 3 plan; porque: CA-14.
  - [ ] 9.5 E2E (`vcs-log.e2e.ts`): abrir, paginar, filtrar con búsqueda, seleccionar dos, copiar detalles, editar el mensaje (con y sin hook), con teclado — porque: CA-6, CA-14.
  - [ ] 9.6 pruebas unitarias — `test-gen`: paginación, filtros, selección múltiple, escape de bidi, errores, respuesta atrasada, volver a la pestaña sin llamar a `svn`, con Vitest y Stryker; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se navega el historial de un archivo y de un repositorio con las acciones disponibles.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 10: Diff — Rust y vista de texto — cubre spec [CA-7, CA-13, CA-14]
- Pasos:
  - [ ] 10.1 Rust: `CatRequest { target, revision }` (`cat -r N <objetivo>@`, **con `max_stdout`**) y comprobación de tamaño previa (`svn list --xml` para remotos, `metadata` para locales); `app/vcs/diff.rs` entrega cada lado acotado con huella, tipo y codificación; lectura Windows-1252 de respaldo con aviso; el lado «Working» se lee con `FileService` — fuente: I2, `files/text.rs:108-121`; porque: CA-7.
  - [ ] 10.2 Commands `vcs_diff_sides`; registro, contrato y envoltorios.
  - [ ] 10.3 Refactor de `documents/monaco/setup.ts`: exportar la configuración compartida (`configure`, `createEditor`) y un `createDiff(original, modified)` con URI distintas por modelo (`openedCount`) — fuente: Revisión adversarial sobre `setup.ts:34-57`; porque: hoy es privada.
  - [ ] 10.4 `components/vcs/DiffView.vue`: lado a lado e integrado, navegación por cambios con teclado, «ignorar espacios» según M1 con una frase que explica qué ignora, tema de los tokens; variantes local vs BASE, local vs HEAD (credenciales de la Fase 3), revisión A vs B y archivo vs archivo — fuente: `propuesta.md` §34; porque: CA-7. Se agrega la acción «Ver revisión»/«Comparar» al log (I9).
  - [ ] 10.5 Entradas «Diff» del menú; prueba de que `dist/assets` no contiene `ts.worker-*.js` (apoyada en `typescriptAlias.test.ts`) — fuente: T-22; porque: no inflar el instalador.
  - [ ] 10.6 E2E (`vcs-diff.e2e.ts`) y pruebas unitarias — `test-gen`: lados con distinta codificación, límite, huella, respuesta atrasada, `ignorar espacios`; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`; auditoría con `bossdream-design-auditor`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se comparan versiones de texto con una vista accesible y acotada.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 11: Diff — carpetas, binarios y límites — cubre spec [CA-7, CA-13]
- Pasos:
  - [ ] 11.1 `DiffSummarizeRequest` (`diff --summarize --xml -r A:B`) y `parse_diff_summary`; «carpeta vs carpeta» = copia de trabajo contra BASE/HEAD o repositorio contra repositorio (dos carpetas locales cualesquiera, fuera) — fuente: M2; porque: CA-7.
  - [ ] 11.2 Vista de lista de cambios de carpeta; cada archivo abre su diff (I10) — porque: CA-7.
  - [ ] 11.3 Binarios (tarjeta con tamaños y huella), lado mayor que `MAX_DIFF_BYTES` (aviso, sin cargar), texto no UTF-8 con aviso de codificación (no «binario») — fuente: I10; porque: CA-7.
  - [ ] 11.4 pruebas unitarias — `test-gen`: parser de resumen, carpeta con archivos añadidos/borrados/movidos, binarios, límite, archivo de 50 MB (no se carga); E2E (`vcs-diff-folder.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: carpetas, binarios y archivos grandes se tratan sin congelar la ventana.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 12: Blame — cubre spec [CA-8, CA-13, CA-14]
- Pasos:
  - [ ] 12.1 Rust: `BlameRequest { target, peg, range }` (`blame --xml -v`), `parse_blame`; el texto de cada línea sale de `svn cat` de la misma revisión y objetivo, alineado por número de línea y reconciliado con `svn:eol-style` y `svn:keywords`; líneas sin `<commit>` = cambio local; binario por `svn:mime-type` y por «salida vacía + aviso en `stderr`» sin depender del texto traducido; tope `MAX_BLAME_LINES` — fuente: M2, svnbook; porque: CA-8.
  - [ ] 12.2 Commands `vcs_blame`; registro, contrato y envoltorios.
  - [ ] 12.3 `BlameView.vue`: **tabla virtualizada accesible** (línea, autor, revisión, fecha, código), seleccionar una línea abre el log de esa revisión; colores de antigüedad con tokens y texto, no solo color — fuente: `HexViewer.vue`; porque: CA-8, CA-14 (un margen de Monaco no es legible con lector de pantalla).
  - [ ] 12.4 Entradas «Blame» del menú y del log (I9) — porque: CA-1.
  - [ ] 12.5 pruebas unitarias — `test-gen`: parser, líneas locales, `eol-style=native` y CR sueltos, archivos vacíos, rangos, binario (con éxito y salida vacía), límite, Vitest; E2E (`vcs-blame.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: blame correcto sobre un archivo con historia y rechazo claro de binarios.
- Verificacion funcional: navegador — ventana real vía CDP, cotejado con `svn blame`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 13: Propiedades — cubre spec [CA-9, CA-13, CA-14]
- Pasos:
  - [ ] 13.1 Rust: `parse_proplist` (valores `base64` degradados) y `app/vcs/props.rs` con validadores por propiedad conocida (`svn:executable` y `svn:needs-lock` = `*`, `svn:eol-style` enumerado, `svn:mime-type`, `svn:keywords`, `svn:externals` con una **función de validación por línea** separada del parser de la Fase 3, `svn:ignore`); tope `MAX_PROP_VALUE_BYTES`; `svn:mergeinfo` solo lectura; valores por `-F` — fuente: I2 (`props_req.rs`), Fase 3 I8; porque: CA-9.
  - [ ] 13.2 Recursivo: vista previa con **conteo y muestra**, token, confirmación en Rust; `svn:eol-style` recursivo rechaza binarios y archivos con fin de línea mezclado — fuente: I2; porque: CA-9.
  - [ ] 13.3 Commands `vcs_props_list`, `vcs_prop_set`, `vcs_prop_delete`, `vcs_props_preview`; registro, contrato y envoltorios.
  - [ ] 13.4 `PropsView.vue`: tabla, editor con validación por tipo, plantillas de valores, aviso de recursividad, valores escapados y truncados, objetivo local o remoto (solo lectura en remoto); entrada «Propiedades» del menú — fuente: `BaseModal.vue`; porque: CA-9, CA-1.
  - [ ] 13.5 pruebas unitarias — `test-gen`: cada validador (válido e inválido), valor enorme, bidi, valor que empieza por `-` o con saltos de línea, base64, `-R` sin token (rechazado), `eol-style` sobre binario (rechazado), `svn:mergeinfo` (rechazado), Vitest; E2E (`vcs-props.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se ven y editan propiedades con validación y sin riesgo de valores hostiles.
- Verificacion funcional: navegador — ventana real vía CDP, cotejado con `svn proplist`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 14: Locks — cubre spec [CA-10, CA-13, CA-14]
- Pasos:
  - [ ] 14.1 Parser: `RawLock` y `StatusLock` ganan `token`, `created` y `origin` (local o servidor); separar el bloqueo local del remoto (hoy `lock.or(remote_lock)` los mezcla) — fuente: `parsers.rs:115-129,189`, `models.rs:107-111`; porque: CA-10.
  - [ ] 14.2 `LockRequest` (`lock -m`), `UnlockRequest`, `--force` solo con confirmación en Rust que recibe propietario, comentario y fecha del bloqueo ajeno; objetivos local y URL; error de servidor anónimo clasificado — fuente: M5; porque: CA-10.
  - [ ] 14.3 `locks_remote(wc_root)`: `svn status -u` (red y credenciales de la Fase 3) **bajo demanda**, también usado por el preflight del commit (I15); el explorador muestra solo el propio (`K`) salvo tras «Comprobar servidor» — decisión del usuario; porque: CA-10.
  - [ ] 14.4 Commands `vcs_lock`, `vcs_unlock`, `vcs_locks_remote`; registro, contrato y envoltorios.
  - [ ] 14.5 Interfaz: acciones Lock/Unlock/Robar en el menú, diálogo con comentario, distintivo propio/ajeno con forma y texto, indicador de `needs-lock` y botón «Comprobar servidor» — fuente: `SvnStateBadge.vue`; porque: CA-10.
  - [ ] 14.6 pruebas unitarias — `test-gen`: bloquear, desbloquear, robar con y sin confirmación (`svnserve` con dos usuarios), `needs-lock` y solo lectura, URL, anónimo de escritura, parser (local frente a servidor); Vitest; E2E (`vcs-locks.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: bloqueos propios visibles siempre, ajenos bajo demanda y robar con confirmación informada.
- Verificacion funcional: navegador — ventana real vía CDP con dos usuarios.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 15: Commit selectivo y preflight (Rust) — cubre spec [CA-11, CA-13]
- Pasos:
  - [ ] 15.1 Ampliación **aditiva**: `CommitRequest` conserva `target` y gana `extra_paths: Vec<PathBuf>` y `no_unlock` (`#[serde(default)]`); `CommitArgs` igual; `--targets` en archivo temporal si son muchas — fuente: `commands.rs:126-145`, `message_file.rs`, `svn_operations.rs:125-131,273-277`, `contract.rs:183,273`, `tauri.ts:143-146`; porque: no romper `ProjectPanel`, `project.ts` ni el contrato.
  - [ ] 15.2 `commit_preflight(targets)`: **clausura** (padres nuevos no incluidos, par borrado+alta del `move`, carpeta seleccionada = solo lo seleccionado de dentro o `--depth empty` si es nueva o solo cambia sus propiedades), conflictos presentes, bloqueos de otros (`status -u`, I14), revisión mezclada (`status -v`, solo aquí, con tope), elementos que ya no existen — fuente: M6; porque: CA-11.
  - [ ] 15.3 Alta previa de los no versionados elegidos (`add --parents`, carpetas con `--depth empty`) dentro de la misma operación y bajo el candado de la raíz — fuente: M6; porque: CA-11.
  - [ ] 15.4 Historial de mensajes y plantillas: `config.json` gana `messages { history, templates }` con `lenient` y copia de seguridad si no parsea; `MESSAGE_HISTORY` 50; opción de no recordar y de borrar; las plantillas las crea y edita el usuario — fuente: `config/mod.rs`; porque: CA-11.
  - [ ] 15.5 Commands `vcs_commit_preflight` y extensión de `wc_commit`; registro, contrato y envoltorios.
  - [ ] 15.6 pruebas unitarias — `test-gen` y `flow-test-gen`: archivo, carpeta, selección mezclada con no versionados, padre nuevo no incluido, par de `move`, `missing`, conflicto, bloqueo ajeno, revisión mezclada, rutas con espacios y `@`, más rutas que el límite de línea, cancelación; **compatibilidad**: `ProjectPanel.test.ts`, `project.test.ts`, `tests/svn_operations.rs`, `contract.rs`, `contract.test.ts` sin cambios; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (selección → preflight → commit → refresco), `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: se confirma solo lo seleccionado con la clausura correcta y el panel de proyecto no cambia.
- Verificacion funcional: datos — `svn log -v` real tras cada commit.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 16: Centro de cambios (interfaz) — cubre spec [CA-11, CA-14]
- Pasos:
  - [ ] 16.1 Vista `svn_view` «Cambios»: grupos (modificados, agregados, eliminados, **faltantes**, no versionados, conflictos) desde `wc_status_map` con aviso de truncado; casillas por elemento y grupo; los auxiliares de un conflicto no se ofrecen para agregar — fuente: `StatusTable.vue`, `wc_status.rs`; porque: CA-11.
  - [ ] 16.2 Acciones por elemento (abrir, editar, diff, revertir, eliminar, agregar, ignorar, historial, propiedades); «resolver» solo informa hasta la Fase 6; punto de entrada del Centro (menú de carpeta y `WcHeader`) — fuente: `entryMenuItems`; porque: CA-11, CA-1.
  - [ ] 16.3 Diálogo de commit rediseñado: selección visible, advertencias y clausura del preflight con casillas para incluir lo requerido, plantillas, historial, `--no-unlock`, usuario y contraseña como hoy — fuente: `CommitModal.vue` (solo pide usuario); porque: CA-11.
  - [ ] 16.4 E2E (`vcs-changes.e2e.ts`): seleccionar parte de los cambios, ver la clausura, hacer commit y comprobar con `svn log -v`; con teclado — porque: CA-11, CA-14.
  - [ ] 16.5 pruebas unitarias — `test-gen` y `flow-test-gen`: agrupación, selección por grupo, truncado, clausura, plantillas e historial, respuesta atrasada, con Vitest y Stryker; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se hace commit de una selección con advertencias previas.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 17: Cleanup avanzado — cubre spec [CA-12, CA-13, CA-14]
- Pasos:
  - [ ] 17.1 `CleanupRequest` gana `remove_unversioned`, `remove_ignored`, `vacuum_pristines`, `include_externals` (valores por defecto = comportamiento actual); **dos invocaciones distintas**: base y de borrado — fuente: `commands.rs:147-156`, M4; porque: CA-12.
  - [ ] 17.2 `cleanup_preview(path, options)` desde `svn status --no-ignore` (`?` y `I`) con `ignored=true` (clave de caché de I2); si el mapa se truncó, las opciones `--remove-*` no se ofrecen; si la lista incluye una copia anidada (`.svn`/`_svn`), `--remove-unversioned` se bloquea con el motivo; token y respaldo cuando es posible — fuente: I2, M4; porque: CA-12.
  - [ ] 17.3 Commands `wc_cleanup` extendido y `vcs_cleanup_preview`; contrato y envoltorios; interfaz: diálogo con las opciones reales, explicación del cleanup base, vista previa y confirmación; `wc_needs_cleanup` se mantiene; entrada «Cleanup» del menú — fuente: `ProjectPanel.vue`; porque: CA-12, CA-1.
  - [ ] 17.4 pruebas unitarias — `test-gen`: cada opción contra una copia real (con no versionados, ignorados, externals y una WC anidada), sin token (rechazado), mapa truncado, cancelación, copia bloqueada; Vitest; E2E (`vcs-cleanup.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: el cleanup avanzado muestra lo que borrará y no actúa sin token ni con copias anidadas.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 18: Documentación — cubre spec [CA-16]
- Pasos:
  - [ ] 18.1 Crear `docs/vcs-operations.md` (menú, pestañas efímeras, operaciones de archivo y su semántica SVN, respaldo y token, log y su cursor, diff y «ignorar espacios», blame, propiedades, locks y su consulta, cambios y commit, cleanup real, límites, veredicto del commit por hunks) con símbolos reales — fuente: `docs/marketplace.md` (formato); porque: CA-16.
  - [ ] 18.2 Actualizar `docs/svn-integration.md`, `security.md`, `testing.md`, `ARCHITECTURE.md`, `editors.md` y `roadmap.md`; ADR 0015 a `accepted`; deuda a `TECH_DEBT.md` (incluido el cableado repetido); `docs-rewrite --check` — porque: CA-16.
  - [ ] 18.3 pruebas unitarias — `test-gen`: no aplica; doc-check — `docs-rewrite`.
- Conexiones: `docs-rewrite`, `adr-new`, `tech-debt`.
- Pipeline del increment: `format`.
- Criterio de aceptacion: documentación coherente con el código y ADR aceptado.
- Verificacion funcional: no aplica: solo documentación; se cotejan afirmaciones con el código.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 19: QA Increment — cubre spec [CA-15]
- Pasos:
  - [ ] 19.1 `qa-increment` (modo de `bossdream.json > qa.mode`): Test Inventory con `bossdream-qa-gatekeeper`; `qa-run` con auditor adversarial y flow-breaker (destructivas con token, paginación del log, selección de commit, clausura) — fuente: skills `qa-increment`, `qa-run`, `test-checks`; porque: veredicto independiente.
  - [ ] 19.2 `test-checks`: `cargo check`, `cargo test`, `npm test`, `npm run build`, mutación de Rust y frontend sobre lo nuevo, E2E de las Fases 2A a 4 sin regresiones, `tauri build` — fuente: `pipeline.json`, `stryker.config.json`; porque: CA-15.
  - [ ] 19.3 Corregir hallazgos hasta ACCEPTED y marcar cada CA con `[x]`/`[~]` y motivo — fuente: cierre de la 2B; porque: honestidad.
  - [ ] 19.4 pruebas unitarias — `test-gen`: las que pida el QA; doc-check — `docs-rewrite`.
- Conexiones: `qa-increment`, `qa-run`, `test-checks`, `flow-test-gen`, `docs-rewrite`.
- Pipeline del increment: todos los gates de `completion.json`.
- Criterio de aceptacion: QA Increment ACCEPTED con evidencia.
- Verificacion funcional: navegador — E2E de la fase sobre el ejecutable de depuración y el de release.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

## Revision adversarial
Revisión de un subagente `general-purpose` (probada con `svn` 1.14.2), `bossdream-completeness-auditor` y `bossdream-document-explorer`. Resumen de lo aplicado: bloqueantes (renombrar mayúsculas, `@` en el destino, `--fix-timestamps` inexistente, borrado de WC anidada, ubicación de `svn_view`, confirmación repetible, respaldo) → I2, I3, I4, I5, I17 y CA-3, CA-5, CA-12; importantes (decisión versionado/no, parser de locks, tope de `stdout`, blame sin texto, `--search`, `-v` por página, codificación, enlaces y OneDrive, documentos abiertos, candado, `add` recursivo, valores por `argv`, `propset -R`, clausura del commit, revisión mezclada, truncado del cleanup, clave de caché) → I2 a I17; división de I3, I4, I7 e I11 originales en los increments 4 a 7 y 15 a 16; compatibilidad aditiva de `CommitRequest`; decisiones del usuario (bloqueos ajenos, `svn:log`). Pendiente de lectura del usuario: `design.md` completo.
