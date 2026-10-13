Notas del proyecto dakedaduck svn (decisiones tomadas en /bossdream-new y /bossdream-init, 2026-10-12)

Nombre: el producto se llama "dakedaduck svn" (paquete dakedaduck-svn, identificador com.dakedaduck.svn). "Patito" era solo el nombre de la carpeta; la carpeta sigue llamándose "Proyecto Patito".

Origen: propuesta.md (136 secciones) describe un reemplazo completo de TortoiseSVN. Se reconstruyó a mano tras borrarse por accidente; si hay diferencias con el original, manda la reconstrucción del usuario.

Referencia visual: C:\Users\spook\Downloads\malia-documalia-master (Vue 3 + Pinia + Tauri 2 + GSAP + CodeMirror, Claymorphism). Se reutilizan tokens.css, TabBar, ContextMenu, ResizeHandle, BaseModal, ConfirmDialog, WindowTitleBar y composables de persistencia y paneles. No se trae nada del dominio MaliAPI.

Decisiones de stack:
- Frontend Vue 3 + TS + Vite + Pinia.
- Editor de código Monaco (el usuario lo prefirió sobre CodeMirror, aunque DocuMalia usa CodeMirror).
- Primer incremento: Fase 1 vertical mínima (Workspace Root, svn.exe, info, status, checkout, update, commit) con tests contra repo real.
- Documentación de diseño resumida en plans/fase-1-fundacion/design.md; los docs/*.md de la propuesta (§126) crecen con cada fase.
- Sin tauri-plugin-shell: solo Rust lanza svn.exe.

Entorno:
- SlikSVN 1.14.2 instalado con winget en C:\Program Files\SlikSvn\bin (svn.exe, svnadmin.exe); no está en el PATH.
- PowerShell 7 instalado con winget (los hooks de BossDream usan pwsh); requiere reiniciar la sesión de Claude Code.
- El Rust global era GNU y fallaba (dlltool); se fijó el toolchain MSVC solo para este proyecto con rustup override.

Lección: create-tauri-app con --force vació la carpeta y borró propuesta.md y plans/. No usar --force en carpetas con trabajo existente.

Pendiente: stack-pack de Rust no existe; el pipeline lleva etapas rust-check y rust-test a mano. La etapa unit fallará hasta que haya tests. Monaco puede necesitar style.vendorExempt.
