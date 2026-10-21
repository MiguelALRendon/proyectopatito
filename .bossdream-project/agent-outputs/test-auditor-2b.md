# Auditoría de calidad de las pruebas de la 2B (bossdream-qa-auditor, 2026-10-20)

Veredicto: pass, con 20 hallazgos (5 medios). Resumen:

- H-01 (media): `office_thread.js`: el `it.each` «bloquea %s» solo ejercita prefijos; la lista `BLOCKED` exacta y los prefijos `private:`, `macro:`, `mailto:`, `.uno:Export*` y `.uno:SendMail*` no tienen prueba Vitest.
- H-02 (media): `host.js`: `stored->saved`, el reenvío de `modified`, `blocked` y `save-requested`, `fit`/`resize` y la descarga de más de un tramo no tienen prueba Vitest (solo el E2E office-edit).
- H-03 (media): `write_bytes.rs` (357-363, 204, 161-166): `is_err()` sobre un archivo inexistente; pasaría aunque se quitara la frontera del workspace.
- H-04 (media): `archive_extract.rs` 330-343: la aserción está dentro de `if outcome.is_err()`.
- H-05 (media): `reader_rar.rs` 186-192: busca números sueltos en el `Debug`; un intercambio de argumentos entre `with_max_header_bytes` y `with_max_member_output_bytes` sobrevive.
- H-06 a H-20 (bajas): duración infinita en el reproductor, `removeAttribute('src')` sin comprobar, pruebas de cancelación y de «no deja temporal» que pasan en vacío, RAR sin comprobar contenido, razones por nombre hostil, prueba de la carpeta empaquetada con `return` silencioso, cableado de `create_main_window` solo por texto, ramas de release que el pipeline no ejecuta, mapeo nombre a archivo de zeta-assets, byte NUL, `sanitize(".")`, `defaultPrevented` en Ctrl+S, versiones de `THIRD_PARTY_LICENSES.md` sin comparar y solo el camino de fallo de `verify-installer.ps1`.
- Nota: `docs/testing.md` anuncia tres archivos Pester y existen dos (la prueba de `verify-installer` vive en `build-release.Tests.ps1`).
