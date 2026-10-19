# Constitucion del proyecto

## Proposito

dakedaduck svn es un cliente de escritorio para Windows (Tauri 2 + Rust + Vue 3) que reemplaza la experiencia de uso de TortoiseSVN: un explorador de archivos, gestor documental e IDE ligero con SVN integrado. Lo usa un desarrollador que debe trabajar contra repositorios Subversion existentes pero quiere una interfaz moderna (Claymorphism, evolución de DocuMalia). Semilla completa en `propuesta.md`.

## Core Tenets

1. **La aplicación es el cliente/GUI; Subversion es el motor.** Toda operación con equivalente en `svn.exe` se ejecuta con el cliente oficial; no se reimplementa el protocolo ni se inventa un control de versiones propio.
2. **Solo Rust lanza `svn.exe`.** El frontend invoca únicamente commands Rust tipados; nunca construye comandos ni usa `tauri-plugin-shell`. Argumentos siempre separados, `--non-interactive`, salida `--xml` cuando exista.
3. **El Workspace Root es frontera de seguridad.** Todo destino (checkout, export, descarga, move) pasa por `Workspace::resolve` y se representa como `ScopedPath`; la validación real vive en Rust, nunca solo en JavaScript. Bloquea `..`, junctions/symlinks, rutas fuera del root y sobrescrituras silenciosas.
4. **Nunca mentir ni fingir.** Si SVN no puede hacer algo de forma segura con el cliente disponible, la UI lo dice ("no disponible en esta versión" / "requiere un componente adicional"). Sin funcionalidades que solo parezcan funcionar ni mocks permanentes donde se pueda probar con un repo real.
5. **Semántica SVN intacta.** Renombrar/mover/borrar versionados usa `svn move/delete/copy`, nunca operaciones de filesystem. Download ≠ Export: working copy rastreable (`checkout`) frente a copia limpia (`export`), siempre explícito.
6. **Estado desde SVN, no desde timestamps.** Estado local (`svn status`) separado del remoto (`svn status -u`); la caché nunca es fuente para operaciones destructivas.
7. **Destructivo = confirmación.** Revert, delete, overwrite, relocate, steal lock y resoluciones que descartan cambios exigen confirmación. `resolve` es siempre una acción explícita del usuario.
8. **Sin secretos en claro.** Credenciales delegadas al auth cache de Subversion; nada de contraseñas en JSON, argv ni logs. Certificados desconocidos nunca se aceptan en silencio.
9. **Errores legibles, detalles disponibles.** Errores SVN normalizados a tipos con mensaje amigable; comando, stdout, stderr, exit code y timestamp se conservan en el log técnico.
10. **Rendimiento a escala.** Carga bajo demanda y virtualización; jamás recorrer una working copy completa sin necesidad ni ejecutar `svn status` por evento de mouse.
11. **Resultados tipados.** Nunca devolver `stdout: string` al frontend; modelos Rust/TS explícitos (`SvnStatusEntry`, `SvnInfo`, ...).
12. **Marketplace no abre archivos remotos.** Metadata → Descarga → Workspace local → Editor.

## Restricciones

- Windows 11 x64 primero (Windows 10 y anteriores quedan fuera); sin sacrificar UX de Windows por portabilidad prematura.
- No modificar servidores ni repositorios existentes; no crear API propia entre cliente y servidor.
- No asumir estructura trunk/branches/tags, ni cliente == servidor en versión, ni que TortoiseSVN está instalado.
- Adaptar características por versión de cliente (`svn --version --quiet`): shelving es experimental en 1.14.
- Rust con toolchain MSVC (override en el proyecto). Frontend: Vue 3 + TS + Vite + Pinia; Monaco para código con carga diferida.
- Estilos solo vía tokens (`src/styles/tokens.css`, tomados de DocuMalia); nada de colores/tamaños quemados.
- Generadores de scaffold: nunca `--force` sobre una carpeta con trabajo del usuario.

## Definicion de calidad

- "Hecho" = gates de `completion.json` en verde con evidencia: `cargo check`, `cargo test`, `npm test`, `npm run build`, prettier y mutación.
- Pruebas obligatorias: validación de rutas y seguridad del workspace, construcción de argumentos, parsers con XML real, mapeo de errores, e integración contra un repo local creado con `svnadmin create` + `file:///` (reproducible, sin servidor corporativo).
- Una función SVN no se da por soportada hasta confirmar su comportamiento real con `svn.exe` y dejar un test reproducible.
- Trabajo incremental por fase; corregir errores antes de avanzar. `docs/svn-feature-matrix.md` se mantiene al día.
- Comentarios: tolerancia cero salvo el porqué no obvio.

## Fuera de alcance

- Sincronización tipo Dropbox o cualquier semántica ajena a SVN.
- Reimplementar el protocolo SVN o requerir cambios en servidores/hooks de servidor.
- Búsqueda de contenido remoto sin fuente de indexación (se informa, no se finge).
- Portabilidad a macOS/Linux en esta etapa.
- Acoplarse a un issue tracker concreto (solo la abstracción `IssueTrackerProvider`).
- Depender de TortoiseSVN (es referencia funcional, no dependencia).
