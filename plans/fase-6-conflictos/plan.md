# Plan — Fase 6: Conflictos

> Producto de `/bossdream-plan`. Referencia: `spec.md` (QUE) y `design.md` (COMO, borrador v2 del 2026-10-23). **Prerrequisitos: las Fases 4 y 5 implementadas** (pestañas `svn_view`, configuración de Monaco, Centro de cambios, escritura atómica, candado por raíz, token y respaldo de la 4; `--accept postpone`, merge y switch de la 5). El Increment 1 lo verifica contra el código real. **v2:** incorpora la revisión adversarial (probada con `svn` 1.14.2 y 1.15.0), el auditor de completitud, el explorador de skills y las decisiones del usuario.

## Razon de ser
Que el usuario resuelva conflictos de texto, propiedades y árbol dentro de la aplicación, con un editor de tres vías profesional y sin marcar nada como resuelto —ni resolver una ruta a medias— por accidente.

## Justificacion
Core Tenet 1: detección y resolución son de Subversion (`status`, `info`, `propget`, `resolve`); la aplicación presenta y pide decisiones. Reglas duras: rutas por `Workspace::resolve`, confirmación de lo destructivo exigida en Rust, resolver siempre explícito (§44), sin `tauri-plugin-shell` hacia el frontend. Decisiones en `design.md` §0.

## Flujo (que / por que)
Medir primero qué deja Subversion en disco y qué admite `resolve` por tipo y en combinación → modelo en Rust (parsers y lista, lados/propiedades/árbol) → resolver y guardar en Rust → `diff3`, aislado y probado a fondo (puede ir en paralelo) → editor en tres cortes → propiedades y binarios → árbol → centro e integración → documentación → QA.

## Clasificacion
tipo: add-to-flow (estado `conflicted`/`tree-conflicted`, `FileService`, Monaco, pestañas `svn_view`, Centro de cambios) y new (modelo de conflictos, `resolve`, `diff3`, editor de tres vías) · complejidad: large

## Investigacion (research-log)
| Pregunta | Tool/agente | Hallazgo | Como informo el plan |
|---|---|---|---|
| ¿Subversion «solo marca» los conflictos? | Revisión adversarial (probado en 1.14.2), [release notes 1.10](https://subversion.apache.org/docs/release-notes/1.10.html), `runner.rs:85`, `commands.rs:116-123` | Con `--non-interactive` rige `--accept recommended`: el update autoresolvió un conflicto de árbol (`G mv2.txt`) | La Fase 5 (I3) pasa `--accept postpone`; I1 lo verifica |
| ¿Una ruta puede tener varios conflictos y `working` los cierra todos? | Revisión adversarial (probado: `h.txt` `CC` → `MM`), auditor de completitud (`resolved.c` de 1.14.5) | `resolve --accept working <ruta>` resuelve texto, **todas** las propiedades y árbol de esa ruta; el entrante de la propiedad se descartó sin mostrarse | CA-6: clave (ruta, tipo), tipos cubiertos y rechazo de Rust |
| ¿`svn info --xml` es fiable? | Revisión adversarial (probado en 1.14.2 y 1.15.0) | Con texto + propiedad emite 4 `<conflict>` en vez de 2; `<prop-file>` apunta a `h.txt.r3` en vez del `.prej`; los atributos de `<tree-conflict>` cambian de orden | I2: deduplicar por (tipo, rutas); no confiar en `prop-file`; parseo sin orden |
| ¿Se puede parsear el `.prej`? | Revisión adversarial (probado) | Mezcla `\n` y `\r\n`, marcadores pegados al valor; en directorios es `dir_conflicts.prej` dentro de la carpeta | I3: valores por `svn propget` (WORKING, BASE, `URL@rev`); el `.prej` solo como mensaje crudo |
| ¿Qué matriz de `--accept` rige? | Revisión adversarial (probado), auditor de completitud (`conflicts.c`, `resolve-cmd.c`) | Árbol: `working` siempre; `mine-conflict` solo en «local dir delete / incoming dir edit» y «moved-away / edit»; `base`, `mine-full`, `theirs-full`, `theirs-conflict` fallan (`W195024`/`E155027`); `postpone`, `edit` y `launch` no valen en `svn resolve`. Texto: `working` conserva marcadores; `base` deja el pristine viejo (`M`); `mine-full` conserva `.mine`; `theirs-full` deja limpio; propiedades: `mine-conflict` = `mine-full`. `resolve` borra todos los auxiliares con cualquier `--accept`; sin `-R` actúa con profundidad `empty` | I1 (M3) la mide con el svn empaquetado y la mínima; I4 y CA-9 se escriben contra ella |
| ¿Qué archivos auxiliares deja cada operación? | Revisión adversarial (probado) | Update/switch: `.mine`, `.rN`, `.rM`; merge: `.working`, `.merge-left.rN`, `.merge-right.rN`; con un `f.txt.mine` preexistente: `f.txt.2.mine/.2.r2/.2.r3`; binario: sin `.mine` (update) o sin `.working` (merge); aparecen como `?` en `status` | I2: nombres de `info`; Fase 4 filtra los auxiliares de «no versionados» |
| ¿Cómo se ve un conflicto de árbol? | Revisión adversarial (probado), auditor (`cl-conflicts.c`) | `reason ∈ {edit, delete, missing, obstruction, add, replace, unversioned, moved-away, moved-here}`, `action ∈ {edit, add, delete, replace}`; el borrado entrante no distingue un move; la víctima puede no existir en disco | CA-9 y `describeTreeConflict` con ese vocabulario |
| ¿Qué detecta el parser de progreso? | `progress.rs:104-115` | `   C d.txt` (columna 3) se descarta; el «Summary of conflicts» difiere entre comandos y el de `status` cuenta mal | Conteo canónico por `status` (Fase 5 I3) |
| ¿Cómo se guarda un texto? | `text.rs:104-122,143-149`, `edit.rs` | `write_text` normaliza todos los saltos al fin de línea dominante; `decode_document` solo acepta UTF-8 o UTF-16 con BOM; Subversion marca binario a un UTF-16 (`svn:mime-type`) | CA-3 (avisar y normalizar), CA-2 (criterio de binario = el de `svn`; no UTF-8 → elegir un lado) |
| ¿Hay cuatro Monaco a la vez? | `documents/monaco/setup.ts` (~120) | `openViewer` crea su propio modelo y no expone el editor; activa minimapa; el desplazamiento por `scrollTop` no alinea paneles con distinto número de líneas por bloque | I7: módulo de bajo nivel nuevo, minimapa apagado, alineación por bloque con zonas de vista; umbrales numéricos antes de medir |
| ¿Cómo se cierra una pestaña con cambios? | `stores/tabs.ts:116,206,319-323`, `useWindowClose.ts:14-18` | Usa `setDirty`/`isDirty`; `registerCloseGuard` es de la ventana y ya existe | Fase 4 I3 hace que `svn_view` participe; I8 lo prueba |
| ¿Cuánto pesa la carga por IPC? | Revisión adversarial | `conflicts_sides` en un solo JSON serían hasta 4×5 MiB | I3: lados bajo demanda por lado |
| ¿Hay biblioteca de diff? | `Cargo.toml`, `package.json` | Ninguna; `diff3` solo en TypeScript | Vista previa de Rust sin diff (tamaños, huella, líneas) |
| ¿Skills aplicables? | `bossdream-document-explorer` | Ver `Conexiones` | Sin skill para el editor, `diff3` (propiedades) ni el cableado (piezas de un solo uso) |

## Impacto cross-flow
| Flujo afectado | Verificado con | ¿Choca? | Mitigacion |
|---|---|---|---|
| Centro de cambios y preflight (Fase 4) | su plan | Sí: los auxiliares salen como «no versionados» y «resolver» era un marcador | I11 los filtra y conecta la acción |
| `wc_status_map` / `StatusCache` | `wc_status.rs` | Sí | `StaleStatus` tras cada resolución |
| `FileService` / editor de texto normal | `edit.rs`, `documents.ts` | Posible: el mismo archivo en dos pestañas | El editor de tres vías toma `expected_version`; la pestaña de texto muestra su aviso de la 2A |
| Update (1), switch y merge (5) | sus planes | Sí | I11 agrega el aviso con el conteo canónico sin cambiar su resultado |
| Monaco `setup.ts` | su código | Sí | I7 agrega un módulo nuevo; `openViewer` no cambia |
| Cierre de ventana y de pestaña | `useWindowClose.ts`, `tabs.ts` | Sí | I8 |
| Candado por raíz (Fase 4 I2) | su plan | Sí | `resolve` y `save` lo toman |
| T-26 (esperas de pintado) | `TECH_DEBT.md` | Posible con Monaco ×4 | Las E2E nuevas esperan `requestAnimationFrame` real |

## Deuda tecnica (informativa, NO bloqueante)
| Ubicacion | Deuda | Impacto | Remediacion | Esfuerzo | ¿Se paga en este plan? |
|---|---|---|---|---|---|
| `text.rs` `write_text` | Normaliza el fin de línea | Medio: EOL mixto se reescribe entero | Aviso y normalización explícita en el guardado del editor | low | Parcial |
| `progress.rs` `parse_update_item` | No reconoce conflictos de árbol | Medio | Conteo por `status` | medium | Parcial (Fase 5) |
| `app/state.rs` T-3/T-19 | `AppState` crece | Alto | `app/conflicts/` con métodos finos | low | Parcial |
| `viewers.e2e.ts` T-26 | Esperas de pintado inestables | Medio | `requestAnimationFrame` real en las E2E nuevas | medium | Parcial |

## Decisiones (opcion elegida vs descartadas)
Ver `design.md` §0. Resumen: editor de tres vías propio con `diff3` en un Worker (descartados: depender de los marcadores de Subversion, una librería de merge, y la edición manual sin bloques, por decisión del usuario); resolver explícito con clave (ruta, tipo), identidad del conflicto y tipos cubiertos; árbol con salidas admitidas + guía manual + recomendación de Subversion (decisión del usuario; descartados: implementar «mover y fusionar» propio y conducir el resolvedor interactivo); propiedades por `propget` (descartado: parsear el `.prej`); vista previa de Rust sin diff (descartado: una dependencia de diff en Rust). ADR: `docs/adr/0017-editor-de-tres-vias-propio-y-resolver-explicito.md` (propuesto en I5; se relaciona con el 0016 de la Fase 5 por la resolución pospuesta).

## Increments

### Increment 1: Medir antes de construir — cubre spec [CA-1, CA-2, CA-6, CA-7, CA-8, CA-9, CA-12]
- Justificacion / fuentes: regla de investigación (§130). La revisión ya midió varios comportamientos en 1.14.2 y 1.15.0; aquí se repiten con el `svn` empaquetado y el mínimo y se miden los que faltan.
- Pasos:
  - [ ] 1.1 **Prerrequisitos**: comprobar en el código real lo que prometen las Fases 4 y 5 (`svn_view` con `setDirty`, `FileService`, Monaco refactorizado, Centro de cambios, candado por raíz, token y respaldo, `--accept postpone`); si algo cambió, se ajusta este plan — fuente: planes 4 y 5; porque: se escribió antes de que existan.
  - [ ] 1.2 `plans/fase-6-conflictos/medidas.md`: cada medición anota la **versión de `svn`** (empaquetada 1.14.5 y mínima 1.10) y se repite en ambas; si difieren, se decide si 1.14 es el mínimo del Centro de conflictos con degradación — fuente: `locator.rs`, `third_party/svn.lock.json`; porque: CA-12.
  - [ ] 1.3 **M1, defecto no interactivo**: qué autoresuelve `update`/`switch`/`merge` con `--non-interactive` sin `--accept` y con `--accept postpone`; salida de «Searching tree conflict details…» (requiere red) — fuente: release notes 1.10; porque: confirma la premisa de la Fase 5 I3.
  - [ ] 1.4 **M2, auxiliares**: nombres exactos por operación (update, switch, merge), con auxiliares preexistentes (`.2.`), binarios (por `svn:mime-type`), UTF-16 (marcado binario), directorios (`dir_conflicts.prej`), CRLF y BOM; qué queda en el archivo de trabajo — fuente: svnbook; porque: CA-2.
  - [ ] 1.5 **M3, `svn info` y `svn status` con conflictos**: salida literal (texto y `--xml`) para texto, propiedades, texto+propiedad en la misma ruta, y cada escenario de árbol en update, switch y merge; duplicados y orden de atributos; cómo contar — porque: CA-1, CA-9.
  - [ ] 1.6 **M4, matriz de `resolve --accept`**: cada valor × tipo (texto, propiedad, árbol por escenario) × **combinación** (texto+propiedad), con `-R` y `--targets`: qué acepta, qué archivos y estado deja, qué error da; `recommended` y qué hace por escenario — fuente: `svn help resolve`; porque: CA-6, CA-7, CA-9.
  - [ ] 1.7 **M5, lados de propiedades**: `propget` WORKING, BASE y `URL@rev` (`repos-url`, `path-in-repos` y `revision` de `<version>`) en update, switch y merge, con `file:///` y `svnserve`; qué necesita red — porque: CA-8.
  - [ ] 1.8 **M6, Monaco ×4**: umbrales propuestos antes de medir —abrir en ≤ 3 s, memoria añadida ≤ 600 MB, desplazamiento a ≥ 30 fps con 5 MiB—; tres solo lectura y uno editable con alineación por zonas de vista — fuente: `documents/monaco/setup.ts`; porque: CA-4.
  - [ ] 1.9 **M7, EOL y codificación**: guardar con `write_text` un archivo de fin de línea mixto y uno ANSI; qué ve Subversion — fuente: `text.rs:104-149`; porque: CA-2, CA-3.
  - [ ] 1.10 **Puerta de decisión**: M1 y M4 fijan la matriz y las salidas del árbol; M6 si caben cuatro editores o se pasa a uno con vistas; M7 el aviso del EOL. Si algo obliga a cambiar el alcance, **se detiene y se consulta al usuario**.
  - [ ] 1.11 pruebas unitarias — test-gen: no aplica, mediciones; fixtures saneados (rutas y UUID de ejemplo) y comportamientos pasan a los increments siguientes. doc-check — revisión manual (`docs-rewrite` no cubre `plans/`).
- Conexiones: `rules-comentarios` (scripts `.ps1`). Resto sin skill (mediciones y prototipos de un solo uso).
- Pipeline del increment: `format`.
- Criterio de aceptacion: `medidas.md` M1 a M7 con versión de `svn`, la matriz de `resolve` y fixtures saneados de cada tipo de conflicto.
- Verificacion funcional: datos y navegador — `svn.exe` real y ventana real (M6).
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 2: Modelo de conflictos — parsers y lista (Rust) — cubre spec [CA-1, CA-11]
- Pasos:
  - [ ] 2.1 Parsers: `parse_conflict_info` de `svn info --xml` (texto, propiedades, árbol con `operation`, `action`, `reason`, `victim`, versiones) **deduplicando por (tipo, rutas)**, sin confiar en `prop-file` ni en el orden de atributos; modelos `Conflict` (clave (ruta, tipo)), `TreeConflict` con el vocabulario de M3 — fuente: `parsers.rs:131-166`, M3; porque: CA-1.
  - [ ] 2.2 `app/conflicts/list.rs`: conflictos de una copia desde `status` + `svn info --targets` por lotes (un proceso por lote, no uno por conflicto), tope `MAX_CONFLICTS_LISTED` 2 000 con aviso de truncado; el conteo canónico es la lista de (ruta, tipo) — fuente: `wc_status.rs`; porque: CA-1 (rendimiento).
  - [ ] 2.3 Los auxiliares se atan a su conflicto y se exponen para que la Fase 4 los filtre de «no versionados» y de «agregar» (función `is_conflict_aux(path)`) — fuente: Fase 4 I16; porque: CA-1.
  - [ ] 2.4 Commands `conflicts_list`; registro, `commands_registry.rs`, contrato y envoltorios — fuente: `commands/mod.rs`; porque: tipados.
  - [ ] 2.5 pruebas unitarias — `test-gen`: cada tipo en update, switch y merge contra repositorio real, texto+propiedad en la misma ruta (dos conflictos), duplicados de `info`, atributos en distinto orden, varios conflictos, lista por lotes de 2 000, truncado; parsers con la salida real — fuente: `tests/svn_read.rs`; porque: CA-1. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: la lista coincide con `svn status` y no repite ni oculta conflictos.
- Verificacion funcional: datos — cotejar con `svn status` y `svn info`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 3: Modelo de conflictos — lados, propiedades y árbol (Rust) — cubre spec [CA-2, CA-8, CA-9, CA-11]
- Pasos:
  - [ ] 3.1 `app/conflicts/sides.rs`: `conflicts_side(conflict, which)` entrega **un lado por llamada** (`base`, `mine`, `theirs`, `working`) con codificación y fin de línea; nombres de los auxiliares **de `info`** (admite `.N.` y la carpeta del directorio), archivo regular por `symlink_metadata`, dentro del Workspace Root; `.mine` ausente = el trabajo es MÍO; faltante = error «faltan archivos auxiliares»; etiqueta según la operación; `working_version` en la respuesta — fuente: `app/files/text.rs`, `edit.rs`, M2; porque: CA-2, CA-11.
  - [ ] 3.2 Criterio de «no entra al editor»: binario por `svn:mime-type` (lo que decide `svn`), no UTF-8/UTF-16, mayor que `MAX_MERGE_BYTES`, más de `MAX_MERGE_LINES` o líneas de más de `MAX_LINE_BYTES` → `TooLargeOrBinary` con el motivo — fuente: `text.rs:104-122`; porque: CA-2.
  - [ ] 3.3 `app/conflicts/props.rs`: mío = `propget` WORKING, base y suyo = `propget` BASE o `URL@rev` (con credenciales de la Fase 3 si hace falta red); el `.prej` solo como mensaje crudo; topes y escape — fuente: M5; porque: CA-8.
  - [ ] 3.4 `app/conflicts/tree.rs`: descriptor con el vocabulario exacto, `victim_exists`, y las salidas admitidas por la matriz (`working`, `mine-conflict` donde aplique, `recommended`) más la guía manual como datos (secuencias de operaciones de la Fase 4 con lo que se pierde) — fuente: M4; porque: CA-9.
  - [ ] 3.5 Commands `conflicts_side`, `conflicts_props`, `conflicts_tree`; registro, contrato y envoltorios — fuente: `commands/mod.rs`; porque: tipados.
  - [ ] 3.6 pruebas unitarias — `test-gen`: auxiliares con nombres hostiles (`..`, otra carpeta, enlace, `.N.`), faltantes, binario, UTF-16, ANSI, archivo enorme, línea gigante, propiedades en update/switch/merge y en directorio, cada escenario de árbol; lados por separado (tamaño de carga) — fuente: `tests/svn_read.rs`, `tests/files.rs`; porque: CA-2, CA-8, CA-9. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: se leen los lados de cada tipo de conflicto con rutas validadas y cargas acotadas.
- Verificacion funcional: datos — cotejar con los archivos reales y `svn propget`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 4: Resolver y guardar (Rust) — cubre spec [CA-5, CA-6, CA-7, CA-9, CA-10, CA-11]
- Pasos:
  - [ ] 4.1 `ResolveRequest { targets, accept, depth }` (`resolve --accept X --targets <archivo>`, depth explícita; sin `-R` implícito), argumentos separados — fuente: `commands.rs` (patrón), M4; porque: Core Tenet 1.
  - [ ] 4.2 `app/conflicts/resolve.rs`: la petición lleva **identidad del conflicto** (revisiones izquierda y derecha, nombres de auxiliares), `working_version` y los **tipos cubiertos**; Rust compara con lo vigente y cancela si cambió; rechaza si la misma ruta tiene otro conflicto pendiente no confirmado (orden: texto antes que propiedades); solo ofrece las combinaciones de la matriz; `base`, `mine-full`, `theirs-full` y `*-conflict` inválidos para árbol se rechazan; las que descartan cambios exigen `confirmed` y una vista previa (tamaños, huella, líneas de cada lado; sin diff); `working` nunca es implícito — fuente: M4; porque: CA-5, CA-6, CA-7.
  - [ ] 4.3 Marcadores: al resolver, Rust revisa el archivo de trabajo por la estructura `<<<<<<<` … `=======` … `>>>>>>>` bien emparejada (con `|||||||` opcional) y exige `confirmed` si queda — fuente: `design.md` §3; porque: CA-5 (no bloquear un `=======` de título).
  - [ ] 4.4 `app/conflicts/save.rs`: guarda el resultado con `FileService::write_text` (`expected_version`, atómico, solo lectura, bloqueo, `WorkingCopyBusy`); **no** llama a `resolve`; devuelve si quedan marcadores y si el fin de línea mixto se normalizó (aviso) — fuente: `app/files/edit.rs`, `text.rs:143-149`; porque: CA-5, CA-3.
  - [ ] 4.5 Árbol: `tree_resolve(path, choice, confirmed)` ejecuta `working`, `mine-conflict` o `recommended` (con descripción previa), o completa una guía manual ya hecha por el usuario con `resolve working`; candado por raíz y `StaleStatus` — fuente: M4; porque: CA-9.
  - [ ] 4.6 Lote: `resolve_many(targets, accept, confirmed)` sobre una lista explícita de texto y propiedades, comparada con la lista vigente al ejecutar, con resultados parciales — fuente: Revisión adversarial; porque: CA-10.
  - [ ] 4.7 Commands `conflicts_resolve_preview`, `conflicts_resolve`, `conflicts_save`, `conflicts_tree_resolve`, `conflicts_resolve_many`; registro, contrato y envoltorios; progreso y cancelación por `OperationManager` — fuente: `commands/mod.rs`; porque: tipados.
  - [ ] 4.8 pruebas unitarias — `test-gen` y `flow-test-gen`: ruta `CC` resuelta solo-texto (rechazada con propiedad pendiente), cada `accept` válido por tipo y los inválidos rechazados, sin confirmación rechazado, identidad vencida (otro update), archivo cambiado en disco, guardar no marca resuelto, marcadores bien emparejados frente a `=======` de título, árbol en cada escenario, lote con un conflicto nuevo intercalado, cancelación — fuente: `tests/svn_operations.rs`; porque: CA-5 a CA-10. doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (guardar → marcar resuelto), `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `rust-check`, `rust-test`, `format`.
- Criterio de aceptacion: resolver es siempre explícito, atado a la identidad del conflicto, con confirmación donde descarta y sin cerrar conflictos no vistos.
- Verificacion funcional: datos — `svn status` real tras cada resolución.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 5: Fusión de tres vías (`diff3`) — cubre spec [CA-3, CA-15]
- Justificacion / fuentes: no hay biblioteca ni código de merge; el algoritmo es el corazón del editor y se aísla para probarlo a fondo. **Puede desarrollarse en paralelo con los increments 2 a 4** (no depende de Rust).
- Pasos:
  - [ ] 5.1 `src/conflicts/diff3.ts` en un Worker (`?worker`, como Monaco): líneas internadas a enteros, recorte de prefijo y sufijo comunes, diff por **espacio lineal** (punto medio de Myers) con `D` máximo, de `base→mine` y `base→theirs`, y fusión de regiones: limpia si solo un lado cambió o ambos cambiaron igual, conflicto si cambiaron distinto; regiones solapadas o adyacentes se agrupan y **una región donde mío == suyo es limpia**; compara líneas sin terminador; sin dependencias — fuente: Myers 1986; porque: CA-3 (el Myers con traza es O(D²) en memoria y se agota con 50 000 líneas cambiadas).
  - [ ] 5.2 Coste: si `D` supera el tope, devuelve «elegir un lado» con el motivo; el fin de línea mixto se detecta y se informa — porque: CA-3.
  - [ ] 5.3 `renderResult(hunks, choices)`, `findMarkers(text)` (estructura emparejada, no líneas sueltas) — fuente: `design.md` §3; porque: CA-5.
  - [ ] 5.4 ADR 0017 (propuesto) — fuente: `docs/adr/0000-template.md`; porque: decisión significativa.
  - [ ] 5.5 pruebas unitarias — `test-gen`: propiedades (`merge(b,a,a)=a`, `merge(b,b,x)=x`, `merge(b,a,b)=a`, intercambiar mío y suyo intercambia los lados de cada conflicto, no pierde ni duplica líneas, idempotencia, concatenación de bloques reproduce el resultado), casos de tabla (inserciones, borrados, movimientos, líneas repetidas, falsos conflictos por bloque repetido, CRLF mixto, sin salto final), rendimiento con 50 000 líneas, cambio masivo de EOL (D≈N), caso patológico, mutación con Stryker; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `adr-new`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`; mutación.
- Criterio de aceptacion: `diff3` pasa las propiedades y el rendimiento medido, y la mutación no deja sobrevivientes relevantes.
- Verificacion funcional: no aplica: módulo puro; lo cubren las pruebas de propiedades y la mutación.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 6: Editor de tres vías — modelo de bloques y ediciones — cubre spec [CA-3, CA-4]
- Pasos:
  - [ ] 6.1 `src/conflicts/blocks.ts`: modelo de bloques **derivado del contenido del modelo del resultado** (no estado aparte): cada bloque se reconoce por su rango y su contenido (limpio, mío, suyo, ambos, ninguno, editado, pendiente); elegir un lado es una edición del resultado (para que deshacer y rehacer funcionen) — fuente: Revisión adversarial; porque: CA-4 (`renderResult` regenerado pisaría las ediciones manuales).
  - [ ] 6.2 Navegación: siguiente y anterior conflicto, contador de pendientes, «Combinar» (aceptar los limpios) — porque: CA-4.
  - [ ] 6.3 Carga de lados por separado y bajo demanda (`conflicts_side`), validación del tamaño antes de «Ambos» y aviso de EOL mixto — fuente: I3; porque: CA-4.
  - [ ] 6.4 pruebas unitarias — `test-gen`: derivación del estado, elegir y deshacer, edición a mano de un bloque, navegación, tamaño de «Ambos»; Vitest y Stryker; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`; mutación.
- Criterio de aceptacion: el estado de los bloques sale del contenido y deshacer funciona.
- Verificacion funcional: no aplica: lógica pura del frontend; la cubren las pruebas de unidad.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 7: Editor de tres vías — vistas Monaco y alineación — cubre spec [CA-4, CA-11, CA-13]
- Pasos:
  - [ ] 7.1 Módulo de bajo nivel nuevo `documents/monaco/lowlevel.ts`: crea editores y modelos a pedido del llamador y expone el editor (decoraciones, `revealLine`, scroll, `executeEdits`); minimapa apagado; `unicodeHighlight` activo; `openViewer` no cambia — fuente: `documents/monaco/setup.ts`; porque: hoy no hay forma de usar Monaco así.
  - [ ] 7.2 `components/conflicts/MergeEditor.vue`: BASE, MÍO y SUYO de solo lectura y resultado editable; desplazamiento alineado **por bloque** con zonas de vista (no por `scrollTop`); resaltado de bloques y de su estado; umbrales de M6 verificados — fuente: M6; porque: CA-4.
  - [ ] 7.3 Panel de bloques con atajos documentados, roles y nombres por panel, foco visible, texto además de color, tokens del tema — porque: CA-13.
  - [ ] 7.4 pruebas unitarias — `test-gen`: alineación, atajos, accesibilidad; E2E (`conflicts-editor.e2e.ts`) esperando pintado real (T-26); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`; auditoría con `bossdream-design-auditor`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: cuatro paneles alineados, accesibles y dentro de los umbrales medidos.
- Verificacion funcional: navegador — ventana real vía CDP con un conflicto real.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 8: Editor de tres vías — guardar, resolver y cierre — cubre spec [CA-5, CA-6, CA-7, CA-14]
- Pasos:
  - [ ] 8.1 «Guardar resultado» (I4) y «Marcar como resuelto» como acciones **separadas**; el segundo manda identidad y versión, está deshabilitado con explicación si hay bloques pendientes, marcadores o **un conflicto de propiedades pendiente en la misma ruta**, y tiene un modo «marcar de todos modos» con confirmación — fuente: I4; porque: CA-5, CA-6.
  - [ ] 8.2 «Usar mío / Usar suyo / Base» con la vista previa y confirmación de I4; «Editar manualmente» activa la edición libre — porque: CA-7.
  - [ ] 8.3 La vista participa en el estado «sucio» de las pestañas (`setDirty`) y registra el guard de cierre de ventana con el diálogo de tres salidas de la 2A — fuente: `tabs.ts:116,206`, `useWindowClose.ts:14-18`; porque: CA-5.
  - [ ] 8.4 Conflicto de edición: si el archivo cambió en disco, Cancelar, Recargar o Sobrescribir como en la 2A — fuente: `documents.ts`; porque: CA-14.
  - [ ] 8.5 E2E (`conflicts-text.e2e.ts`): provocar un conflicto real, abrirlo, aceptar bloques con teclado, editar, guardar, marcar resuelto y comprobar con `svn status`; ruta con texto y propiedad; archivo cambiado en disco; cerrar sin guardar — porque: CA-5, CA-6.
  - [ ] 8.6 pruebas unitarias — `test-gen` y `flow-test-gen`: habilitado de «Marcar como resuelto», guardia de cierre, conflicto de edición, flujo guardar → resolver; Vitest y Stryker; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: un conflicto de texto real se resuelve de punta a punta sin marcar nada solo ni dejar propiedades sin ver.
- Verificacion funcional: navegador — ventana real vía CDP, resultado cotejado con `svn status` y el contenido en disco.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 9: Propiedades y binarios (interfaz) — cubre spec [CA-7, CA-8, CA-11, CA-13]
- Pasos:
  - [ ] 9.1 `PropConflictView.vue`: propiedad, base, mío y suyo (escapados y acotados), elegir uno o escribir otro validado por la Fase 4; para `svn:mergeinfo` solo mío/suyo; directorios con `dir_conflicts.prej` — fuente: Fase 4 I13; porque: CA-8.
  - [ ] 9.2 `BinaryConflictView.vue` (también para texto no UTF-8 y para lo que `svn` trata como binario): tamaños y huella de MÍO y SUYO, «Usar mío» / «Usar suyo» con confirmación; sin vista de contenido — porque: CA-7.
  - [ ] 9.3 Resolución de propiedades con `accept` o `propset` + `resolve` según la matriz; la ruta con texto pendiente lo avisa — fuente: I4; porque: CA-6.
  - [ ] 9.4 pruebas unitarias — `test-gen`: escape, valor enorme, bidi, elegir/escribir/validar, `svn:mergeinfo`, binario sin contenido, Vitest; E2E (`conflicts-props.e2e.ts`); `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: conflictos de propiedades y binarios se resuelven con confirmación y sin simular fusiones.
- Verificacion funcional: navegador — ventana real vía CDP, cotejado con `svn proplist`.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 10: Conflictos de árbol (interfaz) — cubre spec [CA-9, CA-12, CA-13]
- Pasos:
  - [ ] 10.1 `TreeConflictView.vue`: `describeTreeConflict` pura con la tabla de escenarios del vocabulario de M3 (incluido «borrado o movido» y víctima ausente) — fuente: `propuesta.md` §45; porque: CA-9.
  - [ ] 10.2 Salidas: las admitidas por la matriz (`working`, `mine-conflict` donde aplique), la **guía manual** con secuencias exactas (revertir, borrar, mover, agregar de la Fase 4 y luego «marcar resuelto»), cada una con lo que se pierde, confirmación y respaldo, y el botón «Aplicar la recomendación de Subversion» con su descripción — fuente: I3 paso 3.4, Fase 4 I4/I5; porque: CA-9 (decisión del usuario).
  - [ ] 10.3 Escenario desconocido: texto crudo de `svn`, sin resolución automática, «Marcar como resuelto» con advertencia — porque: CA-12.
  - [ ] 10.4 pruebas unitarias — `test-gen` y `flow-test-gen`: `describeTreeConflict` por escenario y operación, salidas válidas por escenario, desconocido, guía manual, confirmaciones; E2E (`conflicts-tree.e2e.ts`) con un escenario real de update y uno de merge; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `flow-test-gen` (escenario → opción → estado), `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: cada escenario de árbol medido se describe y se resuelve con salidas válidas o una guía honesta.
- Verificacion funcional: navegador — ventana real vía CDP, cotejado con `svn status` y el árbol en disco.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 11: Centro de conflictos e integración — cubre spec [CA-1, CA-10, CA-14]
- Pasos:
  - [ ] 11.1 Vista `svn_view` «Conflictos»: lista de (ruta, tipo, origen) con acceso a cada editor y «resolver todo con Mío/Suyo» sobre una **lista explícita** de texto y propiedades, confirmada, comparada al ejecutar y con resultados parciales — fuente: Fase 4 I3, I4 paso 4.6; porque: CA-10.
  - [ ] 11.2 Aviso unificado tras update (Fase 1), switch y merge (Fase 5) con el conteo canónico y un botón «Abrir conflictos»; su resultado no cambia — fuente: Fase 5 I5/I9; porque: CA-10, CA-14.
  - [ ] 11.3 Conexión con el Centro de cambios (la acción «resolver» abre el conflicto; los auxiliares ya no se ofrecen como no versionados), el explorador (distintivo → «Resolver conflicto») y el preflight del commit (el aviso enlaza al centro; no resuelve nada) — fuente: Fase 4 I15/I16; porque: CA-1, CA-10.
  - [ ] 11.4 E2E (`conflicts-center.e2e.ts`): update con dos conflictos, abrir el centro, resolver uno, «resolver todo» con confirmación, comprobar con `svn status`; con teclado — porque: CA-10, CA-13.
  - [ ] 11.5 pruebas unitarias — `test-gen`: store del centro, aviso con y sin conflictos, enlaces, confirmación del lote, lote con conflicto nuevo intercalado, respuesta atrasada, con Vitest y Stryker; `a11y`; doc-check — `docs-rewrite`.
- Conexiones: `test-gen`, `theme-first`, `docs-rewrite`, `rules-comentarios`.
- Pipeline del increment: `build`, `unit`, `format`, `theme-check`; E2E.
- Criterio de aceptacion: tras una operación con conflictos se llega al centro y se resuelven todos con las garantías de cada tipo.
- Verificacion funcional: navegador — ventana real vía CDP.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 12: Documentación — cubre spec [CA-16]
- Pasos:
  - [ ] 12.1 Crear `docs/conflicts.md` (lo prevé el roadmap: tipos, qué deja Subversion y por operación, `--accept postpone`, editor de tres vías, `diff3` y sus reglas, resolver explícito con identidad y tipos, matriz de `resolve`, árbol con guía manual y recomendación, propiedades por `propget`, límites y EOL) con símbolos reales — fuente: `docs/branching.md` (formato); porque: CA-16.
  - [ ] 12.2 Actualizar `docs/svn-integration.md`, `security.md`, `testing.md`, `ARCHITECTURE.md` (módulo `app/conflicts/`, `src/conflicts/`), `editors.md` y `roadmap.md` (Fases 3 a 6 hechas); ADR 0017 a `accepted`; deuda a `TECH_DEBT.md`; `docs-rewrite --check` — porque: CA-16.
  - [ ] 12.3 pruebas unitarias — `test-gen`: no aplica; doc-check — `docs-rewrite`.
- Conexiones: `docs-rewrite`, `adr-new`, `tech-debt`.
- Pipeline del increment: `format`.
- Criterio de aceptacion: documentación coherente con el código.
- Verificacion funcional: no aplica: solo documentación; se cotejan afirmaciones con el código.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

### Increment 13: QA Increment — cubre spec [CA-15]
- Pasos:
  - [ ] 13.1 `qa-increment` (modo de `bossdream.json > qa.mode`): Test Inventory con `bossdream-qa-gatekeeper`; `qa-run` con auditor adversarial y flow-breaker (editar → guardar → resolver, descartar con confirmación, cerrar con resultado sin guardar, ruta con varios conflictos) — fuente: skills `qa-increment`, `qa-run`, `test-checks`; porque: veredicto independiente.
  - [ ] 13.2 `test-checks`: `cargo check`, `cargo test`, `npm test`, `npm run build`, mutación de Rust y frontend (incluido `diff3`), E2E de las Fases 2A a 6 sin regresiones, `tauri build` — fuente: `pipeline.json`; porque: CA-15.
  - [ ] 13.3 Corregir hasta ACCEPTED y marcar cada CA con `[x]`/`[~]` y motivo — porque: honestidad.
  - [ ] 13.4 pruebas unitarias — `test-gen`: las del QA; doc-check — `docs-rewrite`.
- Conexiones: `qa-increment`, `qa-run`, `test-checks`, `flow-test-gen`, `docs-rewrite`.
- Pipeline del increment: todos los gates de `completion.json`.
- Criterio de aceptacion: QA Increment ACCEPTED con evidencia.
- Verificacion funcional: navegador — E2E de la fase sobre el ejecutable de depuración y el de release.
- Revision de planeacion: PASO (v2, tras revisión adversarial)

## Revision adversarial
Revisión de un subagente `general-purpose` (probada con `svn` 1.14.2 y 1.15.0), `bossdream-completeness-auditor` y `bossdream-document-explorer`. Aplicado: #1 (`--accept postpone`, Fase 5 I3 y M1), #2 y el bloqueante del auditor (clave (ruta, tipo), tipos cubiertos, orden texto→propiedades), #3 y #4 (`info` deduplicado; propiedades por `propget`, sin `.prej`), #5 (`svn:mergeinfo` solo mío/suyo), #6 y #7 (matriz y vocabulario de árbol; guía manual; decisión del usuario), #8 (versiones), #9 y #10 (auxiliares de `info` y filtrado), #11 (conteo canónico), #12 y #13 (EOL y codificación), #14 y #15 (identidad, versión y marcadores emparejados), #16 (vista previa sin diff), #17 (lote explícito), #18 (`info --targets`), #19 (`diff3` de espacio lineal, Worker, regiones), #20 y #21 (Monaco de bajo nivel y estado derivado), #22 (`setDirty`), #23 (lados bajo demanda), #24 y #25 (división de I2 e I5; paralelismo de `diff3`), #26 (etiquetas por operación), #27 (`unicodeHighlight`), #28 (redacción y saneado). Decisiones del usuario aplicadas: `--accept postpone` y conflictos de árbol. Pendiente de lectura del usuario: `design.md` completo.
