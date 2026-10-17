---
id: ref-workspace
title: Workspace Root y validación de rutas
type: reference
status: current
source: code
last_verified: 2026-10-16
symbols: [Workspace, ScopedPath, WorkspaceError, resolve, revalidate, FileService, normalize]
related: [ref-architecture, ref-security, adr-0001, adr-0007]
---

# Workspace Root y validación de rutas

El Workspace Root es la única carpeta del disco que la aplicación toca por orden del usuario. Todo destino pasa por `Workspace::resolve` y viaja como `ScopedPath` (Core Tenet 3 de [la constitución](constitution.md)). La validación vive en Rust (`src-tauri/src/app/workspace.rs`); el frontend nunca decide si una ruta es segura.

## El root

| Hecho | Anclaje |
|---|---|
| `Workspace::new(path)` canonicaliza la ruta, exige que sea un directorio y guarda la ruta sin el prefijo `\\?\` (`\\?\UNC\` pasa a `\\`); si no existe o no es directorio devuelve `RootInvalid` | `src-tauri/src/app/workspace.rs` (`new`, `strip_verbatim`) |
| El root se guarda en `config.json` (`workspace_root`) al llamar `workspace_set`; al arrancar `AppState::new` lo reconstruye y, si ya no es válido, queda sin workspace | `src-tauri/src/app/state.rs` (`workspace_set`, `AppState::new`) |
| Sin workspace, los commands que lo necesitan fallan con el `kind` `no_workspace` | `src-tauri/src/app/error.rs` (`CommandError::no_workspace`) |
| El diálogo nativo solo sirve para elegir una carpeta (`dialog:allow-open`); la ruta elegida vuelve a pasar por `workspace_set` | `src-tauri/capabilities/default.json`, `src/services/tauri.ts` |

## Tipos

| Tipo | Papel |
|---|---|
| `Workspace` | `new`, `root`, `resolve`, `revalidate`, `is_inside` y `relative_path` (este último `pub(crate)`) |
| `WorkspaceRoot` | El root canónico; solo expone `as_path` |
| `ScopedPath` | Ruta ya resuelta y contenida en el root; el único tipo que aceptan `FileService`, `Operations` y el protocolo de archivos. Solo se construye dentro de `workspace.rs` |
| `WorkspaceError` | `OutsideWorkspace`, `ParentTraversal`, `DeviceOrReservedPath`, `DestinationExists`, `RootInvalid`, `Io` |

## `resolve`, `revalidate` e `is_inside`

`resolve(path, allow_overwrite)` hace, en este orden:

1. Rechaza componentes peligrosos del texto de la ruta (tabla siguiente).
2. Une `root.join(path)` y canonicaliza el ancestro más profundo que exista; lo que no existe se vuelve a agregar como cola. Así se resuelven symlinks y junctions reales sin exigir que el destino exista.
3. Comprueba que el resultado quede contenido en el root. La comparación es por **componentes en minúsculas** (`component_keys`), no por prefijo de texto: una carpeta hermana `svn2` no pasa por parecerse al root `svn`, y un root escrito en mayúsculas sí se acepta.
4. Si `allow_overwrite` es `false` y el destino existe, devuelve `DestinationExists` (también para el propio root).

`revalidate(&ScopedPath)` repite los pasos 2 y 3 sobre una ruta ya resuelta; sirve para detectar que algo cambió entre resolver y usar. `is_inside(path)` devuelve solo el booleano (lo usa el listado para marcar enlaces).

Una ruta absoluta solo se acepta si cae dentro del root; `C:foo` (relativa a unidad) termina en `OutsideWorkspace`.

## Reglas de rutas

| Regla | Resultado | Dónde | Prueba |
|---|---|---|---|
| Componente `..` (al inicio o en medio) | `ParentTraversal` | `reject_unsafe_components` | `tests/workspace.rs` |
| Prefijos de dispositivo o verbatim (`\\.\`, `\\?\`); solo `Disk` y `UNC` son prefijos válidos | `DeviceOrReservedPath` | `is_plain_prefix` | `tests/workspace.rs` |
| Nombres reservados `CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `CLOCK$` y `COM1`-`COM9`/`LPT1`-`LPT9` (también con `¹²³`), con cualquier mayúscula y extensión, en cualquier componente; `COM0` y `COM10` no son reservados | `DeviceOrReservedPath` | `is_reserved_device_name` | `tests/workspace.rs` |
| Nombre que termina en punto o espacio, o que contiene `:` (flujos alternos `archivo.txt:flujo`) | `DeviceOrReservedPath` | `is_ambiguous_name` | `tests/workspace.rs` |
| Puntos y espacios dentro de un nombre (`copia v1.2`, `.oculta`) | Aceptados | igual | `tests/workspace.rs` |
| Nombre inválido para Windows (`*`) | `Io` | `canonicalize` | `tests/workspace.rs` |
| Destino bajo un archivo regular | `Io(NotADirectory)` | `canonicalize_deepest_ancestor` | `tests/workspace.rs` |
| Junction o symlink que sale del root | `OutsideWorkspace` | `resolve` / `revalidate` | `tests/workspace.rs`, `tests/files.rs` (el symlink solo se prueba si el sistema deja crearlo) |
| Destino cambiado por una junction entre `resolve` y el uso | `OutsideWorkspace` en `revalidate` | `revalidate` | `tests/workspace.rs` |

### `.svn` y `_svn`

Nada de los datos internos de Subversion se lista, se lee ni se sirve. `FileService::guard` revalida y recorre los componentes de la ruta relativa al root, ya canonicalizada; si alguno es `.svn` o `_svn` (sin distinguir mayúsculas, `is_forbidden_name`) devuelve `ForbiddenPath`. El listado oculta esas carpetas y los temporales `*.dd-tmp`. `ui_state` rechaza esas rutas al guardar, y el protocolo responde 403. Cubierto por `tests/files.rs` (incluye el nombre corto 8.3 de `.svn` y una junction que apunta a `.svn` dentro del root), `tests/ui_state.rs` y `tests/protocol.rs`.

La prueba del nombre 8.3 termina sin aserciones si el volumen no genera nombres cortos, de modo que puede pasar en vacío: deuda **T-17** en [TECH_DEBT](TECH_DEBT.md).

### Enlaces, junctions y `escapes_workspace`

El listado marca `is_link` en symlinks y junctions, y `escapes_workspace` cuando el enlace apunta fuera del root (`FileService::entry`). Una junction que sale del root se muestra marcada, pero no se puede navegar porque `resolve` la rechaza (`tests/files.rs`); una que apunta dentro del root es navegable como enlace.

Limitación abierta: entre validar la ruta y abrirla hay una ventana en la que un proceso con escritura en el workspace podría cambiar un componente por una junction (**T-15**). `revalidate` la acorta pero no la cierra.

### Archivos solo en la nube (OneDrive)

Un archivo es `cloud_only` si tiene alguno de los atributos `OFFLINE`, `RECALL_ON_OPEN` o `RECALL_ON_DATA_ACCESS` (`is_cloud_only`, `src-tauri/src/app/files/mod.rs`).

| Operación | Comportamiento |
|---|---|
| `fs_list` | Devuelve `cloud_only` por entrada; no abre archivos |
| `fs_probe` | Sin `allow_download` devuelve `kind: cloud` con el tamaño y **no lee un solo byte** (`tests/files.rs`); con `allow_download: true` (botón «Descargar y abrir») lee la cabecera |
| `fs_read_text`, `fs_write_text`, `fs_read_chunk`, protocolo, apertura externa | `CloudOnly` (el protocolo responde 403) a través de `regular_file` |

La detección de «copia de trabajo bajo OneDrive» en el panel es solo por nombre de carpeta (`isUnderOneDrive` en `src/utils/folderPaths.ts`) y avisa que consultar el estado puede descargar archivos; no cubre carpetas reubicadas (**T-20**).

## Favoritos y estado de interfaz (`UiState`)

Favoritos, pestañas, pestaña activa y vista por carpeta viven en la sección `ui` de `config.json` con **rutas relativas al root** ([ADR 0007](adr/0007-estado-de-interfaz-en-config-json.md)). `normalize` (`src-tauri/src/app/ui_state.rs`) valida cada ruta antes de guardar:

- Rechaza rutas con prefijo o raíz (`OutsideWorkspace`), separa por `/` y `\`, descarta componentes vacíos y `.`, rechaza `.svn`/`_svn` y vuelve a pasar por `Workspace::resolve`; el resultado se guarda con `\` como separador.
- Una ruta bajo un archivo (pestaña de documento) se acepta; el resto de errores de `resolve` se propagan.
- Duplicados: favoritos por ruta en minúsculas, pestañas por `id`, columnas por valor; las vistas se indexan por ruta en minúsculas y, si dos claves coinciden, gana la de `updated_ms` más reciente.
- Límites: `MAX_FAVORITES` 200, `MAX_TABS` 64, `MAX_VIEWS` 500 (descarta las más antiguas), etiquetas de 256 caracteres, identificador de pestaña de 1 a 64.
- `ui_state_set` falla si el root cambió mientras se guardaba (`UiCommit::persist`); `ui_state_get` devuelve cada ruta con `exists`, revalidada contra el root actual, sin borrar las que ya no existen.
- Cambiar de root no borra nada: solo marca como no disponible lo que deja de existir.

Detalles de persistencia (atomicidad, cuarentena): [seguridad](security.md#configjson-durable-y-cuarentena).

## Dónde se aplica

| Consumidor | Cómo usa el root |
|---|---|
| `FileService::scope` | `resolve(path, true)` para todos los `fs_*` y para el protocolo `workspace-file` |
| `AppState::scoped` | `resolve` para `wc_info`, `wc_status`, checkout (`allow_overwrite = false`), update, commit y cleanup |
| `AppState::wc_status_map` | `resolve` de `wc_root` |
| `Operations::run_locked` | `revalidate` del destino tras tomar el candado de la copia |

## Pruebas

`src-tauri/tests/workspace.rs` (reglas de `resolve`), `files.rs` (listado, sondeo, `.svn`, enlaces, nube), `ui_state.rs`, `open_external.rs` y `protocol.rs`. Las pruebas con junctions las crean con `mklink /J`; ver [pruebas](testing.md).
