---
status: accepted
date: 2026-10-14
deciders: [usuario]
---

# 0009. El cierre de ventana se intercepta en Rust

## Context and Problem Statement

Cerrar la ventana con documentos sin guardar debe pedir confirmación y vaciar el estado de interfaz pendiente (CA-12). La vía habitual es `onCloseRequested` desde JavaScript, pero `core:window:default` no incluye `allow-close` ni `allow-destroy`, así que habría que ampliar las capabilities, y CA-4 las mantiene en `core:default` y `dialog:allow-open`.

## Considered Options

- Interceptar `CloseRequested` en Rust (`prevent_close`), emitir `app://close-requested` y cerrar con un command propio `app_confirm_close` tras la confirmación.
- `onCloseRequested` desde el frontend con el permiso de ventana correspondiente.

## Decision Outcome

Elegida: **interceptar en Rust**. El frontend vacía el estado pendiente, pide confirmación si hay cambios sin guardar y solo entonces invoca `app_confirm_close`. No se agrega ningún permiso, y una prueba compara `capabilities/default.json` con la lista esperada. Si el frontend no avisó que está listo (`app_frontend_ready`) o pasa `CLOSE_TIMEOUT`, Rust cierra directamente para que la ventana nunca quede imposible de cerrar, y `app_confirm_close` usa `destroy()` porque `close()` reentraría en `CloseRequested`. Mientras la página decide (hay guards registrados, es decir, un diálogo puede estar abierto) el frontend envía `app_hold_close` de inmediato y lo reenvía cada `HOLD_PING_MS` (2 s): es un latido. Rust pasa la solicitud a `Deciding` y refresca su reloj en cada latido; la decisión solo vence si pasan `HOLD_KEEPALIVE_TIMEOUT` (6 s, 3 latidos) sin ninguno, y entonces Rust cierra directo. Así se cumplen a la vez dos requisitos: con la página viva la ventana nunca se destruye por mucho que el usuario tarde en decidir, y con la página colgada o caída se cierra en segundos. Un latido tardío no revive una decisión ya vencida ni inicia una nueva tras `app_cancel_close` o `app_confirm_close`. El frontend ya no tiene plazo propio por guard: si un guard lanza, no autoriza el cierre en silencio, pregunta con un diálogo («No se pudo comprobar si hay cambios sin guardar»: Cancelar / Cerrar de todos modos), y el latido sigue mientras ese diálogo está abierto. Compromiso aceptado (T-24): el failsafe de `CLOSE_TIMEOUT` (5 s) en `Asked` sigue cerrando la ventana si la página no llega a enviar el primer latido, de modo que un JS colgado antes de sostener puede cerrar con texto sucio; y un guard que nunca resuelve con la página viva mantiene la ventana sostenida, porque el latido sigue llegando. El flujo se prueba sobre la ventana real: el arnés envía `CloseMainWindow` y verifica el evento, la cancelación, la confirmación, que el latido mantiene el diálogo abierto más allá de `HOLD_KEEPALIVE_TIMEOUT` y que, sin latido, Rust cierra la ventana.

### Consequences

- Positiva: las capabilities no crecen y el cierre tiene un único punto de control.
- Negativa: lógica de ventana repartida entre Rust y el frontend, con un contrato de evento y command que hay que mantener.

## Medido en la implementación

Aceptado con el Increment 15 de la Fase 2A (2026-10-16). La decisión no cambió; esto es lo que la implementación (`src-tauri/src/app/closing.rs`, `commands/window.rs`, `src/composables/useWindowClose.ts`) midió:

- Los plazos descritos son los del código: `CLOSE_TIMEOUT` 5 s, `HOLD_KEEPALIVE_TIMEOUT` 6 s y `HOLD_PING_MS` 2 s. La máquina de estados (`Closing`) se prueba con reloj simulado en `tests/closing.rs` y sobre la ventana real en `tests/e2e/real-app/shell.e2e.ts` y `editor-close.e2e.ts`: cancelar, confirmar, latido que mantiene el diálogo abierto más allá de `HOLD_KEEPALIVE_TIMEOUT`, y cierre por Rust cuando la página deja de latir.
- Los commands son `app_frontend_ready`, `app_hold_close`, `app_cancel_close` y `app_confirm_close`, y el evento `app://close-requested`. Las capabilities no crecieron: la prueba de `tests/app_state.rs` exige solo `core:default` y `dialog:allow-open`.
- Una página recargada con una solicitud pendiente de la anterior la descarta al avisar `app_frontend_ready` (`tests/closing.rs`).
- Medición del arnés: como `app_confirm_close` real cerraba la ventana en mitad de la prueba, el arnés intercepta los tres commands de cierre en ambos transportes de IPC (`fetch` y `postMessage`) con reglas `pass`, `swallow` y `cancel`.
- El compromiso aceptado sigue abierto como deuda **T-24** en `docs/TECH_DEBT.md`.
