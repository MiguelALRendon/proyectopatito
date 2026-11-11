---
fecha: 2026-10-23
estado: BORRADOR v2 para lectura del usuario. Decidido por el usuario el 2026-10-23: alcance (roadmap + operaciones de archivo SVN), bloqueos ajenos bajo demanda y en el preflight, y solo `svn:log` editable entre las propiedades de revisión. El resto del diseño lo propone el plan y no pasó por aprobación sección por sección
fase: 4
depende_de: fase-3-marketplace (parser de externals, remote_url, opciones de red, credenciales de sesión, registro de repositorios)
---

# Diseño — Fase 4: SVN avanzado y operaciones de archivo

Fuente: `propuesta.md` §16-18, §33-34, §50-51, §54-55, §58-60, §76, §81-84, §97. Base: Fases 1, 2A y 2B aceptadas y Fase 3 implementada. Todo lo hace `svn.exe`.

## 0. Decisiones

| Tema | Decisión |
|---|---|
| Alcance | Log, diff, blame, revert, propiedades (con revprops), locks, cleanup, operaciones de archivo SVN-conscientes y Centro de cambios con commit selectivo. **Fuera**: changelists, patch, shelving, arrastrar y soltar, commit por hunks (solo se investiga) |
| Diff | Editor de diferencias de Monaco (mismo paquete que ya se carga; comparte fragmento) alimentado con el contenido de cada lado (`svn cat`, archivo de trabajo); no se interpreta el diff unificado |
| Vistas | Pestañas `svn_view` **en la misma lista** de pestañas, con un campo `ephemeral`: `snapshot` las filtra y fija como activa la persistida más cercana; no pasan por `normalize_tabs`; identidad = (tipo, objetivo, parámetros); su estado vive en un store por pestaña |
| Objetivo | `SvnTarget` = `Local(ScopedPath)` o `Remote { repo_id, ruta }` (Fase 3) |
| Destructivo | Vista previa que devuelve un **token** de la lista exacta; Rust solo ejecuta con token válido y recalcula; rutas explícitas; respaldo previo en una carpeta de la aplicación (sin dependencias nuevas: copia con `std::fs`, con tope y limpieza por antigüedad) |
| Candado | Un candado por **raíz de copia** (`working_copy_root`) para toda operación de escritura, incluidas update, commit y cleanup existentes; una operación toma un solo candado |
| Bloqueos ajenos | Solo con `svn status -u`: bajo demanda y siempre en el preflight del commit (decisión del usuario) |
| Revprops | Solo `svn:log` editable, con confirmación en Rust (decisión del usuario) |

## 1. Arquitectura

- **`svn/`**: peticiones y parsers de `log --xml`, `blame --xml`, `diff --summarize --xml`, `cat`, `proplist/propget/propset/propdel`, `lock/unlock`, `revert`, `add`, `delete`, `move`, `copy`, `mkdir`, `cleanup` y `status -u/-v`; `RunOptions` gana `max_stdout` (el runner mata el proceso al pasarlo).
- **`app/vcs/`** (nuevo): `fileops`, `names`, `backup`, `preview` (tokens), `log`, `diff`, `blame`, `props`, `locks`, `changes`, `cleanup`, `ignore`; `AppState` solo delega.
- **Fundaciones comunes** (Increment 2): candado por raíz, `max_stdout`, `ignored` en la clave de la caché de estado, validador de nombres de hoja, comprobación de enlaces y `cloud_only`, petición de propiedades única, infraestructura de pruebas multiusuario con `authz` y hooks.
- **Frontend**: pestañas `svn_view`, menú contextual del explorador sobre `ContextMenu.vue` (ampliado con retorno del foco y, si hace falta, submenús), vistas por tipo y stores por pestaña.

## 2. Modelo y constantes

`LogEntry`, `ChangedPath`, `LogQuery { target, peg, start, limit, stop_on_copy, search?, author?, range? }`, `DiffRequest`, `DiffSide { bytes?, size, hash, kind, encoding }`, `BlameLine { line, revision?, author?, date?, text }`, `PropEntry`, `LockInfo { owner, comment, created, token, origin: Local|Server }`, `ChangeItem`, `Preview { items, token }`.
Constantes: `LOG_PAGE` 100, `MAX_LOG_LOADED` 5 000, `MAX_DIFF_BYTES` 5 MiB por lado, `MAX_STDOUT_BYTES` (diff/cat) 6 MiB, `MAX_BLAME_LINES` 20 000, `MAX_PROP_VALUE_BYTES` 64 KiB, `MAX_CHANGE_ITEMS` 20 000, `MESSAGE_HISTORY` 50, `MAX_BACKUP_BYTES` 500 MiB, `BACKUP_RETENTION_DAYS` 14, `MAX_ADD_CONFIRM` 200 (por encima, la vista previa lista un conteo y una muestra).

## 3. Flujos

- **Log.** Páginas sin `-v`; las rutas cambiadas de una revisión se piden al abrirla (`log -v -r N -l 1`). Con texto de búsqueda, el cursor avanza por revisiones **examinadas**. Acciones: ver revisión, comparar dos, blame, checkout/export, copiar, editar `svn:log` (confirmación, error de hook explicado). Rama/tag y revertir revisión llegan con la Fase 5.
- **Diff.** Lados por `cat`; antes de leer se comprueba el tamaño y `max_stdout` protege; texto: Windows-1252 como respaldo de lectura con aviso; binarios: tamaño y huella. Carpeta: `diff --summarize --xml` de WC vs BASE/HEAD o repo vs repo.
- **Blame.** `blame --xml -v` + `cat` de la misma revisión para el texto; líneas sin `<commit>` = cambio local; binario por `svn:mime-type` o por salida vacía con aviso.
- **Operaciones de archivo.** Se decide por elemento con `svn info`/`svn status <ruta>`; un fallo de `svn` es error. El destino de `move`/`copy` va sin `@`. Renombrar solo mayúsculas: el destino se arma con el nombre de hoja validado (`padre.join(nombre)`), no con `resolve` del destino. Antes de operar: `symlink_metadata`, `cloud_only`, pestañas abiertas y sucias bajo la ruta. Después: remapeo de pestañas/favoritos/vistas y refresco.
- **Revert / delete --force / borrar no versionados / remove-\*.** `preview` → token → respaldo → ejecución → resultado con la ubicación del respaldo.
- **Ignorar.** Solo para no versionados; archivo → `svn:ignore` de su carpeta, extensión y patrón → `svn:global-ignores` de la carpeta elegida; valor por `-F`.
- **Propiedades.** Validadores por propiedad; `-F` para valores; recursivo = conteo + muestra + confirmación; `eol-style` recursivo rechaza binarios y mezclados.
- **Locks.** `lock -m`, `unlock`, `--force` con confirmación; propio por `K`; ajenos por `status -u` bajo demanda y en preflight.
- **Commit selectivo.** `CommitRequest` y `CommitArgs` conservan su campo y ganan `extra_paths` y `no_unlock`; `commit_preflight` calcula clausura (padres nuevos, par del `move`, carpeta con `--depth empty`), conflictos, bloqueos ajenos (`-u`), revisión mezclada (`status -v`) y existencia; se agregan los no versionados elegidos antes de confirmar.
- **Cleanup.** Dos invocaciones distintas: base (rompe bloqueos y arregla marcas de tiempo) y de borrado (`--remove-unversioned`, `--remove-ignored`, `--vacuum-pristines`, `--include-externals`); la lista previa viene de `status --no-ignore`; sin lista completa o con una copia anidada, no se ofrece `--remove-unversioned`.

## 4. Seguridad

- Rutas por `Workspace::resolve`, salvo el destino de un renombrado, que usa el validador de nombre de hoja y el padre ya resuelto.
- Confirmación con token, exigida en Rust; respaldo antes de descartar trabajo.
- Texto remoto y valores de propiedades son hostiles: escape de controles y bidireccionales, topes, base64 degradado.
- Valores por archivo temporal (`-F`), nunca por `argv`; contraseñas por `stdin`.
- Enlaces y puntos de reanálisis se detectan con `file_type().is_symlink()` y se rechazan; OneDrive `cloud_only` se avisa.
- Operaciones de red con las opciones de la Fase 3.

## 5. Fuera de la Fase 4

Changelists, patch, shelving, arrastrar y soltar, commit por hunks, issue tracker, hooks, autoprops, relocate, import, `svn:author`/`svn:date`, `--fix-timestamps`, y todo lo de las Fases 5 y 6.

## 6. Pruebas

Integración con repositorios reales (`svnadmin` + `file:///`, `svnserve` con varios usuarios, `authz` y hooks); fixtures M2 saneados; adversariales: nombres reservados, `@` en el nombre, renombrado solo de mayúsculas, mover entre copias, borrar con cambios locales, WC anidada bajo `--remove-unversioned`, unión de Windows, archivo de OneDrive, `blame` de binario, log con 5 000+ revisiones y búsqueda, revprop sin hook, propiedades enormes y con bidi, commit con padre nuevo no incluido y con `move`. Vitest y Stryker; E2E sobre la ventana real con teclado por cada vista.

## 7. Increments previstos

1 Medir. 2 Fundaciones comunes. 3 Pestañas de vista y menú. 4 Operaciones de archivo (Rust). 5 Vista previa, respaldo, revert e ignorar (Rust). 6 Operaciones de archivo (interfaz, acciones simples). 7 Acciones con diálogo (mover, ignorar, revertir). 8 Log (Rust). 9 Log (interfaz). 10 Diff (Rust y vista de texto). 11 Diff (carpetas, binarios, límites). 12 Blame. 13 Propiedades. 14 Locks. 15 Commit selectivo y preflight. 16 Centro de cambios. 17 Cleanup. 18 Documentación. 19 QA.
