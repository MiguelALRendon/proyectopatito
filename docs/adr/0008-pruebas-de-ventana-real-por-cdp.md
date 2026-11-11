---
status: accepted
date: 2026-10-14
deciders: [usuario]
---

# 0008. La ventana real de Tauri se prueba por CDP sobre el ejecutable compilado

## Context and Problem Statement

La Fase 1 se probó con pruebas automáticas y con la interfaz en un navegador con un backend simulado; la ventana real nunca se ejecutó. El producto es una aplicación de Windows sobre WebView2, y la CSP real solo se aplica en el ejecutable compilado (`tauri dev` usa `devCsp` y otro origen).

## Considered Options

- Arrancar el ejecutable de depuración (`tauri build --debug --no-bundle`) con el puerto de depuración remota de WebView2 y controlarlo con `playwright-core` por `connectOverCDP`.
- `tauri-driver` con `msedgedriver` (WebDriver).
- Seguir con el navegador y el mock de Tauri.
- Probar solo con `tauri dev`.

## Decision Outcome

Elegida: **CDP sobre el ejecutable de depuración**, con un directorio de configuración aislado (`DAKEDADUCK_CONFIG_DIR`, solo en depuración o con la característica de Cargo `e2e-config-dir`; el instalador distribuido se compila sin ella), un perfil de WebView2 temporal y un repositorio de fixtures creado con `svnadmin`. Se retira el mock de Tauri. Descartadas: `tauri-driver` exige instalar un binario extra; el navegador con mock no cubrió la ventana; `tauri dev` no prueba la CSP real. Alcance honesto: se controla la interfaz web de la ventana, no los diálogos nativos ni el marco; el cierre de ventana se prueba enviando `CloseMainWindow` desde el arnés: la página recibe el evento y el proceso sigue vivo hasta confirmar.

### Consequences

- Positiva: las pruebas cubren la ventana, la CSP y los protocolos reales y se relanzan en segundos.
- Negativa: necesitan pantalla, por eso no entran al pipeline local; son una puerta explícita del QA Increment.
- Neutral: supuestos que la Fase 2A verifica primero: WebView2 acepta el puerto desde Tauri y wry respeta `WEBVIEW2_USER_DATA_FOLDER`.

## Medido en la implementación

Aceptado con el Increment 15 de la Fase 2A (2026-10-16). La decisión no cambió; esto es lo que se midió al abrir la ventana real (detalle en `docs/human-explanations/entorno-desarrollo.md`):

- Los dos supuestos «Neutral» se confirmaron: WebView2 acepta `--remote-debugging-port` desde Tauri vía `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (puerto 9333), respeta `WEBVIEW2_USER_DATA_FOLDER`, y `playwright-core` se conecta con `connectOverCDP`.
- Con el ejecutable embebido la página vive en `http://tauri.localhost/`, no en `localhost:1420`; el ejecutable «de producción» solo deja de apuntar a `devUrl` si `Cargo.toml` define `custom-protocol = ["tauri/custom-protocol"]`.
- `cargo test` y `cargo check` reconstruyen `src-tauri/target/debug/dakedaduck-svn.exe` sin esa característica; por eso el arnés compila en un directorio aparte, `src-tauri/target-e2e`.
- `DAKEDADUCK_CONFIG_DIR` (ruta absoluta) solo se lee con `debug_assertions` o la característica `e2e-config-dir` (`config::IS_CONFIG_DIR_OVERRIDE_ALLOWED`, `tests/config_dir.rs`).
- Se retiraron el mock de Tauri (`tests/e2e/mock-tauri/`) y `vite.e2e.config.ts`. El cierre se prueba con `CloseMainWindow` (`start-app.ps1 -CloseWindow`).
- Tauri 2.11.6 envía los commands por `fetch` a `http://ipc.localhost/<command>` pero pasa **todos** a `postMessage` si un solo `fetch` falla, y `page.route` no ve `postMessage`; por eso el arnés usa una compuerta de página (`ipcGate.page.js`) que envuelve ambos transportes en lugar de `page.route`.
- Los E2E no están en `pipeline.json`: se corren con `npm run test:e2e` (necesitan pantalla) y son una puerta explícita del QA Increment.
