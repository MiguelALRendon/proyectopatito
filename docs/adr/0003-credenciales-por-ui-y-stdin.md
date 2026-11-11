---
status: accepted
date: 2026-10-13
deciders: [usuario]
---

# 0003. Credenciales pedidas en la UI y enviadas por stdin

## Context and Problem Statement

Todas las invocaciones de `svn.exe` llevan `--non-interactive`, así que svn nunca pregunta usuario ni contraseña. Un repositorio remoto (http, https, svn) sin credenciales en el auth cache falla con E170001 (svnserve) o con E215004 y E215001 (http y https, verificado contra un servidor HTTP real que responde 401 con `svn.exe` 1.14.2); el backend trata los tres códigos como autenticación requerida. El auditor de completitud (2026-10-12) señaló que la API de Fase 1 no tenía cómo autenticarse.

## Considered Options

- La UI pide usuario y contraseña y los pasa con `--username` y `--password-from-stdin`.
- Depender solo de credenciales ya cacheadas por TortoiseSVN u otro cliente.

## Decision Outcome

Elegida: **la UI pide usuario y contraseña**, decisión del usuario del 2026-10-12. La contraseña viaja solo por stdin (`Password`, con `Debug` redactado) y el runner agrega `--password-from-stdin`. Nunca va en argv, logs, `SvnError` ni `config.json`; la app no la guarda. Se delega en el auth cache de Subversion (`design.md` §6) y no se pasa `--no-auth-cache`: svn puede conservar la credencial según su propia configuración, como hace TortoiseSVN. Requiere Subversion 1.10 o superior, por lo que el locator rechaza clientes anteriores (ver ADR 0004).

### Consequences

- Positiva: funciona con repositorios sin sesión previa.
- Negativa: la credencial queda en el auth cache de svn (`%APPDATA%\Subversion\auth`) con la protección que svn aplique; si `store-plaintext-passwords` está en `ask`, svn puede no guardarla y la UI tendrá que pedirla en cada operación remota. Ninguno de los dos comportamientos está verificado en modo no interactivo.
- Neutral: contra `file:///` la autenticación no interviene y no se ejercita en las pruebas automáticas.

## More Information

`src-tauri/src/svn/runner.rs` (`Password`, `PASSWORD_FROM_STDIN_FLAG`), `plans/fase-1-fundacion/spec.md` CA-14.
