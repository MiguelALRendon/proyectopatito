---
fecha: 2026-10-23
estado: BORRADOR v2 para lectura del usuario. Decidido por el usuario el 2026-10-23: editor de 3 vías propio sobre Monaco; `--accept postpone` explícito; conflictos de árbol = salidas admitidas + guía manual + botón de recomendación. El resto lo propone el plan y no pasó por aprobación sección por sección
fase: 6
depende_de: fase-4-svn-avanzado (pestañas svn_view, Monaco, edición atómica, Centro de cambios, candado por raíz, respaldo y token), fase-5-branching (merge y switch con `--accept postpone`)
---

# Diseño — Fase 6: Conflictos

Fuente: `propuesta.md` §43-45, §44, §81 y §16. Base: Fases 1 a 5. Subversion detecta y marca los conflictos (con `--accept postpone` explícito, desde la Fase 5); la aplicación los presenta y resuelve con `svn resolve` solo cuando el usuario lo pide.

## 0. Decisiones

| Tema | Decisión |
|---|---|
| Editor | Tres vías propio sobre Monaco (decisión del usuario): BASE / MÍO / SUYO de solo lectura y resultado editable, con aceptar por bloque, siguiente/anterior y marcado explícito |
| Fusión | `diff3` en TypeScript puro, en un Worker, sin dependencias: líneas internadas, recorte de prefijo y sufijo, diff de espacio lineal (punto medio de Myers) con `D` máximo; comparación sin terminadores; región con mío == suyo = limpia |
| Resolver | Siempre explícito (§44). Clave de conflicto = (ruta, tipo). Una petición de resolver declara los tipos que cubre; Rust rechaza si hay otro pendiente sin confirmar (porque `resolve --accept working` los cierra todos) |
| Árbol | `working` siempre; `mine-conflict` solo donde la matriz medida lo acepta; guía manual con las operaciones de la Fase 4; botón «aplicar recomendación» (`--accept recommended`) con descripción y confirmación; Rust rechaza `base`/`*-full` en árbol (decisión del usuario) |
| Propiedades | Valores por `svn propget` (WORKING, BASE o `URL@rev`); el `.prej` no se interpreta; `svn:mergeinfo` solo mío/suyo |
| Archivos auxiliares | Los nombres salen de `svn info` (deduplicado y sin confiar en `prop-file`); archivos regulares dentro del Workspace; se filtran de «no versionados» |
| Límites | `MAX_MERGE_BYTES` 5 MiB, `MAX_MERGE_LINES` 50 000, `MAX_LINE_BYTES` 64 KiB, `MAX_CONFLICTS_LISTED` 2 000 |
| Versión | Mediciones con el `svn` empaquetado (1.14.5) y la mínima (1.10); si las diferencias lo exigen, 1.14 es el mínimo del Centro de conflictos con degradación y aviso |

## 1. Arquitectura

- **`svn/`**: `ResolveRequest { paths (por --targets), accept, depth }`, `PropgetRequest` para los lados de propiedades, parsers de `info --xml` con conflictos (deduplicación, atributos sin orden fijo) y vocabulario de árbol.
- **`app/conflicts/`**: `list`, `sides` (bajo demanda, por lado), `props`, `tree`, `resolve` (identidad del conflicto, tipos cubiertos, marcadores, confirmaciones), `save`.
- **Frontend**: `src/conflicts/` con `diff3.worker.ts`, `blocks.ts` (modelo de bloques derivado del contenido), editor, vistas de propiedades, binarios y árbol, y el centro.
- **Monaco**: módulo de bajo nivel nuevo (no `openViewer`): editores y modelos creados por el llamador, minimapa apagado, `unicodeHighlight` activo, alineación por bloque con zonas de vista; el resto de `setup.ts` no cambia.

## 2. Modelo

| Modelo | Campos |
|---|---|
| `Conflict` | `id = (ruta, tipo)`, `kind` (`Text`, `Property`, `Tree`, `Binary`), `operation` (`Update`, `Switch`, `Merge`), `identity` (revisiones izquierda y derecha, nombres de auxiliares) |
| `TextSides` (por lado, bajo demanda) | `base`, `mine`, `theirs`, `working`, codificación, fin de línea, `working_version` |
| `PropConflict` | `property`, `base`, `mine`, `theirs` (de `propget`), `message` crudo |
| `TreeConflict` | `operation`, `action ∈ {edit, add, delete, replace}`, `reason ∈ {edit, delete, missing, obstruction, add, replace, unversioned, moved-away, moved-here}`, `victim`, versiones, `victim_exists` |
| `Accept` | `Working`, `Base`, `MineFull`, `TheirsFull`, `MineConflict`, `TheirsConflict`, `Recommended` (según la matriz) |
| `Hunk` (frontend) | `Clean` o `Conflict { base, mine, theirs }`; el estado (`Pending`, `Mine`, `Theirs`, `Both`, `None`, `Edited`) se deriva del contenido del modelo |

## 3. Flujos

- **Detectar.** Tras la operación, `status` da la lista de (ruta, tipo); `info --targets` por lotes completa el detalle; el conteo canónico sale de ahí.
- **Texto.** `sides` entrega cada lado bajo demanda con su codificación; el Worker corre `diff3`; el resultado inicial se escribe en el modelo de Monaco y cada elección es una edición (deshacer funciona). «Guardar resultado» pasa por `FileService` con `expected_version`; «Marcar como resuelto» manda la identidad del conflicto y la versión; Rust revisa marcadores y tipos pendientes.
- **Propiedades.** Tres valores por `propget`; elección o valor propio validado; resolución por `accept` o `propset` + `resolve` según la matriz; `svn:mergeinfo` solo mío/suyo.
- **Árbol.** `describeTreeConflict` con la tabla de escenarios; salidas admitidas por la matriz; guía manual con secuencias exactas; recomendación de Subversion con descripción y confirmación.
- **Binarios y no UTF-8.** Elegir un lado con tamaños y huellas.
- **Por lotes.** `--targets` con el conjunto confirmado, solo texto y propiedades, comparado con la lista vigente, resultados parciales.

## 4. Seguridad

- Nombres de auxiliares de `info`, validados (archivo regular, misma carpeta o la del directorio, dentro del root, sin `..`).
- Contenido hostil: topes, escape de controles y bidireccionales, `unicodeHighlight`, sin HTML.
- Confirmación en Rust; identidad y versión comparadas antes de resolver; resolver nunca por guardar, cerrar o cambiar de pestaña.
- Guardado con versión esperada, candado por raíz y solo lectura/bloqueo ya existentes.

## 5. Fuera de la Fase 6

Herramientas de merge externas, resolución interactiva, contenido de binarios u Office, historial de resoluciones, deshacer una resolución, algoritmo de diff en Rust.

## 6. Pruebas

- **diff3**: propiedades (`merge(b,a,a)=a`, `merge(b,b,x)=x`, `merge(b,a,b)=a`, simetría al intercambiar lados, sin pérdida ni duplicados, idempotencia), tabla de casos, EOL, líneas repetidas, coste patológico y 50 000 líneas; mutación con Stryker.
- **Subversion real** (con el `svn` empaquetado y el mínimo): conflictos de texto en update, switch y merge; ruta con texto + propiedad (`CC`); propiedades; cada escenario de árbol (matriz medida); binarios por `svn:mime-type`; UTF-16 marcado binario; `.N.` por auxiliar preexistente; directorio con `dir_conflicts.prej`; varios conflictos; `--accept` válidos e inválidos por tipo; cancelar; guardar con archivo cambiado.
- **Adversariales**: auxiliares con nombres hostiles, archivos enormes, línea gigante, marcadores falsos (título Markdown con `=======`), resolver sin confirmación o con otro conflicto pendiente, ruta fuera del conflicto, identidad vencida, lote con conflicto nuevo intercalado.
- **Frontend**: Vitest y Stryker; E2E con teclado esperando pintado real (T-26).

## 7. Increments previstos

1 Medir. 2 Modelo: parsers y lista (Rust). 3 Modelo: lados, propiedades y árbol (Rust). 4 Resolver y guardar (Rust). 5 `diff3` (en paralelo posible con 2 a 4). 6 Editor: modelo de bloques y ediciones. 7 Editor: vistas Monaco y alineación. 8 Editor: guardar, resolver, cierre y E2E. 9 Propiedades y binarios (interfaz). 10 Árbol (interfaz). 11 Centro de conflictos e integración. 12 Documentación. 13 QA.
