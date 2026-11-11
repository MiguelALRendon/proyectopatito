# Documentacion

Estructura Diataxis: cada archivo pertenece a **un solo** modo. No mezclar.

| Carpeta | Modo | Orientacion |
|---|---|---|
| `human-explanations/` | Human explanation | Aprender de la mano (onboarding) |
| `to-skills/` | To-skill | Resolver una tarea concreta |
| `catalog/` | Catalog | Descripcion sistematica (API, config, esquema) |
| `concepts/` | Concept | Por que, trade-offs, contexto |

Documentos de referencia en la raiz de `docs/` (formato de `ARCHITECTURE.md`: `source`, `last_verified`, `symbols`):

| Documento | Contenido |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mapa del sistema y estado real del codigo |
| [workspace.md](workspace.md) | Workspace Root, `resolve`/`revalidate`, reglas de rutas |
| [security.md](security.md) | Fronteras de seguridad, CSP, protocolo, limites |
| [svn-integration.md](svn-integration.md) | Runner, localizador, parsers, estado y operaciones |
| [testing.md](testing.md) | Piramide de pruebas y E2E sobre la ventana real |
| [editors.md](editors.md) | Registro de proveedores y visores |
| [roadmap.md](roadmap.md) | Fases hechas y diferidas |
| [TECH_DEBT.md](TECH_DEBT.md) | Registro de deuda tecnica |

Otras carpetas:
- `_inbox/` — buzon de notas informales; `/docs-rewrite` las procesa a los 4 modos.
- `adr/` — Architecture Decision Records (MADR), inmutables.
- `architecture/` — diagramas C4 (Mermaid).

Las plans ejecutables (`.feature` Gherkin) viven en `plans/`, no aqui.
