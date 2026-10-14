---
status: accepted
date: 2026-10-14
deciders: [usuario]
---

# 0005. La contraseña por stdin se envía sin salto de línea final

## Context and Problem Statement

El runner enviaba la contraseña a `svn --password-from-stdin` con un `\n` final. Contra un `svnserve` real (Apache Subversion 1.15, usuario con contraseña) la autenticación fallaba con `E170001: Password incorrect` aunque la contraseña fuera correcta. Con SlikSVN 1.14.2 en Windows, medido el 2026-10-14: contraseña sin salto de línea y con `\r\n` autentican; con solo `\n` el LF queda dentro de la contraseña. Las pruebas con `file:///` no lo detectaban porque ese esquema no autentica.

## Considered Options

- Enviar la contraseña sin terminador y cerrar stdin (el EOF la termina).
- Enviar `\r\n` en Windows.

## Decision Outcome

Elegida: **sin terminador**. Funciona igual con y sin retorno de carro, no depende de la plataforma y stdin se cierra al soltar el handle. Cubierto por `real_server_accepts_the_password_sent_through_stdin` en `src-tauri/tests/app_state.rs`, que usa un `svnserve` real.

### Consequences

- Positiva: la autenticación remota con contraseña funciona; queda verificado el supuesto del plan sobre `--password-from-stdin` con `--non-interactive`.
- Negativa: las pruebas de integración necesitan `svnserve.exe` (`pwsh scripts/fetch-svnserve.ps1`, binarios de VisualSVN con hash verificado, en `.tools/`, ignorado por git).
- Neutral: al autenticar, svn guarda la credencial de prueba en su auth cache de usuario (ADR 0003), con un realm de `127.0.0.1` distinto por repositorio.
