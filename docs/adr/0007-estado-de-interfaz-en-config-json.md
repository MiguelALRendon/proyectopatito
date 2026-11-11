---
status: accepted
date: 2026-10-14
deciders: [usuario]
---

# 0007. Favoritos, sesión de pestañas y vistas se guardan en `config.json`

## Context and Problem Statement

La Fase 2A introduce favoritos, pestañas restaurables y una vista recordada por carpeta. Hay que decidir dónde viven. DocuMalia solo usa `localStorage`.

## Considered Options

- Sección `ui` en el `config.json` de Rust, con rutas relativas al Workspace Root.
- Todo en `localStorage` del WebView.

## Decision Outcome

Elegida: **`config.json` para datos del usuario** (favoritos, sesión de pestañas, vista por carpeta) y **`localStorage` solo para preferencias volátiles** (tamaños de paneles y tema). Los datos del usuario se validan contra el Workspace Root, se escriben de forma atómica y, si el JSON se corrompe, el archivo va a `config.json.bad` (comportamiento que `ConfigStore` ya tiene). Las rutas se guardan relativas y en minúsculas como clave; al cargar se revalidan contra la raíz actual y las que no existen se marcan no disponibles sin borrarlas. Descartada la opción de todo en `localStorage`: no se valida, y se pierde si cambia el perfil de WebView2.

### Consequences

- Positiva: favoritos y sesión sobreviven a limpiezas del perfil del WebView y nunca apuntan fuera del Workspace Root.
- Negativa: dos mecanismos de persistencia (Rust y `localStorage`) con un criterio claro: dato del usuario frente a preferencia volátil.
- Neutral: el cambio de Workspace Root no borra nada; solo marca como no disponible lo que deja de existir.

## Medido en la implementación

Aceptado con el Increment 15 de la Fase 2A (2026-10-16). La decisión no cambió; esto es lo que la implementación (`src-tauri/src/config/ui.rs`, `config/mod.rs`, `app/ui_state.rs`) midió:

- La sección `ui` de `config.json` lleva `version` (`UI_STATE_VERSION`, hoy 1), `favorites`, `tabs`, `active_tab` y `views`. Una sección `ui` con forma inválida o de otra versión se lee como valor por defecto sin cuarentena y conserva `workspace_root` y `svn_path`; solo un JSON ilegible mueve el archivo a `config.json.bad` (con sufijo numérico si ya existe).
- La escritura es durable: temporal `config.json.tmp`, `sync_all` y renombrado. Si el archivo existe pero no se puede leer, `AppState` no lo sobrescribe.
- Las rutas se guardan relativas al Workspace Root y con `\`; favoritos y pestañas conservan las mayúsculas del usuario (se deduplican en minúsculas) y las claves de `views` van en minúsculas. `ui_state_set` rechaza rutas fuera del root, con `..` o en `.svn`/`_svn`, y falla si el root cambió mientras guardaba.
- `ui_state_get` devuelve cada ruta con `exists`, revalidada contra el root actual, sin borrar lo que ya no existe. Límites: 200 favoritos, 64 pestañas y 500 vistas (descarta las más antiguas).
- Del lado de `localStorage` quedan solo las preferencias volátiles previstas: el tema (`dakedaduck-theme`) y los tamaños de panel (prefijo `dakedaduck-layout-`).
