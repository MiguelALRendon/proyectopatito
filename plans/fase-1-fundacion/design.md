# Diseño — Fase 1: Fundación (dakedaduck svn, cliente SVN sobre Tauri 2)

Nombre del producto: **dakedaduck svn** (paquete `dakedaduck-svn`, identificador `com.dakedaduck.svn`).
Estado: APROBADO por el usuario (2026-10-12).
Semilla: `propuesta.md`. Referencia visual: DocuMalia (`C:\Users\spook\Downloads\malia-documalia-master`).

## 0. Alcance de la Fase 1

Vertical mínima, funcional y probada contra un repositorio SVN real:

Workspace Root → validación de rutas → detección de `svn.exe` → `svn info` → `svn status` → `checkout` → `update` → `commit`.

Fuera de alcance (fases siguientes): explorador completo, pestañas, Marketplace, merge, conflictos, editores, revision graph.
La UI de Fase 1 es un shell mínimo (ventana + onboarding + panel de proyecto) con tokens Claymorphism de DocuMalia; no el explorador.

## 1. Stack

| Capa | Elección |
|---|---|
| Shell | Tauri 2 (Rust 1.88) |
| Frontend | Vue 3 `<script setup>` + TS + Vite + Pinia (igual que DocuMalia) |
| Editor de código (Fase 7) | Monaco, carga diferida |
| Motor SVN | `svn.exe` por `std::process::Command`/`tokio::process`, argumentos separados, salida `--xml` |
| Pruebas | Rust: `cargo test` (+ repos reales con `svnadmin create` + `file:///`); frontend: Vitest |

Decisión clave: **no** usar `tauri-plugin-shell` para exponer svn al frontend. El frontend solo invoca commands Rust tipados; el proceso `svn.exe` se lanza únicamente desde el crate de dominio. Elimina por diseño la inyección de comandos (§117).

## 2. Estructura de carpetas

```
├─ src/                      # Vue
│  ├─ components/ composables/ stores/ styles/tokens.css (derivado de DocuMalia)
│  └─ services/tauri.ts      # único punto de invoke() tipado
├─ src-tauri/
│  ├─ src/
│  │  ├─ commands/           # #[tauri::command] finos: validan, delegan, mapean errores
│  │  ├─ app/                # servicios: workspace, svn_locator, operations (cola por WC)
│  │  ├─ svn/                # SvnClient: runner + comandos + parsers XML + modelos + errores
│  │  └─ config/             # persistencia (JSON sin secretos)
│  └─ tests/                 # integración con repo real
├─ docs/                     # architecture, svn-integration, workspace, security, testing, roadmap, svn-feature-matrix
└─ plans/
```

Capas Rust (dependencia unidireccional): `commands → app → svn`. `svn` no conoce Tauri.

## 3. Seguridad del Workspace (núcleo)

`WorkspaceRoot` es un newtype con ruta canónica. Todo destino pasa por `Workspace::resolve(path) -> Result<ScopedPath>`:

1. Rechazar componentes `..`, prefijos de dispositivo (`\\.\`), UNC inesperadas y nombres reservados de Windows (CON, NUL…).
2. Canonicalizar el ancestro existente más profundo (resuelve symlinks y junctions) y exigir `starts_with(root_canónico)` comparando componentes, no strings (evita `C:\SVN2` vs `C:\SVN`).
3. Comparación insensible a mayúsculas (NTFS).
4. Colisiones: si el destino existe y no hay `allow_overwrite` explícito, error `DestinationExists`.
5. TOCTOU: re-validar justo antes de ejecutar la operación.

`ScopedPath` solo se construye vía `resolve`; los servicios aceptan únicamente `ScopedPath`. Capabilities de Tauri: denegar `fs` al frontend por defecto; solo `dialog` para elegir carpeta.

## 4. Capa SVN

- `SvnBinary { path, version }` detectado por `svn_locator`: configuración manual → PATH → `%ProgramFiles%\TortoiseSVN\bin` → SlikSVN → Apache. Validado con `svn --version --quiet`.
- `SvnRunner::run(args: &[OsString], cwd) -> RawOutput`: sin shell, `--non-interactive` siempre, timeout y cancelación (kill del hijo), stdout/stderr capturados, contraseña por `--password-from-stdin`, nunca en argv ni logs.
- Cada comando = struct de petición tipada (`CheckoutRequest { url, dest: ScopedPath, revision, depth, ignore_externals }`) que produce `Vec<OsString>`; test unitario fija la construcción de argumentos.
- Parsers `quick-xml` + serde para `info`, `status`, `log`, `list`. Progreso de update/checkout: parseo línea a línea de stdout emitido como eventos Tauri.
- `SvnError` normalizado por código `E######` de stderr + conservación de comando/stdout/stderr/exit/timestamp para log técnico (sin contraseñas).
- Gestor de operaciones: `HashMap<WcRoot, Mutex>`; update y commit sobre la misma WC se serializan, WC distintas en paralelo.

## 5. API Rust → Frontend (Fase 1)

`workspace_get`, `workspace_set(path)`, `svn_detect()`, `svn_set_path(path)`, `wc_info(path)`, `wc_status(path, remote)`, `svn_checkout(req)`, `wc_update(req)`, `wc_commit(req)`, `op_cancel(id)`, `wc_cleanup(path)`, `wc_needs_cleanup(path)` (agregado en el QA: la UI solo ofrece Cleanup si el backend marcó la copia); eventos `svn://progress`, `svn://done`. Resultados siempre tipados, nunca `stdout: string`.

## 6. Persistencia

`config.json` en `app_config_dir` (workspace root, ruta de svn, preferencias). Sin secretos: credenciales delegadas al auth cache de Subversion.

## 7. Pruebas

- Unitarias: validación de rutas (`..`, junction, mayúsculas, prefijo hermano), construcción de argumentos, parsers con XML real, mapeo de errores.
- Integración: helper crea repo con `svnadmin create` + `file:///`; checkout/update/commit/status/conflicto; si no hay svn, falla con mensaje claro.
- Frontend: Vitest para stores y servicio tauri.
- Gates por fase: `cargo check`, `cargo test`, `npm test`, `npm run build`.

## 8. Reutilización de DocuMalia (a verificar en implementación)

Adaptar con criterio: `tokens.css`, `WindowTitleBar`, `ResizeHandle`, `ContextMenu`, `BaseModal`, `ConfirmDialog`, composables `usePersistedPreference`/`useResizablePanel`/`useTheme`/`useFocusTrap`. Nada del dominio MaliAPI.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Progreso no estructurado | Aislar en un módulo con tests sobre salida real |
| Distintas versiones de cliente | Gates por versión |
| Rutas largas / OneDrive en Windows | Probar con ruta larga |
| Cancelación a mitad de update | Kill + `wc_cleanup` ofrecido en la UI |
| Cliente svn < 1.10 | `svn_locator` lo rechaza (falta `--password-from-stdin`) |
| Encoding de stderr en Windows | Test con rutas con tildes; decisión empírica |
