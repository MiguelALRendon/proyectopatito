---
id: ref-roadmap
title: Roadmap
type: reference
status: current
source: both
last_verified: 2026-10-21
symbols: []
related: [ref-architecture, ref-editors, ref-security]
---

# Roadmap

Las fases salen de `propuesta.md` §127. La Fase 2 se dividió en dos planes (2A y 2B) por decisión del usuario; el resto sigue la propuesta tal cual. Cada fase se planea justo antes de empezar, así que de la 3 en adelante solo existe la lista de la propuesta.

| Fase | Contenido (propuesta §127) | Estado | Plan |
|---|---|---|---|
| 1. Fundación | Tauri, Rust, frontend, workspace, filesystem, detección de `svn`, `info`, `status`, `checkout`, `update`, `commit` | **Hecha** (QA aceptado el 2026-10-14) | `plans/fase-1-fundacion` |
| 2A. Explorador | Explorador, favoritos, pestañas, vistas, apertura de documentos, editores | **Hecha** (QA aceptado el 2026-10-17) | `plans/fase-2a-explorador` |
| 2B. Documentos | Office, audio, vídeo, comprimidos, `svn.exe` empaquetado, instalador y máquina limpia | **Aceptada** (QA Increment ACCEPTED el 2026-10-23); queda diferida la prueba en máquina limpia (CA-14), por decisión del usuario | [`plans/fase-2b-documentos`](../plans/fase-2b-documentos/plan.md) |
| 3. Marketplace | Repositorios, navegador de repositorio, metadatos remotos, descarga, checkout, export, detección de estado local | **Diferida**, sin plan | n/a |
| 4. SVN avanzado | Log, diff, blame, revert, cleanup, propiedades, locks | **Diferida**, sin plan (cleanup ya existe desde la Fase 1) | n/a |
| 5. Branching | Branch, tag, switch, merge, mergeinfo, gráfico de revisiones | **Diferida**, sin plan | n/a |
| 6. Conflictos | Conflictos de archivo, de árbol y de propiedades, editor de 3 vías, resolve | **Diferida**, sin plan | n/a |
| 7. Ecosistema documental | Markdown, PDF, Office, imágenes, código, editores externos, arquitectura de proveedores | **Parcial**: ver más abajo | n/a |

## Fase 1: Fundación (hecha)

Backend con capas `commands → app → svn`, `Workspace::resolve`/`ScopedPath`, localizador de `svn.exe`, `svn info`/`status` tipados, checkout, update, commit y cleanup con progreso y cancelación, configuración en `config.json`, interfaz de arranque y panel de proyecto. Descrito en [arquitectura](ARCHITECTURE.md), [workspace](workspace.md) y [integración con Subversion](svn-integration.md); ADR 0001 a 0005.

## Fase 2A: Explorador (hecha: Increments 1 a 14)

Entregado y descrito en la documentación:

| Área | Documento |
|---|---|
| Ventana real de Tauri probada por CDP y CSP real (T-10 pagada) | [pruebas](testing.md), [seguridad](security.md) |
| Listado de carpetas, sondeo por contenido, banderas (oculto, solo lectura, enlace, solo-nube) | [workspace](workspace.md), [editores](editors.md) |
| Lectura y escritura atómica de texto con versión; protocolo `workspace-file` con `Range` | [seguridad](security.md) |
| Estado SVN por elemento (`wc_status_map`), «Comprobar servidor» (T-14 pagada) | [integración con Subversion](svn-integration.md) |
| Estado de interfaz persistente (favoritos, pestañas, vistas) | [workspace](workspace.md), ADR 0007 |
| Shell, paneles redimensionables, pestañas y cierre de ventana interceptado en Rust | [arquitectura](ARCHITECTURE.md), ADR 0009 |
| Explorador (cuadrícula, lista, detalles, árbol), favoritos y distintivos SVN | [arquitectura](ARCHITECTURE.md) |
| Editor de texto y código, Markdown, imágenes, PDF, binario con hexadecimal | [editores](editors.md) |
| Apertura externa controlada | [seguridad](security.md) |

Pendiente de la 2A:

- Increment 15: esta documentación (CA-24).
- Increment 16: QA Increment, con la suite E2E completa, mutación de Rust y de frontend, y `tauri build` para comprobar el instalador NSIS (CA-23).

### Fuera de la 2A y de la 2B (diferido por decisión del usuario o por pertenecer a otra fase)

Según la spec de la 2A (`plans/fase-2a-explorador/spec.md`, «Fuera de alcance»):

- Crear, renombrar, mover o borrar archivos y carpetas desde el explorador: operaciones SVN-conscientes de la Fase 4.
- PDF editable: fase posterior, no está en la 2B.
- Observador de cambios en disco, refresco por foco y búsqueda recursiva.
- Abrir en nueva ventana y menú contextual del explorador (solo existe el de las pestañas).
- Enlaces relativos entre Markdown, ir a un desplazamiento en el visor hexadecimal y codificaciones distintas de UTF-8 y UTF-16 (se ven como binario).
- Diff, historial, conflictos y propiedades como pestañas (el modelo de pestañas hoy solo tiene los tipos `folder` y `document`).
- Marketplace: la pestaña existe deshabilitada con un aviso (Fase 3).

## Fase 2B: Documentos (aceptada el 2026-10-23)

Planeada en [`plans/fase-2b-documentos`](../plans/fase-2b-documentos/spec.md) con 12 increments. Hechos hasta ahora: el Increment 1 (spikes), el 2 (aislamiento de origen cruzado, ya activo en el código), el 3 (clasificación de Office, audio, vídeo y comprimidos por contenido, y `fs_write_bytes`), el 4 (hospedaje de ZetaOffice: protocolo `zeta-assets`, visor de Office en su pestaña, frontera del WebView desde Rust), el 5 (edición y guardado de Office con conflictos, un documento vivo que sobrevive a otras pestañas y el veto de comandos; el 5.7 queda parcial: las entradas vetadas siguen dibujadas activas) el 6 (reproductor de audio y vídeo con `media-src`) el 7 (listado y extracción segura de comprimidos en Rust) el 8 (visor de comprimidos y diálogo de extracción) el 9 (instalador NSIS medido y verificado en un perfil aislado; falta la máquina limpia), el 10 (SlikSVN 1.14.5 incluido y verificado por hash, aviso de CVE-2024-45720, «Acerca de» y licencias) y el 11 (documentación y `LICENSE`). El 12 (QA Increment) cerró con veredicto ACCEPTED el 2026-10-23, con salvedades en CA-1, CA-6, CA-9, CA-13 y CA-16 (ver el spec); falta la evidencia de una máquina limpia (CA-14), diferida a la distribución. Los ADR 0010 a 0012 están `accepted`; el 0013 sigue `proposed` hasta tener esa evidencia.

| Increment | Contenido |
|---|---|
| 1 | Spikes de viabilidad (ZetaOffice, códecs, comprimidos, `svn.exe` mínimo) con puerta de decisión |
| 2 | Aislamiento de origen cruzado de la aplicación ([ADR 0010](adr/0010-aislamiento-de-origen-cruzado-y-zetaoffice-como-recurso.md)) |
| 3 | Clasificación ampliada (`office`, `audio`, `video`, `archive`) y escritura binaria |
| 4 y 5 | Hospedaje de ZetaOffice, apertura, edición y guardado de documentos Office |
| 6 | Audio y vídeo |
| 7 y 8 | Comprimidos en Rust, visor y extracción segura ([ADR 0011](adr/0011-comprimidos-leidos-y-extraidos-en-rust.md)) |
| 9 | Instalador (NSIS) y verificación parcial en esta máquina |
| 10 | `svn.exe` empaquetado, versión 1.14.4 o superior ([ADR 0012](adr/0012-svn-exe-como-recurso-del-instalador.md); contexto de CVE-2024-45720 en [integración con Subversion](svn-integration.md#svnexe-empaquetado-y-cve-2024-45720-increment-10)) y prueba en máquina limpia (Windows 11) |
| 11 | Documentación |
| 12 | QA Increment |

## Fases 3 a 6 (diferidas, sin plan)

Contenido tal cual lo lista `propuesta.md` §127; nada de esto está implementado salvo lo indicado.

| Fase | Lista de la propuesta |
|---|---|
| 3. Marketplace | Repositories, repository browser, remote metadata, download, checkout, export, local state detection |
| 4. SVN avanzado | Log, diff, blame, revert, cleanup, properties, locks |
| 5. Branching | Branch, tag, switch, merge, mergeinfo, revision graph |
| 6. Conflictos | File conflicts, tree conflicts, property conflicts, 3-way editor, resolve |

## Diferido de la 2B: distribución

- **Prueba del instalador en una máquina o VM de Windows 11 limpia** (CA-14 de la 2B): arranque, abrir un fixture de cada tipo, checkout con commit y desinstalación limpia, con capturas y registro (pasos en `scripts/e2e/clean-machine-checklist.md`). Con esa evidencia se decide `webviewInstallMode` (`downloadBootstrapper` u `offlineInstaller`) y el [ADR 0013](adr/0013-instalador-nsis-por-usuario-y-runtime-estatico.md) pasa a `accepted`. Aplazado por el usuario el 2026-10-21; el instalador sí se genera, se mide (59,8 MiB) y se verificó en un perfil aislado.
- Firma del instalador (hoy SmartScreen avisará; ver T-33).

## Fase 7: Ecosistema documental (parcial)

Lista de la propuesta: Markdown, PDF, Office, imágenes, código, editores externos y arquitectura de proveedores.

- **Existe desde la 2A**: Markdown, PDF, imágenes, código y el registro de proveedores (ver [editores](editors.md)).
- **Existe desde la 2B**: Office (ZetaOffice), audio, vídeo y comprimidos.
- **Sin plan ni implementación**: «External editors».

## Documentos de la propuesta (§126)

La propuesta pide `architecture.md`, `svn-integration.md`, `workspace.md`, `marketplace.md`, `editors.md`, `conflicts.md`, `security.md`, `testing.md` y `roadmap.md`. Existen [ARCHITECTURE.md](ARCHITECTURE.md) (con ese nombre), [svn-integration.md](svn-integration.md), [workspace.md](workspace.md), [editors.md](editors.md), [security.md](security.md), [testing.md](testing.md) y este archivo. `marketplace.md` y `conflicts.md` se crearán con las Fases 3 y 6, cuando haya algo que describir.

## Deuda técnica

Ver [TECH_DEBT.md](TECH_DEBT.md).
