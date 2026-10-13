# Spec — Fase 1: Fundación

> QUE y POR QUE. Diseño aprobado: `design.md`. Semilla: `propuesta.md`.

## Problema

El usuario necesita reemplazar TortoiseSVN en Windows con un cliente propio (dakedaduck svn). Antes de cualquier explorador o editor hace falta una base segura y probada contra un repositorio SVN real: saber dónde se puede operar, encontrar el cliente `svn.exe`, y completar el ciclo mínimo de trabajo diario.

## Comportamiento esperado

El usuario elige una carpeta raíz de trabajo (Workspace Root). La app localiza `svn.exe` y avisa claramente si no lo encuentra. Dentro del Workspace Root puede hacer checkout de una URL, ver información y estado de una copia de trabajo, actualizarla y confirmar cambios con mensaje. Ninguna operación puede tocar rutas fuera del Workspace Root. Las operaciones largas muestran progreso y se pueden cancelar. Los errores de SVN se muestran normalizados y entendibles. Las contraseñas nunca quedan en argumentos de proceso ni en logs.

## Criterios de aceptación

- [ ] CA-1 Workspace Root: se puede fijar y persiste entre ejecuciones; una ruta con `..`, prefijo de dispositivo, nombre reservado de Windows, junction/symlink que escapa, o carpeta hermana de prefijo similar (`C:\SVN2` vs `C:\SVN`) es rechazada; la comparación ignora mayúsculas.
- [ ] CA-2 Destino existente sin `allow_overwrite` explícito devuelve `DestinationExists`.
- [ ] CA-3 Localización de `svn.exe` en orden: configuración manual, PATH, TortoiseSVN, SlikSVN, Apache; validada con `svn --version --quiet` y versión mínima 1.10 (requerida por `--password-from-stdin`); sin cliente válido o con versión menor el error es claro y la ruta manual puede fijarse.
- [ ] CA-4 `wc_info` devuelve un resultado tipado (URL, revisión, raíz del repo) de una copia de trabajo real.
- [ ] CA-5 `wc_status` devuelve entradas tipadas, con y sin consulta al servidor.
- [ ] CA-6 `svn_checkout` crea una copia de trabajo desde un repo real dentro del Workspace Root y emite progreso.
- [ ] CA-7 `wc_update` actualiza una copia de trabajo y emite progreso; update y commit sobre la misma copia se serializan, copias distintas corren en paralelo.
- [ ] CA-8 `wc_commit` confirma cambios con mensaje y devuelve la nueva revisión.
- [ ] CA-9 `op_cancel` termina el proceso hijo de una operación en curso; `wc_cleanup` ejecuta `svn cleanup` sobre la copia afectada y un error de copia bloqueada (E155004) ofrece esa acción.
- [ ] CA-10 Los errores SVN se normalizan por código `E######` conservando comando, stdout, stderr, exit y timestamp sin contraseñas.
- [ ] CA-11 El frontend no tiene acceso a `fs` ni a shell; solo invoca commands tipados desde `services/tauri.ts`; `dialog` solo para elegir carpeta.
- [ ] CA-12 Shell mínimo de UI: onboarding (elegir Workspace Root, detectar svn) y panel de proyecto con info, estado, update y commit, con tokens Claymorphism.
- [ ] CA-13 Pruebas de integración corren contra repos reales creados con `svnadmin create` + `file:///`; sin svn fallan con mensaje claro.
- [ ] CA-14 Repos remotos sin credenciales en caché: la UI pide usuario y contraseña, que viajan con `--username` y `--password-from-stdin`; la app no los guarda en su configuración ni en logs. El auth cache de Subversion puede conservarlos según su propia configuración (decisión: delegarlo, como TortoiseSVN).
- [ ] CA-15 Certificado TLS no confiable: falla con error normalizado que guía a aceptarlo con otro cliente; la app nunca confía de forma global ni por defecto.
- [ ] CA-16 Copia de trabajo de formato 1.7 o anterior (E155036): error normalizado que indica ejecutar `svn upgrade` con otro cliente; la app no hace upgrade.
- [ ] CA-17 Rutas con tildes, ñ y espacios (como `Escritorio` bajo OneDrive) funcionan de extremo a extremo; el manejo de encoding de stderr/progreso se fija empíricamente con svn.exe 1.14.
- [ ] CA-18 Gates en verde: `cargo check`, `cargo test`, `npm test`, `npm run build`.

## Fuera de alcance

Explorador completo, pestañas, Marketplace, merge, resolución de conflictos, editores (Monaco llega en Fase 7), revision graph, almacenamiento de credenciales propio (se delega al auth cache de Subversion).
