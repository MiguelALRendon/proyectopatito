# Fixtures heredados de Office (doc, xls, ppt)

Procedencia: generados el 2026-10-17 en el spike S1c de la Fase 2B con ZetaOffice (compilación `zetaoffice_latest` del 2025-05-13, LibreOffice 24.2 de la rama `distro/allotropia/zeta-24-2`).

| Archivo | Cómo se produjo | Filtro | SHA-256 |
|---|---|---|---|
| `documento.doc` | `scripts/e2e/make-office-fixtures.ps1` produce `documento.odt`; se abrió, se editó, se guardó con `storeToURL` y se reabrió y guardó con `store()` | `MS Word 97` | `fbfe4cd93fc28cb7276817771c68abc2aff21c6dd752ff6278993c2f2f448f9e` |
| `hoja.xls` | igual, desde `hoja.ods` | `MS Excel 97` | `69cf42d561b4be1a157afd184e3732cdba9a3aeb7b177f1ebd5e2b5c51e3bc2e` |
| `presentacion.ppt` | igual, desde `presentacion.odp` | `MS PowerPoint 97` | `5334c1e6c4c337d25d3c90407d04cb007fd271f270a0b05c1248e79771e11d8d` |

Limitación asumida: prueba circular. El mismo motor que los produjo es el que los abre en las pruebas, y no hay Microsoft Office en esta máquina; solo se valida que el contenedor OLE2 (`D0 CF 11 E0`) se clasifique y que el contenido se lea de vuelta. Una comprobación con Word, Excel y PowerPoint reales queda como prueba manual opcional.

Los fabricados con `System.IO.Compression` (docx, xlsx, pptx, odt, ods, odp) no se commitean: los genera `scripts/e2e/make-office-fixtures.ps1` en cada ejecución.
