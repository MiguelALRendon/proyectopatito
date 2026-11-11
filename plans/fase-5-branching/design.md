---
fecha: 2026-10-23
estado: BORRADOR v2 para lectura del usuario. Decidido por el usuario el 2026-10-23: gráfico interactivo con zoom y pan; `--accept postpone` explícito; bloqueo de merge sobre copia de revisión mezclada con «actualizar primero»; `--pin-externals` activado en tags y apagado en ramas. El resto lo propone el plan y no pasó por aprobación sección por sección
fase: 5
depende_de: fase-3-marketplace (repositorios, remote_url, opciones de red), fase-4-svn-avanzado (log, svn_view, preflight y commit selectivo, menú contextual, candado por raíz)
---

# Diseño — Fase 5: Branching

Fuente: `propuesta.md` §46-49, §61, §94-95 y §33. Base: Fases 1 a 4. Todo lo hace `svn.exe`; el gráfico de revisiones no existe en Subversion y se calcula con `svn log`.

## 0. Decisiones

| Tema | Decisión |
|---|---|
| Alcance | Branch, tag, switch, merge (rango, dos árboles y automático), mergeinfo, gráfico, clasificación con patrones, aviso de commit sobre tag, revertir una revisión (merge inverso) y resolución pospuesta explícita |
| Resolución | `update`, `switch` y `merge` con `--accept postpone`; el recuento de conflictos sale de `status` |
| Raíz del repositorio | `RepoRef { uuid, root, url }` se resuelve del `svn info` de la copia o del registro (la Fase 3 guarda UUID y raíz al probar la conexión); origen y destino pueden ser cualquier ruta bajo la **raíz real**, no solo bajo la URL registrada |
| Merge | Precondiciones duras por modo (ver §3); vista previa anclada a `URL@N`; parsers propios de la salida; sin `--allow-mixed-revisions` |
| Gráfico | SVG propio con zoom y pan y lista accesible; identidad de línea = (ruta, revisión de alta); fusiones bajo demanda; método de escaneo elegido con datos del spike (log completo por tramos frente a `ls` de `branches/`/`tags/` más `log --stop-on-copy` por rama) |
| Seguridad | URLs solo en Rust; confirmaciones en Rust; destino de `copy` inexistente comprobado por `NotFound` |

## 1. Arquitectura

- **`svn/`**: `RepoCopyRequest` (URL→URL y copia de trabajo→URL; la `CopyRequest` de la Fase 4 es local→local), `SwitchRequest`, `MergeRequest` (modos `Range`, `Trees`, `Automatic`, `--dry-run`, `--record-only`, `--ignore-ancestry`, `--depth`), `MergeinfoRequest` (`--show-revs`), `UpdateRequest` gana `--accept postpone`, y parsers propios `parse_merge_output`/`parse_switch_output` (columna de árbol, `Skipped`, `Summary of conflicts` por categoría) con variantes nuevas de `ProgressAction` y contrato actualizado.
- **`app/branching/`**: `repo_ref`, `classify`, `branch_tag`, `switch`, `merge`, `mergeinfo`, `graph`; `AppState` delega.
- **Operaciones de repositorio**: una variante de `guarded` sin `ScopedPath` con clave `repo:<uuid>:<destino>`; las de copia de trabajo→URL, switch y merge toman el candado por raíz de copia (Fase 4).
- **Frontend**: asistentes en `BaseModal`, pestañas `svn_view` de mergeinfo y gráfico, acciones en menú, log y Marketplace.

## 2. Modelo y constantes

`Layout { trunk, branches, tags }` (globs sobre la ruta relativa a la raíz; por defecto `trunk`, `*/trunk`, `branches/*`, `*/branches/*`, `tags/*`, `*/tags/*`), `Location`, `CopySource { Head, Revision(n), WorkingCopy }`, `MergeSpec`, `MergePreview { items, conflicts, skipped, kind: Sync|Reintegrate|Range|Trees, anchored_rev }`, `MergeResult { touched, conflicts, skipped, mergeinfo_changed, incomplete }`, `MergeinfoView`, `GraphLine { path, born, died?, lane }`, `GraphEdge`.
Constantes: `MAX_GRAPH_REVISIONS` 50 000, `MAX_GRAPH_NODES` 2 000, `GRAPH_PAGE` 1 000, `GRAPH_PAGE_TIMEOUT` 120 s, `MAX_MERGE_RANGES` 200, `MAX_PREVIEW_ITEMS` 10 000 (los topes del gráfico se confirman con M5 y M6).

## 3. Flujos

- **Resolución pospuesta.** `--accept postpone` en update, switch y merge; el parser de progreso ignora `Searching tree conflict details…`/`Checking rN…`; los conflictos se cuentan con `status`.
- **Branch/Tag.** Preflight: mismo UUID; destino por `svn info` con **solo `NotFound`** como autorización; un único origen; origen «revisión N» = `URL@N`; `--parents`, `--pin-externals` (tags: activada), mensaje obligatorio por archivo; tras el commit, `svn ls` del destino para detectar copia anidada; switch opcional encadenado (depende del Increment de Switch).
- **Switch.** Misma UUID; sin vista previa; `--set-depth` único; `--ignore-ancestry` con confirmación; conflictos por `status`.
- **Merge.** Preflight en Rust: objetivo = raíz de rama (subcarpeta = aviso), profundidad completa, sin subárboles con switch, aviso si `classify` es Tag, UUID del origen, rangos válidos; **revisión mezclada → bloqueo con «Actualizar primero»** (se detecta con el propio `--dry-run`, `E195020`, no con `svnversion`); **modo automático**: cambios locales, switch o revisión mezclada = rechazo; rango/dos árboles con cambios locales = confirmación fuerte («no se podrá deshacer»); el HEAD del origen se resuelve al abrir el asistente y vista previa y ejecución usan `URL@N`. Resultado con `skipped` y `conflicts`; `incomplete` si se canceló.
- **Revertir revisión.** `MergeSpec::Range { reverse }` desde el log.
- **Mergeinfo.** Líneas `rN` de `--show-revs`; mensajes con `svn log -r N --xml` bajo demanda; profundidad declarada; crudo con `propget -R`.
- **Gráfico.** Escaneo por tramos con plazo, descartando todo salvo altas con `copyfrom`, borrados y raíces de rama; líneas con identidad (ruta, alta) y regla de renombrado; carriles reciclados (coloreado de intervalos); eje por orden de eventos con huecos comprimidos; agrupación por prefijo y antigüedad; «origen anterior a la ventana»; x estable al cargar tramos más antiguos; fusiones por pares bajo demanda (`mergeinfo` con `URL@rev`).
- **Clasificación.** `classify(uuid, ruta_relativa)` con el layout del repositorio de ese UUID o el por defecto.

## 4. Seguridad

- Toda URL se arma en Rust con la raíz real; ninguna llega del frontend.
- Confirmaciones en Rust para `record-only`, `ignore-ancestry` (merge y switch), merge sobre copia con cambios locales, y commit sobre tag.
- Destino de `copy` inexistente por `NotFound`; verificación posterior contra copia anidada.
- Texto remoto escapado y acotado, también dentro del SVG.
- El gráfico es lectura pura; respeta plazo, cancelación y topes.

## 5. Fuera de la Fase 5

Reintegración con asistente propio, relocate, flechas de fusión para todo el repositorio, caché persistente (§105), `--allow-mixed-revisions`, resolución de conflictos (Fase 6).

## 6. Pruebas

Repositorios reales con trunk, ramas, tags, ramas de ramas, borrados, renombrados y recreaciones; merges de rango, dos árboles y automáticos con y sin conflictos, con rutas **omitidas** (obstrucción), con copia mezclada (`E195020`), sucia, con switch y en tag; `record-only`; merge inverso; switch con cambios locales; mergeinfo con rangos no contiguos y rama borrada; salida real de `merge`/`switch` con `\r`; gráfico sobre un repositorio sintético (el generador cuesta horas: se hace aparte y se cachea fuera de CI) con muchos tags; adversariales: destino existente, carrera, origen de otro repositorio, rangos enormes, nombres con bidi. Vitest y Stryker; E2E con teclado; prueba de rendimiento del SVG.

## 7. Increments previstos

1 Medir operaciones. 2 Medir el gráfico. 3 Resolución pospuesta, RepoRef y bloqueo de repositorio. 4 Clasificación y aviso de tag. 5 Switch. 6 Branch/Tag (Rust). 7 Branch/Tag (interfaz). 8 Merge: peticiones, parsers y vista previa. 9 Merge: preflight, ejecución y resultado. 10 Merge (interfaz). 11 Revertir revisión y acciones del log. 12 Mergeinfo. 13 Gráfico: escaneo y líneas. 14 Gráfico: layout y agrupación. 15 Gráfico: viewport y render. 16 Gráfico: lista, selección y acciones. 17 Documentación. 18 QA.
