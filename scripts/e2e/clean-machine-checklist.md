# Prueba en una máquina limpia (acción del usuario)

Objetivo: demostrar que el instalador funciona en un Windows 11 que nunca vio este proyecto (CA-14). Esta máquina de desarrollo no sirve: tiene Visual Studio, SlikSVN y WebView2 instalados por otros caminos.

## Qué necesitas

- Una máquina o máquina virtual con **Windows 11** recién instalado, sin Visual Studio, **sin Subversion instalado** (el instalador ya lleva SlikSVN 1.14.5) y sin haber abierto nunca este proyecto.
- El instalador: `Dakedaduck SVN_0.1.0_x64-setup.exe` (generado por `scripts/build-release.ps1`; 59,8 MiB).
- Una carpeta con los archivos de prueba: un `.txt`, un `.pdf`, un `.docx`, un `.wav` o `.mp3`, un vídeo `.mp4`, un `.zip` y un `.7z`.
- Un repositorio de prueba al que la máquina llegue (por ejemplo un `svn://` o un `file:///` copiado), con su URL.

## Pasos y evidencia

| #   | Paso                                                                                                                                                                                                   | Evidencia que se espera                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | Anota la versión de Windows (`winver`) y la de WebView2 (`edge://version` no sirve: abre `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` y copia `pv`) | Captura o texto de ambas                                                               |
| 2   | Ejecuta el instalador (doble clic, sin administrador)                                                                                                                                                  | Captura del asistente y de la carpeta de instalación (`%LOCALAPPDATA%\Dakedaduck SVN`) |
| 3   | Abre la aplicación desde el menú Inicio                                                                                                                                                                | Captura de la ventana principal                                                        |
| 4   | Elige la carpeta de trabajo con los archivos de prueba                                                                                                                                                 | Captura del explorador                                                                 |
| 5   | Abre cada archivo de prueba y comprueba que se ve o se reproduce                                                                                                                                       | Una captura por tipo; apunta cuáles fallan                                             |
| 6   | Abre el `.docx`, escribe una línea y guarda                                                                                                                                                            | Captura del documento y del chip «Guardado»                                            |
| 7   | Extrae el `.zip` y el `.7z`                                                                                                                                                                            | Captura del diálogo de resultado                                                       |
| 8   | Sin instalar Subversion: abre «Acerca de» (debe decir «incluido con la aplicación») y haz un checkout, un cambio y un commit contra el repositorio de prueba                                           | Captura de «Acerca de», del registro de progreso y del log del repositorio             |
| 9   | Cierra la aplicación y desinstala desde «Aplicaciones instaladas»                                                                                                                                      | Captura de que la carpeta de instalación desaparece                                    |
| 10  | Mira en el Administrador de tareas que no queda ningún proceso `dakedaduck-svn` ni `msedgewebview2` suyo                                                                                               | Captura del Administrador de tareas                                                    |

## Qué hacer con el resultado

Devuélvelo todo (capturas y notas de lo que falló). Con eso se decide `webviewInstallMode` (mantener `downloadBootstrapper` o pasar a `offlineInstaller`) y se marca CA-14. Sin esa evidencia real, CA-14 no se marca.
