# Plan — Fase 5: Branching

> Producto de `/bossdream-plan`. Referencia: `spec.md` (QUE) y `design.md` (COMO, borrador v2 del 2026-10-23). **Prerrequisitos: las Fases 3 y 4 implementadas** (repositorios, `remote_url`, opciones de red y credenciales de la 3; log, pestañas `svn_view`, menú contextual, candado por raíz, preflight y commit selectivo de la 4). El Increment 1 lo verifica contra el código real. **v2:** incorpora la revisión adversarial (probada contra `svn` 1.14.2), el auditor de completitud, el explorador de skills y las decisiones del usuario.

## Razon de ser
Cerrar el trabajo en ramas: crear ramas y tags, cambiar de rama, fusionar con vista previa, revertir una revisión, ver qué falta por fusionar y entender el repositorio con un gráfico, sin que Subversion resuelva conflictos a espaldas del usuario.

## Justificacion
Core Tenet 1: `svn copy`, `switch`, `merge`, `mergeinfo` y `log`. Reglas duras: rutas por `Workspace::resolve`, URL armadas solo en Rust, confirmaciones exigidas en Rust, sin `tauri-plugin-shell` hacia el frontend. Decisiones en `design.md` §0.

## Flujo (que / por que)
Medir operaciones y, por separado, el gráfico (el generador de datos es lento) → resolución pospuesta, `RepoRef` y bloqueo de repositorio, que todo lo demás necesita → clasificación → switch (antes de branch/tag, que puede encadenarlo) → branch/tag → merge (peticiones y vista previa, ejecución y resultado, interfaz) → revertir revisión → mergeinfo → gráfico en cuatro cortes → documentación → QA.

## Clasificacion
tipo: add-to-flow (log y commit de la 4, repositorios de la 3, `WcHeader` de la 2A, `update` de la 1) y new (branch/tag, switch, merge, mergeinfo, gráfico) · complejidad: large

## Investigacion (research-log)
| Pregunta | Tool/agente | Hallazgo | Como informo el plan |
|---|---|---|---|
| ¿`--non-interactive` resuelve conflictos solo? | Revisión adversarial (probado en 1.14.2), [release notes 1.10](https://subversion.apache.org/docs/release-notes/1.10.html), `runner.rs:85`, `commands.rs:116-123` | Desde 1.10 `--non-interactive` implica `--accept recommended`; el update de la Fase 1 ya autoresolvió un conflicto de árbol | I3: `--accept postpone` explícito (decisión del usuario) |
| ¿Qué hace `svn merge` con una copia de revisión mezclada? | Revisión adversarial (probado) y svnbook | `E195020 Cannot merge into mixed-revision working copy`; no admite confirmación; `--allow-mixed-revisions` está desaconsejado; `merge --dry-run` también falla; `svnversion` no está en `.tools` | CA-6: bloqueo con «Actualizar primero»; la mezcla se detecta con el propio `--dry-run` |
| ¿El modo automático tiene precondiciones duras? | Auditor de completitud (help de `merge` en 1.14.5, svnbook «Reintegrating a Branch») | Una reintegración exige copia sin revisión mezclada, sin cambios locales y sin subárboles con switch | CA-6: rechazo duro en automático; recomendación en rango y dos árboles |
| ¿Cómo se ve la salida de `merge`/`switch`? | Revisión adversarial (probado), `progress.rs:99-120` | Un conflicto de árbol sale como `   C ruta` (columna 3) y `parse_update_item` la descarta (`code == b' '` → `None`); `Skipped`, `--- Merging` y `Summary of conflicts:` caen en `Other`; el resumen cambia de formato; hay `\r` embebido | I8: parsers propios y variantes de `ProgressAction` con contrato actualizado |
| ¿Un merge con omitidos registra mergeinfo? | Revisión adversarial (probado) | Con una ruta obstruida, el merge omite el archivo pero registra la revisión como fusionada; el código de salida es 0 también con conflictos | CA-7: resultado honesto |
| ¿Qué pasa con `svn copy` a un destino existente? | Revisión adversarial (probado) y svnbook | El origen se crea **dentro** del destino y el comando termina con éxito | I6: solo `NotFound` autoriza; verificación con `svn ls` después |
| ¿`copy -r N` sobre rutas borradas o recreadas? | Revisión adversarial (probado) | `E160013` con peg vacío (resuelve a HEAD); con `URL@N` funciona | I6: peg `URL@N` |
| ¿Qué tiene `RepoEntry`? | Fase 3 plan | Sin UUID ni raíz real; `remote_url` rechaza salir de la raíz registrada | I3: `RepoRef`; la Fase 3 guarda UUID y raíz al probar la conexión (se verifica en I1) |
| ¿Qué `CopyRequest` existe? | Fase 4 plan (I4) | La Fase 4 define `CopyRequest` local→local | I6: `RepoCopyRequest` para URL→URL y copia de trabajo→URL |
| ¿`guarded` sirve para operaciones de repositorio? | `operations.rs:257-290` | Exige `ScopedPath` y `lock_working_copy`; `StaleStatus` necesita destino | I3: variante sin `ScopedPath`, clave `repo:<uuid>:<destino>` |
| ¿`svn mergeinfo` tiene `--xml`? | Revisión adversarial (probado), auditor de completitud (`svn.c` 1.14.5) | No; `--log` imprime texto; `--depth` por defecto `empty` | I12: parsear solo las líneas `rN` |
| ¿`svn switch` tiene vista previa? | Revisión adversarial (probado) | No hay `--dry-run`; con cambios locales termina con exit 0 y `C` | I5: la interfaz lo dice; confirmación de `--ignore-ancestry` |
| ¿`svn copy --pin-externals`? | Auditor de completitud (`svn.c` 1.14.5) | Fija externals flotantes a su revisión actual; recomendado al crear tags | Decisión del usuario: casilla, activada en tags |
| ¿Cómo se identifica una rama renombrada en el log? | Revisión adversarial (probado) | `D /branches/b1` + `A /branches/b1-renamed copyfrom /branches/b1@10` en la misma revisión | I13: identidad (ruta, alta) y regla de renombrado |
| ¿Cuánto cuesta el log completo? | Revisión adversarial (medido) y [TortoiseSVN](https://tortoisesvn.net/docs/release/TortoiseSVN_en/tsvn-dug-revgraph.html) | 6 787 revisiones con 2 rutas: 1,3 s y 1,7 MB; ~13 MB y ~10 s extrapolado a 50 000, mejor caso; el generador `svnadmin load` va a ~11 rev/s (50 000 ≈ 75 min o más); TortoiseSVN usa caché y puede tardar minutos | I2 mide con rutas por commit realistas y red; el generador se hace aparte y se cachea fuera de CI |
| ¿Cómo se deduce hoy la rama? | `WcHeader.vue:4,19`, `folderPaths.ts` (`branchLabel`), `models.rs:93-105` | Heurística en TypeScript; `WcHeader` solo tiene `InfoEntry.relative_url` | I4: `classify(uuid, ruta)` por UUID con layout por defecto si no hay registro |
| ¿Hay biblioteca para pan y zoom? | `package.json` | Sin dependencia de gráficos | I15: transformación SVG propia; si no basta, se consulta antes de agregar una |
| ¿Skills aplicables? | `bossdream-document-explorer` | Ver `Conexiones` | Sin skill para el gráfico, la interfaz ni el cableado (piezas de un solo uso) |

## Impacto cross-flow
| Flujo afectado | Verificado con | ¿Choca? | Mitigacion |
|---|---|---|---|
| `update` de la Fase 1 y su progreso | `commands.rs:116-123`, `progress.rs` | Sí: gana `--accept postpone` y cambia el conteo de conflictos | I3 ajusta `UpdateRequest`, sus pruebas y `ProjectPanel` |
| `ProgressAction`, contrato Rust/TS | `progress.rs`, `contract.json`, `contract.test.ts` | Sí: variantes nuevas | I8 actualiza el contrato en el mismo paso |
| `WcHeader` / `branchLabel` | `WcHeader.vue:4,19` | Sí | I4 reemplaza manteniendo la salida por defecto |
| `RepoEntry` y formulario (Fase 3) | su plan | Sí: `layout` y UUID/raíz | I3 e I4 con `#[serde(default)]` y prueba de configuración antigua |
| `commit_preflight` (Fase 4) | su plan | Sí: aviso nuevo | I4 lo extiende |
| Log (4) y Marketplace (3) | sus planes | Sí: acciones nuevas | I7, I10 e I16 agregan entradas; corren sus suites |
| Candado por raíz (Fase 4 I2) | su plan | Sí | switch, merge y copia WC→URL lo toman; las de repositorio usan la clave de repositorio |
| `StatusCache` | `wc_status.rs` | Sí | switch y merge invalidan con `StaleStatus` |
| Conflictos (Fase 6) | su plan | Sí | Esta fase solo cuenta y lista; la 6 resuelve |
| Cierre de ventana | `useWindowClose.ts:14-18` | Sí | `CloseGuard` propio para operaciones largas (no se asume uno general de la 3) |
| Rendimiento del WebView | `vite.config.ts` | Posible | I15 virtualiza y mide con E2E de rendimiento |

## Deuda tecnica (informativa, NO bloqueante)
| Ubicacion | Deuda | Impacto | Remediacion | Esfuerzo | ¿Se paga en este plan? |
|---|---|---|---|---|---|
| `folderPaths.ts` `branchLabel` | Heurística local de rama | Medio | `classify` en Rust como única fuente | low | Sí (I4) |
| `progress.rs` `parse_update_item` | No reconoce conflictos de árbol | Medio | Parsers propios de merge/switch (I8) y recuento por `status` | medium | Sí |
| `app/state.rs` T-3/T-19 | `AppState` crece | Alto | `app/branching/` con métodos finos | low | Parcial |
| `stores/project.ts` T-8/T-25 | Dos caminos de estado | Medio | No se toca | medium | No |

## Decisiones (opcion elegida vs descartadas)
Ver `design.md` §0. Resumen: gráfico SVG propio con lista accesible (descartado: librería de grafos y árbol simplificado); fusiones del gráfico bajo demanda (descartado: flechas para todo el repositorio); merge automático como tercer modo con precondiciones duras (descartado: asistente propio de reintegración y `--allow-mixed-revisions`); `classify(uuid, ruta)` en Rust; `--accept postpone` explícito (descartado: dejar la recomendación de Subversion); destino de `copy` comprobado por `NotFound`; `--pin-externals` en tags. ADR: `docs/adr/0016-ramas-fusion-y-grafico-de-revisiones.md` (propuesto en I4; el número se reserva al implementar).

## Increments

### Increment 1: Medir operaciones — cubre spec [CA-3, CA-4, CA-5, CA-6, CA-7, CA-9]
- Justificacion / fuentes: regla de investigación (§130); la revisión probó varios comportamientos en 1.14.2 y aquí se repiten con el `svn` empaquetado y el mínimo.
- Pasos:
  - [ ] 1.1 **Prerrequisitos**: comprobar en el código real lo que promete la Fase 3 (`RepoEntry` con UUID y raíz, `remote_url`, opciones de red) y la 4 (`SvnTarget`, `log_page`, `svn_view`, `commit_preflight`, candado por raíz); si falta o cambió algo, se ajusta este plan — fuente: planes 3 y 4; porque: se escribió antes de que existan.
  - [ ] 1.2 `plans/fase-5-branching/medidas.md`: cada medición anota la **versión de `svn`** (empaquetada y mínima) — fuente: planes anteriores; porque: evidencia reproducible.
  - [ ] 1.3 **M1, `update`/`switch`/`merge` con `--accept`**: qué autoresuelve cada uno con `--non-interactive` sin `--accept` y con `--accept postpone`; salida literal con `\r` y «Searching tree conflict details» — fuente: [release notes 1.10](https://subversion.apache.org/docs/release-notes/1.10.html); porque: CA-3.
  - [ ] 1.4 **M2, `copy`**: URL→URL con destino nuevo y existente, `--parents`, `URL@N` con ruta borrada y recreada, copia de trabajo→URL con cambios locales y mixta, otro repositorio, mensaje vacío, `--pin-externals`, `--ignore-externals`; códigos de error (`NotFound`) — fuente: svnbook `svn copy`; porque: CA-4.
  - [ ] 1.5 **M3, `switch`**: entre ramas, a otro repositorio (`E195012`/`E170009`), con cambios locales, `--set-depth`, `--ignore-ancestry`, externals, obstrucciones (`--force`), revisiones mixtas — fuente: svnbook `svn switch`; porque: CA-5.
  - [ ] 1.6 **M4, `merge`**: rango, varios rangos, dos árboles, automático (sincronizar y reintegrar), `--dry-run` (salida literal; confirmar que no modifica nada; `E195020`), `--record-only`, `--ignore-ancestry`, inverso (`-c -N`), conflictos de texto, propiedades y árbol, **rutas omitidas por obstrucción** (y el mergeinfo que registran), cambios locales, subcarpeta como objetivo, **cancelación a mitad** (estado de la copia), origen de otro repositorio, `Summary of conflicts` — fuente: svnbook `svn merge`; porque: CA-6, CA-7.
  - [ ] 1.7 **M5, `mergeinfo`**: `--show-revs merged|eligible` (sin `--xml`), con `--depth infinity`, rangos no contiguos, rama borrada con `URL@rev`, origen sin relación; `svn log -r N --xml` para el mensaje — fuente: `svn help mergeinfo`; porque: CA-9.
  - [ ] 1.8 **Puerta de decisión**: M1 confirma las banderas de `update`/`switch`/`merge`; M4 fija las precondiciones y qué hace cancelar; si algo obliga a cambiar el alcance, **se detiene y se consulta al usuario**.
  - [ ] 1.9 pruebas unitarias — test-gen: no aplica, mediciones; fixtures saneados (rutas y UUID de ejemplo) y comportamientos pasan a los increments siguientes. doc-check — revisión manual (`docs-rewrite` no cubre `plans/`).
- Conexiones: `rules-comentarios` (scripts `.ps1`). Resto sin skill (mediciones de un solo uso).
- Pipeline del increment: `format`.
- Criterio de aceptacion: `medidas.md` M1 a M5 con versión de `svn`, veredictos y fixtures saneados.
- Verificacion funcional: datos — `svn.exe` real contra `svnserve` y `file:///`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 2: Medir el gráfico — cubre spec [CA-10]
- Justificacion / fuentes: el gráfico depende de cuánto cuesta el log y de cómo se identifican las ramas; el generador de datos es lento, por eso va aparte.
- Pasos:
  - [ ] 2.1 **M6, generador**: script que crea un repositorio sintético con ramas, tags, borrados, renombrados, recreaciones y **muchos tags**, con 5 a 50 rutas por commit; `svnadmin load --no-flush-to-disk`; costo declarado (≈11 rev/s en esta máquina: 50 000 ≈ 75 min o más) y repositorio cacheado **fuera de CI** — fuente: Revisión adversarial; porque: CA-10.
  - [ ] 2.2 **M7, costo del log**: `log -q -v --xml` completo y por tramos de 500/1 000/2 000 (tiempo, memoria, tamaño) por `file:///` y por `svnserve`; `--limit` y `-r` hacia atrás; forma de `copyfrom` y de los borrados — fuente: M7 de la revisión; porque: fija `GRAPH_PAGE`, `GRAPH_PAGE_TIMEOUT` y los topes.
  - [ ] 2.3 **M8, método alternativo**: listar `branches/` y `tags/` con `svn ls` y pedir por cada rama `log -v -q --stop-on-copy -l`, frente al escaneo completo: costo y fidelidad — fuente: Revisión adversarial; porque: puede evitar leer todo el repositorio.
  - [ ] 2.4 **M9, SVG con muchos nodos**: prototipo desechable en la ventana real con 2 000 nodos y 5 000 aristas: fluidez de zoom y pan y costo de virtualizar; decidir SVG o `canvas` — porque: CA-10.
  - [ ] 2.5 **Puerta de decisión**: M7 y M8 fijan el método de escaneo y los topes; M9 si el SVG basta. Si el gráfico a escala del repositorio resulta inviable, **se detiene y se consulta al usuario** (en particular antes de cambiar a un árbol simplificado).
  - [ ] 2.6 pruebas unitarias — test-gen: no aplica; doc-check — revisión manual.
- Conexiones: `rules-comentarios` (scripts `.ps1`). Resto sin skill (prototipos y generadores de un solo uso).
- Pipeline del increment: `format`.
- Criterio de aceptacion: `medidas.md` M6 a M9, el generador y la decisión de método.
- Verificacion funcional: datos y navegador — repositorio sintético real y ventana real (M9).
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 3: Resolución pospuesta, `RepoRef` y bloqueo de repositorio — cubre spec [CA-1, CA-3, CA-4, CA-11]
- Pasos:
  - [ ] 3.1 `UpdateRequest` y los nuevos `SwitchRequest`/`MergeRequest` llevan `--accept postpone`; el update de la Fase 1, `project.ts` y sus pruebas se ajustan; el parser de progreso ignora `Searching tree conflict details…` y `Checking rN…` — fuente: `commands.rs:116-123`, M1; porque: CA-3 (decisión del usuario).
  - [ ] 3.2 Recuento de conflictos tras la operación con `status` (lista de `(ruta, kind)`), no con el parser ni con el «Summary» — fuente: `wc_status.rs`; porque: CA-3.
  - [ ] 3.3 `app/branching/repo_ref.rs`: `RepoRef { uuid, root, url }` desde el `svn info` de la copia o del registro; `remote_url` de la Fase 3 gana una variante que acepta cualquier ruta bajo la **raíz real** del repositorio, validada contra esa raíz — fuente: Fase 3 I2; porque: CA-4 (origen y destino fuera de la URL registrada).
  - [ ] 3.4 Variante de `guarded` para operaciones de repositorio (sin `ScopedPath`, `revalidate` ni `StaleStatus`) con clave `repo:<uuid>:<destino>` — fuente: `operations.rs:257-290`; porque: CA-4.
  - [ ] 3.5 pruebas unitarias — `test-gen`: update con conflicto de árbol queda pendiente y no se autoresuelve, recuento por `status`, `RepoRef` desde copia registrada y no registrada, ruta fuera de la raíz real (rechazada), dos operaciones de repositorio con el mismo destino se serializan — fuente: `tests/svn_operations.rs`; porque: CA-3. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`.
- Criterio de aceptacion: ningún conflicto se autoresuelve y las operaciones de repositorio tienen su propia clave de bloqueo.
- Verificacion funcional: datos — `svn update` real con conflicto de árbol.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 4: Clasificación de ubicaciones y aviso de tag — cubre spec [CA-1, CA-2, CA-11, CA-14]
- Pasos:
  - [ ] 4.1 `app/branching/classify.rs`: `Layout` por UUID y `classify(uuid, ruta_relativa) -> Location`; globs validados (sin `..`, sin raíz absoluta, tope de cantidad y largo); por defecto `trunk`, `*/trunk`, `branches/*`, `*/branches/*`, `tags/*`, `*/tags/*`; una carpeta `tags` sin patrón que lo diga es `Other` — fuente: `propuesta.md` §94; porque: CA-1.
  - [ ] 4.2 `RepoEntry` gana `layout` (`#[serde(default)]`); formulario del repositorio con edición de patrones y vista previa («esta ruta sería: rama») — fuente: Fase 3 I2/I3; porque: CA-1.
  - [ ] 4.3 Comando `branching_classify(target)`; `WcHeader` y el Marketplace lo usan (con layout por defecto si el repositorio no está registrado); `branchLabel` queda como respaldo hasta migrar sus usos — fuente: `WcHeader.vue:19`; porque: CA-1.
  - [ ] 4.4 `commit_preflight` (Fase 4) devuelve el aviso de tag y Rust exige `confirmed_tag` — fuente: Fase 4 I15; porque: CA-2.
  - [ ] 4.5 ADR 0016 (propuesto) — fuente: `docs/adr/0000-template.md`; porque: decisión significativa.
  - [ ] 4.6 pruebas unitarias — `test-gen`: `classify` con diseño por defecto, proyectos `/projA/trunk`, personalizado, `tags` engañoso, acentos y mayúsculas, patrones inválidos, configuración antigua, repositorio no registrado, aviso de tag con y sin confirmación; Vitest de patrones y distintivos; E2E (`branching-classify.e2e.ts`) y las suites de `WcHeader`/Marketplace afectadas; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `adr-new`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: trunk, ramas y tags se reconocen con patrones propios y un commit sobre un tag exige confirmación.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 5: Switch — cubre spec [CA-5, CA-7, CA-11, CA-12, CA-13]
- Pasos:
  - [ ] 5.1 Rust: `SwitchRequest { path, url, revision, set_depth, ignore_externals, ignore_ancestry }` (**un** parámetro de profundidad) con `--accept postpone`; `parse_switch_output` propio (columna de árbol, `Skipped`, resumen por categoría, tolerando `\r`) — fuente: M1, M3; porque: CA-5, CA-7.
  - [ ] 5.2 `app/branching/switch.rs`: preflight (mismo UUID —si no, «no soportado por esta aplicación»—, sin operación en curso, aviso por cambios locales; la revisión mezclada no bloquea en switch); `--ignore-ancestry` exige `confirmed_ignore_ancestry`; el resultado cuenta conflictos con `status` — fuente: `operations.rs:187-205`; porque: CA-5.
  - [ ] 5.3 Commands `branching_switch_preflight` y `branching_switch`, registro, contrato y envoltorios; toma el candado por raíz y el `CloseGuard` propio — fuente: `commands/mod.rs`; porque: tipados.
  - [ ] 5.4 Interfaz `SwitchDialog.vue`: destino elegido en el navegador remoto de la Fase 3 (según `classify`), profundidad única, externals; dice que **no hay vista previa**; resultado con conflictos y enlace a la Fase 6 cuando exista — fuente: Fase 3 I6; porque: CA-5.
  - [ ] 5.5 pruebas unitarias — `test-gen` y `flow-test-gen`: entre ramas, a otro repositorio (rechazado), con cambios locales, con conflicto y con omitidos (parser con salida real), revisiones mixtas, `--set-depth` (incluido `exclude`), `--ignore-ancestry` sin confirmación (rechazado), cancelación; Vitest; E2E (`branching-switch.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: una copia cambia de rama informando conflictos y omitidos, sin cruzar repositorios.
- Verificacion funcional: navegador — ventana real vía CDP, cotejado con `svn info`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 6: Crear rama o tag (Rust) — cubre spec [CA-4, CA-11, CA-12]
- Pasos:
  - [ ] 6.1 `svn/`: `RepoCopyRequest { source, dest, message_file, parents, pin_externals, username }` (URL→URL y copia de trabajo→URL), un único origen, argumentos separados; origen «revisión N» = `URL@N` — fuente: M2; porque: CA-4.
  - [ ] 6.2 `app/branching/branch_tag.rs`: arma origen y destino con `RepoRef` (cualquier ruta bajo la raíz real); mismo UUID; comprueba el destino con `svn info` y **solo un `NotFound` clasificado** autoriza continuar; mensaje obligatorio por archivo temporal; `pin_externals` por defecto según `classify(destino)` (activada en tag); tras el commit, `svn ls` del destino para detectar una copia anidada y avisar con la revisión — fuente: M2; porque: CA-4.
  - [ ] 6.3 Resultado con la revisión creada y limpieza de la caché de listados del Marketplace; `switch_after` encadena el switch del I5 — fuente: `progress.rs:15-20`; porque: CA-4.
  - [ ] 6.4 Commands `branching_copy_preflight` y `branching_copy`; operación de repositorio con su clave (WC→URL toma además el candado de la copia); registro, contrato, envoltorios y opciones de red/certificados de la Fase 3 — fuente: I3; porque: CA-4, CA-11.
  - [ ] 6.5 pruebas unitarias — `test-gen` y `flow-test-gen`: destino nuevo, destino existente (rechazado), carrera (copia anidada detectada y avisada), `--parents`, `URL@N` con ruta borrada y recreada, copia de trabajo con cambios locales, otro repositorio, mensaje vacío, error de red al comprobar (bloquea), `--pin-externals` en tag y en rama, credenciales con `svnserve`, cancelación; el frontend no envía URL (prueba por command) — fuente: `tests/svn_operations.rs`; porque: CA-4, CA-11. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (preflight → copia → verificación → switch opcional), `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: se crean ramas y tags sin copiar dentro de un destino existente ni fijar externals por accidente.
- Verificacion funcional: datos — `svn log -v` y `svn ls` reales.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 7: Crear rama o tag (interfaz) — cubre spec [CA-4, CA-13, CA-14]
- Pasos:
  - [ ] 7.1 Asistente `BranchTagDialog.vue` (`BaseModal`): Rama o Tag, origen (HEAD, revisión, copia de trabajo), destino con sugerencia por `classify`, mensaje, carpetas intermedias, «fijar externals» (activada en tag), «cambiar la copia al nuevo destino» (usa I5); muestra el resultado del preflight antes de habilitar «Crear» y el aviso si la verificación posterior detecta una copia anidada — fuente: `CheckoutForm.vue`; porque: CA-4.
  - [ ] 7.2 Puntos de entrada: menú contextual de carpeta, log (revisión seleccionada → origen «revisión»), Marketplace (carpeta remota) — fuente: Fase 4 I3/I9, Fase 3 I6; porque: CA-4. Corren las suites del log y del Marketplace.
  - [ ] 7.3 Progreso y refresco del log y del Marketplace al terminar — porque: CA-4.
  - [ ] 7.4 pruebas unitarias — `test-gen`: validación en línea, sugerencias, foco y teclado, errores del preflight, Vitest; E2E (`branching-copy.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`; auditoría con `bossdream-design-auditor`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se crea una rama y un tag desde cada punto de entrada.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 8: Merge — peticiones, parsers y vista previa — cubre spec [CA-6, CA-7, CA-11]
- Pasos:
  - [ ] 8.1 `svn/`: `MergeRequest` con los tres modos (`Range`, `Trees`, `Automatic`), `--dry-run`, `--record-only`, `--ignore-ancestry`, `--depth`, rangos múltiples (`MAX_MERGE_RANGES` 200), reversa y `--accept postpone`; el origen siempre `URL@N` — fuente: M4; porque: CA-6.
  - [ ] 8.2 `parse_merge_output` propio: acciones por archivo (incluida la columna de árbol), `Skipped`, categorías de `Summary of conflicts`, `--- Merging …`, `\r`; nuevas variantes de `ProgressAction`; contrato actualizado; tope `MAX_PREVIEW_ITEMS` — fuente: `progress.rs:99-120`, M4; porque: CA-7.
  - [ ] 8.3 `app/branching/merge.rs`: `anchor(source)` resuelve el HEAD del origen al abrir el asistente; `preview(spec)` ejecuta `--dry-run` con ese ancla y devuelve `MergePreview` (archivos, propiedades, omitidos, conflictos esperados, tipo sincronizar/reintegrar); la mezcla de revisiones se detecta aquí por `E195020` clasificado con la acción «Actualizar primero»; si el HEAD del origen cambió, pide repetir — fuente: M4; porque: CA-6.
  - [ ] 8.4 Commands `branching_merge_anchor` y `branching_merge_preview`; registro, contrato y envoltorios — fuente: `commands/mod.rs`; porque: tipados.
  - [ ] 8.5 pruebas unitarias — `test-gen`: cada modo en `--dry-run` sin cambios en disco (hash de la copia antes y después), `E195020`, parser con la **salida real** de M4 (conflicto de árbol, omitidos por obstrucción, `\r`), rangos solapados y desordenados, rango enorme, origen de otro repositorio (rechazado) — fuente: `tests/svn_operations.rs`; porque: CA-6, CA-7. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: la vista previa no modifica nada, está anclada y bloquea la copia mezclada.
- Verificacion funcional: datos — comparar con `svn merge --dry-run` directo.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 9: Merge — preflight, ejecución y resultado — cubre spec [CA-6, CA-7, CA-11, CA-12]
- Pasos:
  - [ ] 9.1 Preflight por modo: objetivo = raíz de rama (subcarpeta = aviso), profundidad completa, sin subárboles con switch, aviso si `classify(copia)` es Tag, UUID del origen, rangos válidos; **Automatic**: cambios locales, switch o revisión mezclada = rechazo duro; **rango y dos árboles**: cambios locales exigen `confirmed_dirty` con el texto «no se podrá deshacer»; el preflight registra si la copia estaba limpia — fuente: spec CA-6; porque: CA-6.
  - [ ] 9.2 `run(spec, confirmations)`: exige en Rust `confirmed_dirty`, `confirmed_record_only` (texto fijo «le decimos a Subversion que esos cambios ya se fusionaron aunque no lo estén») y `confirmed_ignore_ancestry`; usa `URL@N` del ancla; candado por raíz, `CloseGuard` propio y progreso — fuente: Fase 4 I2; porque: CA-6.
  - [ ] 9.3 Cancelar mata el proceso, marca la copia «merge incompleto» (`incomplete`) y ofrece `revert -R` (con el token y respaldo de la Fase 4) **solo** si el preflight registró la copia limpia — fuente: `operations.rs:272-290`, M4; porque: CA-6 (sin evidencia de «copia consistente»).
  - [ ] 9.4 Resultado (`MergeResult`): archivos tocados, conflictos por categoría, **omitidos** con la advertencia de mergeinfo falsamente registrado, `mergeinfo_changed`, recordatorio de commit; nunca `éxito` con conflictos u omitidos; recuento con `status` — fuente: M4; porque: CA-7.
  - [ ] 9.5 Commands `branching_merge_preflight` y `branching_merge`; registro, contrato y envoltorios.
  - [ ] 9.6 pruebas unitarias — `test-gen` y `flow-test-gen` (preflight → vista previa → ejecución → resultado): cada modo con y sin conflictos, `record-only`/`ignore-ancestry`/copia sucia sin confirmación (rechazados), automático con copia sucia (rechazo duro), subcarpeta, tag, mezclada, switch, omitidos por obstrucción (resultado honesto), cancelación a mitad con copia limpia y sucia, merge inverso, origen de otro repositorio — fuente: `tests/svn_operations.rs`; porque: CA-6, CA-7. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: la ejecución exige las confirmaciones de riesgo y el resultado nunca es optimista.
- Verificacion funcional: datos — comparar con `svn merge` directo y `svn status`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 10: Merge (interfaz) — cubre spec [CA-6, CA-7, CA-12, CA-13, CA-14]
- Pasos:
  - [ ] 10.1 Asistente `MergeWizard.vue` de pasos: tipo (rango, dos árboles, todo lo elegible) → origen (navegador remoto de la Fase 3 con `RepoRef`) → revisiones (modo selección sobre el log de la Fase 4, o escritas) → opciones con su explicación y casillas de confirmación → vista previa → ejecutar → resultado — fuente: Fase 3 I6, Fase 4 I9; porque: CA-6.
  - [ ] 10.2 Vista previa: tabla de archivos con acción, conflictos esperados, omitidos, tipo sincronizar/reintegrar y la frase «la vista previa no garantiza el resultado»; si hay revisión mezclada, bloquea con el botón «Actualizar primero» — fuente: M4; porque: CA-6.
  - [ ] 10.3 Resultado: lo tocado, conflictos y omitidos (sin simular su resolución; enlace a la Fase 6 cuando exista), aviso de `svn:mergeinfo` y de que falta el commit, y «revertir el merge» solo si estaba limpia — fuente: spec CA-7; porque: honestidad.
  - [ ] 10.4 Entradas: menú contextual de carpeta, log («Fusionar estas revisiones») y Marketplace; corren las suites del log y del Marketplace — porque: CA-14.
  - [ ] 10.5 pruebas unitarias — `test-gen`: pasos y validaciones, confirmaciones, vista previa, resultado con y sin conflictos u omitidos, bloqueo por mezcla, teclado y foco, Vitest; E2E (`branching-merge.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`; auditoría con `bossdream-design-auditor`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se fusiona de punta a punta con vista previa anclada y resultado honesto.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 11: Revertir una revisión y acciones del log — cubre spec [CA-8, CA-14]
- Pasos:
  - [ ] 11.1 Acción «Revertir los cambios de esta revisión» del log (rango si hay varias): arma `MergeSpec::Range { reverse }` sobre la copia elegida y abre el asistente en la vista previa — fuente: I8/I10; porque: CA-8.
  - [ ] 11.2 El panel de acciones del log gana crear rama/tag desde la revisión, fusionar y revertir; las acciones existentes no cambian; corren las suites del log — fuente: Fase 4 I9; porque: CA-14.
  - [ ] 11.3 pruebas unitarias — `test-gen`: revertir una y varias revisiones, la que borra o crea archivos, conflicto al revertir, copia mezclada; E2E (`branching-revert.e2e.ts`); doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se revierte una revisión con las mismas garantías que el merge.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 12: Mergeinfo — cubre spec [CA-9, CA-11, CA-13]
- Pasos:
  - [ ] 12.1 Rust: `MergeinfoRequest { source, target, kind }` sin `--xml` (texto): se interpretan **solo** las líneas `rN` de `--show-revs`; compresión a `RevRange`; tope y truncado con aviso; `--depth` declarada (por defecto `empty`; `infinity` bajo demanda) y `propget -R svn:mergeinfo` en el crudo; origen y destino como `URL@rev` o ruta local — fuente: M5; porque: CA-9.
  - [ ] 12.2 Mensajes por revisión bajo demanda con `svn log -r N --xml` (no con `--log` de `mergeinfo`) — fuente: I7; porque: parsear texto hostil es frágil.
  - [ ] 12.3 Commands `branching_mergeinfo` y `branching_mergeinfo_message`; registro, contrato y envoltorios.
  - [ ] 12.4 Vista `svn_view` «Mergeinfo»: origen, fusionadas y elegibles como rangos, mensaje bajo demanda, crudo de solo lectura, listas virtualizadas; «Fusionar las elegibles» abre el asistente — fuente: Fase 4 I9 (lista virtualizada); porque: CA-9.
  - [ ] 12.5 pruebas unitarias — `test-gen`: compresión de rangos no contiguos, rama borrada, origen sin relación, 10 000 revisiones, subárboles con mergeinfo propio, Vitest; E2E (`branching-mergeinfo.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: se ve qué está fusionado y qué falta, con rangos correctos y sin parsear texto hostil.
- Verificacion funcional: navegador — ventana real vía CDP, cotejado con `svn mergeinfo`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 13: Gráfico — escaneo y líneas (Rust) — cubre spec [CA-10, CA-11]
- Pasos:
  - [ ] 13.1 `app/branching/graph.rs`: escaneo por tramos de `GRAPH_PAGE` con el método fijado por M7/M8 (`log -q -v --xml` o `ls` + `log --stop-on-copy`), plazo `GRAPH_PAGE_TIMEOUT` por tramo, progreso y cancelación; de cada tramo se conserva solo lo que el grafo necesita (altas con `copyfrom`, borrados y raíces de rama según `classify`) y el resto se descarta; tope `MAX_GRAPH_REVISIONS` — fuente: M7, M8; porque: CA-10.
  - [ ] 13.2 Líneas: identidad (ruta, revisión de alta); regla de renombrado (`A` con `copyfrom P@(r-1)` + `D` de `P` en la misma revisión = misma línea); `copyfrom` resuelto a la encarnación viva de la ruta en esa revisión; `copyfrom` a una subruta atribuido a la línea de la raíz con marca de copia parcial; rama borrada y recreada = dos líneas; nodo «origen anterior a la ventana» — fuente: Revisión adversarial (medido); porque: CA-10.
  - [ ] 13.3 Commands `branching_graph_load` (por tramo, con id de tarea elegido por Rust), `branching_graph_cancel`; registro, contrato y envoltorios — fuente: `commands/archive.rs` (patrón de tareas); porque: tipados.
  - [ ] 13.4 pruebas unitarias — `test-gen` y `flow-test-gen`: trunk, ramas de ramas, tags, borrados, renombrados, recreaciones, copia de la carpeta `branches` completa, `copyfrom` hacia rutas borradas, tramos que cortan una rama, 50 000 revisiones del repositorio cacheado (tiempo y memoria dentro de lo medido; marcada como lenta), cancelación, tope — fuente: M6; porque: CA-10. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: el modelo de líneas es correcto, incluidos renombrados y recreaciones, dentro de los topes.
- Verificacion funcional: datos — comparar con la estructura real del repositorio de pruebas.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 14: Gráfico — layout y agrupación (Rust) — cubre spec [CA-10]
- Pasos:
  - [ ] 14.1 Layout en Rust: eje por orden de eventos con huecos comprimidos; carriles reciclados (coloreado de intervalos); posición `x` estable respecto de lo ya cargado al añadir tramos más antiguos (el layout se calcula incrementalmente anclado a HEAD) — fuente: Revisión adversarial; porque: CA-10.
  - [ ] 14.2 Agrupación al superar `MAX_GRAPH_NODES`: por prefijo y antigüedad («N tags antiguos»), expandible bajo demanda — porque: CA-10.
  - [ ] 14.3 Fusiones bajo demanda: `branching_graph_merged_between(a, b)` con dirección explícita y `URL@rev`, reutilizando el mergeinfo del I12 — fuente: I12; porque: CA-10.
  - [ ] 14.4 pruebas unitarias — `test-gen`: reciclado de carriles sin solapes, estabilidad al cargar tramos, agrupación con repositorio con muchos tags, dirección de la fusión, 2 000 nodos dentro del tiempo medido; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: el layout es estable, sin solapes y acotado.
- Verificacion funcional: datos — comprobación del layout contra el repositorio sintético.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 15: Gráfico — viewport y render — cubre spec [CA-10, CA-13]
- Pasos:
  - [ ] 15.1 `components/branching/RevisionGraph.vue`: SVG con carriles, nodos y aristas; solo se dibuja lo visible (virtualización); zoom (rueda con modificador, botones y `+`/`-`), pan (arrastre y flechas), «ajustar a la ventana», atajos documentados y `prefers-reduced-motion` respetado — fuente: M9; porque: CA-10.
  - [ ] 15.2 Etiquetas de rama y tag **escapadas** (controles y bidireccionales) y truncadas dentro del SVG, con el nombre completo en la lista accesible — fuente: Revisión adversarial; porque: CA-10.
  - [ ] 15.3 Estados de carga por tramos con progreso, cancelar, «cargar más» y explicación de los topes — fuente: `ProgressLog.vue`; porque: CA-10.
  - [ ] 15.4 pruebas unitarias — `test-gen`: transformaciones de pan y zoom, virtualización, escape de etiquetas, Vitest y Stryker; E2E de rendimiento (`branching-graph-perf.e2e.ts`: tiempo y fotogramas de pan y zoom con el repositorio sintético); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`; auditoría con `bossdream-design-auditor`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: el gráfico es navegable con zoom y pan y fluido con el repositorio grande.
- Verificacion funcional: navegador — ventana real vía CDP con el repositorio generado en I2.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 16: Gráfico — lista accesible, selección y acciones — cubre spec [CA-10, CA-13, CA-14]
- Pasos:
  - [ ] 16.1 Alternativa accesible: lista jerárquica (`role=tree`) con los mismos datos y acciones, conmutable; todo el significado del gráfico (rama, tag, borrado) también por texto — fuente: `FileTree.vue`; porque: CA-13.
  - [ ] 16.2 Selección de una revisión (clic y teclado) con panel de acciones: log, crear rama, crear tag, fusionar; selección de dos líneas muestra lo fusionado entre ellas (dirección explícita) — fuente: I7, I10, I12; porque: CA-10.
  - [ ] 16.3 Entradas: menú contextual de repositorio/carpeta y Marketplace («Gráfico de revisiones»); corren las suites del Marketplace — porque: CA-14.
  - [ ] 16.4 E2E (`branching-graph.e2e.ts`) recorrido solo con teclado; pruebas unitarias — `test-gen`: selección, lista, acciones, dirección de la fusión, con Vitest y Stryker; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: todo el gráfico es operable por teclado y por la lista accesible.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 17: Documentación — cubre spec [CA-16]
- Pasos:
  - [ ] 17.1 Crear `docs/branching.md` (resolución pospuesta, clasificación, branch/tag, switch sin vista previa, merge y sus precondiciones por modo, resultado honesto, mergeinfo, gráfico y sus topes y método, límites) con símbolos reales — fuente: `docs/vcs-operations.md` (formato); porque: CA-16.
  - [ ] 17.2 Actualizar `docs/svn-integration.md`, `security.md`, `testing.md`, `ARCHITECTURE.md` (módulo `app/branching/`), `marketplace.md` (distintivos) y `roadmap.md`; ADR 0016 a `accepted`; deuda a `TECH_DEBT.md`; `docs-rewrite --check` — porque: CA-16.
  - [ ] 17.3 pruebas unitarias — `test-gen`: no aplica; doc-check — `docs-rewrite`.
- Conexiones: `docs-rewrite`, `adr-new`, `tech-debt`.
- Pipeline del increment: `format`.
- Criterio de aceptacion: documentación coherente con el código.
- Verificacion funcional: no aplica: solo documentación; se cotejan afirmaciones con el código.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 18: QA Increment — cubre spec [CA-15]
- Pasos:
  - [ ] 18.1 `qa-increment` (modo de `bossdream.json > qa.mode`): Test Inventory con `bossdream-qa-gatekeeper`; `qa-run` con auditor adversarial y flow-breaker (preflight → vista previa → ejecución, destino de `copy`, confirmaciones, cancelación de merge) — fuente: skills `qa-increment`, `qa-run`, `test-checks`; porque: veredicto independiente.
  - [ ] 18.2 `test-checks`: `cargo check`, `cargo test`, `npm test`, `npm run build`, mutación de Rust y frontend sobre lo nuevo, E2E de las Fases 2A a 5 sin regresiones, prueba de rendimiento del gráfico, `tauri build` — fuente: `pipeline.json`; porque: CA-15.
  - [ ] 18.3 Corregir hasta ACCEPTED y marcar cada CA con `[x]`/`[~]` y motivo — porque: honestidad.
  - [ ] 18.4 pruebas unitarias — `test-gen`: las del QA; doc-check — `docs-rewrite`.
- Conexiones: `qa-increment`, `qa-run`, `test-checks`, `flow-test-gen`, `docs-rewrite`.
- Pipeline del increment: todos los gates de `completion.json`.
- Criterio de aceptacion: QA Increment ACCEPTED con evidencia.
- Verificacion funcional: navegador — E2E de la fase sobre el ejecutable de depuración y el de release.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

## Revision adversarial
Revisión de un subagente `general-purpose` (probada con `svn` 1.14.2), `bossdream-completeness-auditor` y `bossdream-document-explorer`. Aplicado: B1 (mezcla → bloqueo «Actualizar primero»), B2 (parsers propios), B3 (omitidos y mergeinfo falso), B4 (copia sucia y cancelación honestas), B5 (switch antes de branch/tag), B6 (`RepoRef` y raíz real); I1 a I11 (peg `URL@N`, clave de repositorio, `NotFound` y verificación posterior, nombres de petición, ancla de la vista previa, validación del objetivo, mergeinfo sin `--xml`, identidad de línea y renombrados, algoritmo del gráfico, costos y generador, clasificación por UUID); M1 a M6; división de I1, I6, I10 y I11 originales; decisiones del usuario (`--accept postpone`, mezcla bloqueada, `--pin-externals`); bloqueante del auditor (modo automático con precondiciones duras). Pendiente de lectura del usuario: `design.md` completo.
