---
status: accepted
date: 2026-10-13
deciders: [usuario]
---

# 0004. Errores svn: TLS no confiable, copia de trabajo antigua y encoding

## Context and Problem Statement

La capa `svn` ejecuta `svn.exe` siempre con `--non-interactive`. El auditor de completitud (2026-10-12) detectó tres casos sin política: certificado TLS no confiable, copia de trabajo en formato 1.7 o anterior, y encoding de la salida en Windows.

## Considered Options

- TLS: fallar con error guiado / confiar de forma explícita con `--trust-server-cert-failures` / no soportar.
- Copia antigua: error con instrucción de `svn upgrade` / ofrecer upgrade desde la app.
- Encoding: forzar el entorno del hijo / decodificar según el contenido.

## Decision Outcome

- TLS: **fallar con error normalizado** (`UntrustedCertificate`, E230001) que guía a aceptar el certificado con otro cliente. La app nunca confía de forma global ni por defecto. Decisión del usuario.
- Copia antigua: **error normalizado** (`WorkingCopyTooOld`, E155036) que indica ejecutar `svn upgrade` con otro cliente; la app no hace upgrade, que es irreversible. Decisión del usuario.
- Encoding: medido con svn 1.14.2 (SlikSVN) el 2026-10-13, `--xml` sale en UTF-8 y stderr sale en la code page ANSI de Windows (`ñ` llega como byte `0xF1`). **stderr se decodifica como UTF-8 y, si no es válido, como Latin-1**; no se fuerza el entorno del hijo. Los códigos `E######` son ASCII y no dependen de esto.
- Versión mínima del cliente: **1.10**, por `--password-from-stdin` (CHANGES de Subversion, 1.10.0). 1.14.2 acepta la opción aunque `svn help` no la liste.

### Consequences

- Positiva: ningún cambio irreversible ni de confianza ocurre sin que el usuario lo decida fuera de la app.
- Negativa: si el locale del usuario no es Latin-1 (otra code page), los acentos de stderr pueden verse mal; los códigos y el `kind` no se afectan.
- Neutral: stdout de `--xml` se parsea siempre como UTF-8.

## More Information

`src-tauri/src/svn/error.rs`, `src-tauri/src/svn/runner.rs` (`decode_stderr`), `src-tauri/src/app/svn_locator.rs`. Pruebas: `src-tauri/tests/svn_layer.rs`. Ver `plans/fase-1-fundacion/spec.md` CA-3, CA-10, CA-15, CA-16, CA-17.
