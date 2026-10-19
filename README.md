# dakedaduck svn

Cliente de Subversion de escritorio para Windows 11, pensado como reemplazo funcional de TortoiseSVN. Tauri 2 (Rust) con una interfaz Vue 3 + TypeScript. Solo Rust lanza `svn.exe`.

## Qué hace hoy

- Fases 1, 2A y 2B: abrir una copia de trabajo, `checkout`, `update`, `commit` y `cleanup` con progreso y cancelación; explorador de archivos con favoritos y pestañas; editores de texto, Markdown, PDF, imágenes, audio, vídeo, documentos de Office (ZetaOffice, LibreOffice en WebAssembly) y comprimidos (zip, tar, 7z y RAR, con extracción segura).
- El instalador lleva Subversion (SlikSVN 1.14.5): no hace falta instalarlo aparte. Si el usuario configura su propio `svn.exe`, gana ese.
- Lo que sigue diferido (marketplace, log, diff, ramas, conflictos) está en el [roadmap](docs/roadmap.md).

## Desarrollo

Requisitos: Windows 11, Node.js, la toolchain MSVC de Rust (`rustup`) y, para las pruebas de integración, `svn`, `svnadmin` y `svnserve`.

```powershell
npm install
npm run fetch:zetaoffice   # descarga ZetaOffice, fijado por SHA-256
npx tauri dev
```

Pruebas: `npm test` (Vitest), `cargo test` dentro de `src-tauri` y `npm run test:e2e` (E2E contra la aplicación real; ver [pruebas](docs/testing.md)).

Instalador: `scripts/build-release.ps1` genera el instalador de NSIS por usuario (sin administrador) en `src-tauri/target-release`. No está firmado, así que SmartScreen avisará.

## Documentación

[Arquitectura](docs/ARCHITECTURE.md) · [Constitución](docs/constitution.md) · [Editores](docs/editors.md) · [Seguridad](docs/security.md) · [Integración con Subversion](docs/svn-integration.md) · [Pruebas](docs/testing.md) · [Deuda técnica](docs/TECH_DEBT.md) · [Decisiones (ADR)](docs/adr/)

## Licencia

MIT, ver [LICENSE](LICENSE). Los componentes de terceros que se incluyen y sus licencias están en [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
