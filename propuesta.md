# Proyecto: Cliente SVN completo para Windows — reemplazo funcional de TortoiseSVN

Quiero desarrollar una aplicación de escritorio para Windows utilizando **Tauri 2 + Rust + frontend web**, cuyo objetivo sea reemplazar completamente mi experiencia de uso de TortoiseSVN mediante una interfaz moderna, centralizada y mucho más parecida a un explorador de archivos/IDE.

La aplicación debe utilizar **Apache Subversion como motor de control de versiones**. No quiero reinventar el protocolo SVN ni implementar un sistema de control de versiones propio.

La regla arquitectónica principal es:

> **La aplicación es el cliente/GUI. Subversion es el motor.**

Cuando exista una operación equivalente mediante `svn.exe`, debe preferirse utilizar el cliente oficial de línea de comandos de Subversion en lugar de reimplementar su lógica.

---

# 1. CONTEXTO FUNDAMENTAL

Estoy obligado a utilizar TortoiseSVN actualmente, pero quiero reemplazar su experiencia de usuario.

La aplicación deberá funcionar sobre repositorios SVN existentes.

Debe ser compatible con las operaciones normales de Subversion y no debe asumir que los repositorios utilizan exclusivamente:

```text
/trunk
/branches
/tags
```

Aunque debe reconocer y aprovechar esa convención cuando exista.

No modificar servidores SVN ni requerir cambios en los repositorios existentes.

No crear una API propia entre cliente y servidor que sustituya a SVN.

---

# 2. REFERENCIA VISUAL EXISTENTE

Existe un proyecto local mío en:

```text
C:\workspace_miguel\MaliAPI\DocuMalia
```

Ese proyecto contiene una interfaz cuyo lenguaje visual, administración de ventanas, pestañas, exploración de archivos y composición general quiero reutilizar como referencia.

## OBLIGATORIO

Antes de comenzar a implementar la interfaz:

1. Inspecciona el proyecto.
2. Identifica:
   - framework frontend;
   - estructura de componentes;
   - sistema de ventanas;
   - sistema de pestañas;
   - explorador de archivos;
   - gestión de documentos;
   - navegación;
   - estilos;
   - componentes reutilizables;
   - iconografía;
   - manejo de estado;
   - persistencia;
   - drag & drop;
   - comportamiento de paneles;
   - modales;
   - menús contextuales;
   - diseño responsive;
   - sistema visual.
3. Reutiliza patrones y componentes cuando sea técnicamente viable.
4. No copies ciegamente código que no corresponda a la nueva arquitectura.
5. La nueva aplicación debe sentirse como una evolución de DocuMalia, no como una aplicación genérica de administración SVN.

El lenguaje visual deseado es **Claymorphism**, siguiendo el aspecto general de DocuMalia.

La aplicación debe sentirse como:

> Explorador de archivos + gestor documental + IDE ligero + cliente SVN profesional.

No debe parecer una página web administrativa.

---

# 3. FILOSOFÍA GENERAL DE LA APLICACIÓN

La aplicación tendrá dos grandes áreas:

```text
┌───────────────────────────────────────────────┐
│ Aplicación                                    │
├───────────────────────────────────────────────┤
│ [Mis archivos] [Marketplace]                  │
├───────────────────────────────────────────────┤
│                                               │
│                 CONTENIDO                     │
│                                               │
└───────────────────────────────────────────────┘
```

## Pestaña 1

```text
Mis archivos
```

Representa exclusivamente mi espacio local.

## Pestaña 2

```text
Marketplace
```

Representa los repositorios SVN remotos configurados y permite explorarlos y descargar elementos.

---

# 4. CONFIGURACIÓN INICIAL

La primera vez que se ejecuta la aplicación debe solicitar:

```text
¿Dónde deseas almacenar tus proyectos SVN?

[ Seleccionar carpeta ]
```

Por ejemplo:

```text
C:\SVN
```

Esta carpeta será el **Workspace Root** de la aplicación.

Todo checkout, descarga de working copies, exportaciones y proyectos gestionados desde la aplicación deben permanecer dentro de este árbol salvo que exista una operación explícita que técnicamente requiera otro comportamiento.

Ejemplo:

```text
C:\SVN
│
├── ProyectoA
│   ├── .svn
│   ├── src
│   └── ...
│
├── ProyectoB
│   ├── .svn
│   └── ...
│
└── ClienteX
    └── ...
```

La aplicación debe almacenar esta configuración de forma persistente.

Debe permitir posteriormente cambiar el Workspace Root, pero:

- validar que la nueva ubicación sea válida;
- detectar working copies existentes;
- evitar perder referencias;
- ofrecer migración/reasignación si corresponde;
- no mover automáticamente archivos sin confirmación.

---

# 5. SEGURIDAD DEL WORKSPACE

La aplicación debe considerar el Workspace Root como una frontera de seguridad lógica.

Si el Workspace Root es:

```text
C:\SVN
```

estas ubicaciones son válidas:

```text
C:\SVN\Proyecto
C:\SVN\Proyecto\src
C:\SVN\OtroProyecto
```

pero estas no:

```text
C:\Users\Miguel\Documents
C:\Windows
D:\OtroLugar
```

Todas las operaciones de:

- checkout;
- export;
- descarga;
- creación de working copy;
- movimiento;
- extracción;
- selección de destino;

deben validar que el destino permanezca dentro del Workspace Root.

Implementar validación real de rutas en Rust.

No confiar únicamente en validaciones JavaScript.

Prevenir:

- `..`;
- path traversal;
- rutas absolutas fuera del workspace;
- junctions/symlinks que permitan escapar del workspace;
- colisiones peligrosas;
- sobrescrituras accidentales.

Tauri permite restringir acceso al filesystem mediante scopes/capabilities; utilizar este mecanismo como defensa adicional.

---

# 6. ARQUITECTURA

Separar claramente:

```text
Frontend
   │
   ▼
Tauri Commands / Events
   │
   ▼
Rust Application Layer
   │
   ├── SVN Service
   ├── Filesystem Service
   ├── Workspace Service
   ├── Repository Service
   ├── Document Service
   ├── Credential Service
   └── Configuration Service
          │
          ▼
      svn.exe
          │
          ▼
     SVN Server
```

El frontend nunca debe construir comandos shell arbitrarios.

Debe existir una capa Rust especializada para SVN.

Por ejemplo:

```rust
svn_checkout(...)
svn_update(...)
svn_status(...)
svn_commit(...)
svn_diff(...)
svn_log(...)
svn_info(...)
svn_list(...)
svn_merge(...)
svn_switch(...)
svn_resolve(...)
svn_revert(...)
svn_lock(...)
svn_unlock(...)
```

Las funciones deben recibir estructuras fuertemente tipadas.

No concatenar strings peligrosamente para ejecutar comandos.

Utilizar argumentos separados.

Tauri permite exponer funciones Rust mediante commands tipados y comunicación mediante eventos; aprovechar esta arquitectura.

---

# 7. MOTOR SVN

La aplicación debe detectar automáticamente:

```text
svn.exe
```

y mostrar:

```text
Subversion detectado

Versión del cliente:
1.14.x

Ruta:
C:\...
```

Debe permitir configurar manualmente la ruta si no se encuentra automáticamente.

Idealmente soportar:

- svn.exe del sistema;
- svn.exe instalado con TortoiseSVN;
- SlikSVN;
- instalación independiente;
- binario incluido/sidecar si posteriormente se decide distribuirlo.

No asumir que TortoiseSVN está instalado.

La aplicación debe funcionar sin depender de la GUI de TortoiseSVN.

El shell de Tauri debe estar restringido a los ejecutables necesarios y a argumentos permitidos.

---

# 8. PARSEO DE SVN

Preferir:

```text
svn ... --xml
```

cuando el comando lo permita.

No depender de parsear texto humano si existe una salida estructurada.

Crear modelos Rust para:

```text
SvnStatus
SvnInfo
SvnLogEntry
SvnRepositoryItem
SvnRevision
SvnConflict
SvnLock
SvnProperty
SvnMergeInfo
SvnOperationResult
```

Normalizar errores SVN.

Por ejemplo:

```text
AuthenticationRequired
AuthorizationDenied
RepositoryNotFound
WorkingCopyLocked
WorkingCopyCorrupt
ConflictDetected
TreeConflict
PropertyConflict
NetworkError
CertificateError
RevisionNotFound
InvalidWorkingCopy
LocalModification
UnknownError
```

Mostrar mensajes amigables al usuario, pero conservar:

- código SVN;
- stderr;
- stdout;
- comando;
- operación;
- timestamp;

en logs técnicos.

---

# 9. EXPLORADOR LOCAL

La pestaña:

```text
Mis archivos
```

debe comportarse principalmente como un explorador de archivos moderno.

Diseño:

```text
┌────────────────────────────────────────────────────────────┐
│ ← → ↑   Ruta / Breadcrumb                 🔍 Buscar        │
├───────────────┬────────────────────────────────────────────┤
│ FAVORITOS     │                                            │
│               │        Carpetas y archivos                 │
│ ★ Workspace   │                                            │
│ ★ Proyecto A  │      📁 ProyectoA                          │
│ ★ Proyecto B  │      📁 ProyectoB                          │
│ ★ Documentos  │      📄 README.md                          │
│               │      📄 Proyecto.sln                        │
│               │                                            │
│               │                                            │
├───────────────┴────────────────────────────────────────────┤
│ Estado SVN / información contextual                        │
└────────────────────────────────────────────────────────────┘
```

---

# 10. VISTAS

Implementar:

### Vista cuadrícula

```text
📁 Proyecto A
📁 Proyecto B
📄 README.md
📄 documento.docx
📊 datos.xlsx
```

### Vista lista

```text
Nombre        Tipo       Tamaño      Modificado       SVN
Proyecto A    Carpeta    —           04/09/2026       ✓
README.md     Markdown   12 KB       04/09/2026       M
```

### Vista detalles

Con columnas configurables.

### Vista árbol

Para navegar rápidamente por proyectos.

Recordar qué vista utiliza cada ubicación.

---

# 11. FAVORITOS

Permitir:

- agregar carpeta a favoritos;
- quitar favorito;
- reordenar;
- renombrar favorito;
- favoritos persistentes;
- favoritos de proyectos;
- favoritos de repositorios;
- favoritos de rutas internas.

Ejemplo:

```text
★ Workspace
★ Proyecto Finanzas
★ Proyecto API
★ Documentación
```

---

# 12. PESTAÑAS

Implementar sistema de pestañas similar a un navegador/IDE.

Ejemplo:

```text
[ ProyectoA ] [ README.md ] [ datos.xlsx ] [ + ]
```

Cada pestaña puede contener:

- carpeta;
- archivo;
- documento;
- diff;
- historial;
- conflicto;
- repositorio;
- vista de propiedades.

Permitir:

- cerrar pestaña;
- cerrar otras;
- cerrar a la derecha;
- reordenar;
- duplicar;
- abrir en nueva ventana;
- restaurar pestañas;
- confirmar antes de cerrar documentos modificados.

---

# 13. VENTANAS/PANELES

Reutilizar el concepto visual de DocuMalia.

Soportar:

- panel lateral;
- panel inferior;
- panel de información;
- panel de cambios;
- panel de terminal/log;
- panel de propiedades;
- panel de preview.

Permitir redimensionarlos.

Recordar tamaños y posiciones.

---

# 14. DETECCIÓN SVN DE CARPETAS

Cuando el usuario entre a:

```text
C:\SVN\ProyectoA
```

detectar automáticamente si es una working copy.

Utilizar:

```text
svn info
```

o una operación equivalente.

Si es SVN:

mostrar indicadores:

```text
✓ Working Copy
Repository: https://servidor/repos/ProyectoA
Revision: 1832
Root: https://servidor/repos
Branch: /trunk
```

Si no es SVN:

```text
Carpeta local
```

---

# 15. ESTADO SVN

La aplicación debe ofrecer una representación visual mucho mejor que los overlays tradicionales.

Estados mínimos:

```text
✓ Sin cambios
M Modificado
A Agregado
D Eliminado
R Reemplazado
C Conflicto
? No versionado
! Faltante
~ Tipo cambiado
X Externo
I Ignorado
```

También mostrar:

```text
Localmente modificado
Modificado remotamente
Modificado local y remotamente
Bloqueado
Conflicto
Sincronizado
```

El equivalente funcional de "Check for Modifications" debe utilizar `svn status`, y cuando se solicite información remota utilizar `svn status -u`. TortoiseSVN utiliza precisamente estas operaciones.

---

# 16. CENTRO DE CAMBIOS

Crear una vista:

```text
CAMBIOS

ProyectoA

▼ Modificados
   ☑ Program.cs
   ☑ UserService.cs

▼ Agregados
   ☑ Cliente.cs

▼ Eliminados
   ☑ OldService.cs

▼ No versionados
   ☐ notas.txt

▼ Conflictos
   ⚠ appsettings.json
```

Cada elemento debe permitir:

- abrir;
- editar;
- diff;
- revertir;
- eliminar;
- agregar;
- resolver;
- ignorar;
- mostrar historial;
- propiedades.

---

# 17. COMMIT

Crear una experiencia de commit profesional.

```text
┌────────────────────────────────────────────┐
│ Commit                                     │
├────────────────────────────────────────────┤
│ ☑ M Program.cs                             │
│ ☑ M Service.cs                             │
│ ☑ A Cliente.cs                             │
│ ☐ ? notas.txt                              │
│                                            │
│ Mensaje                                    │
│ ┌────────────────────────────────────────┐ │
│ │ Implementa módulo de clientes          │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ Archivos: 3                                │
│                                            │
│              [Cancelar] [Commit]           │
└────────────────────────────────────────────┘
```

Soportar:

- selección individual;
- selección por grupo;
- excluir elementos;
- commit de carpetas;
- commit de archivos;
- mensajes;
- plantillas;
- historial de mensajes;
- changelists;
- integración con issue tracker;
- advertencias antes de commit;
- locks;
- propiedades.

Subversion permite commit de propiedades porque las propiedades versionadas forman parte del control de versiones.

---

# 18. COMMIT PARCIAL

Debe investigarse e implementarse el equivalente a:

```text
Commit only parts of files
```

cuando sea viable.

No asumir que solamente se pueden seleccionar archivos completos.

La interfaz debe poder evolucionar hacia:

```text
Program.cs

☑ línea 10
☐ línea 20
☑ línea 30
```

mediante selección de hunks cuando la capacidad de SVN/patch lo permita.

---

# 19. UPDATE

Botón:

```text
Actualizar
```

Debe soportar:

- update a HEAD;
- update a revisión específica;
- profundidad;
- ignorar externals;
- incluir externals;
- sparse checkout;
- mostrar progreso;
- detectar conflictos;
- mostrar resultado.

TortoiseSVN contempla profundidades y externals en las operaciones de actualización.

Después del update:

```text
Actualización completada

Revision: r1842

Actualizados: 17
Agregados: 3
Eliminados: 2
Conflictos: 0
```

---

# 20. CHECKOUT

Implementar:

```text
Checkout
```

con:

- URL;
- destino;
- revisión;
- profundidad;
- externals;
- sparse checkout;
- progreso;
- autenticación.

El destino debe estar obligatoriamente dentro del Workspace Root.

---

# 21. REPOSITORY BROWSER

Implementar un navegador remoto equivalente al Repository Browser de TortoiseSVN.

Debe permitir:

```text
Servidor
└── Repository
    ├── trunk
    ├── branches
    └── tags
```

Pero no asumir esa estructura.

Utilizar:

```text
svn info
svn list
```

para navegar.

TortoiseSVN obtiene información del repositorio mediante `svn info` y contenido de directorios mediante `svn list`.

---

# 22. REPOSITORIOS

Debe existir una sección de repositorios configurados.

Ejemplo:

```text
REPOSITORIOS

★ Corporativo
  https://svn.empresa.local/

★ Proyecto Legacy
  https://svn.otroservidor.com/repos/

★ Documentación
  https://servidor/docs/
```

Permitir:

- agregar URL;
- eliminar;
- editar;
- renombrar;
- probar conexión;
- autenticar;
- navegar;
- marcar favorito;
- recordar última ubicación.

IMPORTANTE:

SVN no proporciona necesariamente un catálogo global de todos los repositorios disponibles.

El concepto de "Marketplace" debe trabajar sobre repositorios/URLs que el usuario configure o descubra mediante las capacidades disponibles del servidor.

---

# 23. MARKETPLACE

Crear una segunda pestaña principal:

```text
Marketplace
```

Su función NO es abrir documentos.

Es un explorador remoto de contenido SVN.

Ejemplo:

```text
┌─────────────────────────────────────────────────────────┐
│ Marketplace                                             │
├───────────────┬─────────────────────────────────────────┤
│ REPOSITORIOS  │                                         │
│               │ /Proyecto                              │
│ ★ Corporativo │                                         │
│               │ 📁 trunk                                │
│               │ 📁 branches                             │
│               │ 📁 tags                                 │
│               │ 📄 README.md                            │
│               │ 📄 Manual.docx                          │
│               │ 📊 Datos.xlsx                           │
└───────────────┴─────────────────────────────────────────┘
```

---

# 24. COMPORTAMIENTO DEL MARKETPLACE

Al seleccionar una carpeta:

```text
📁 ProyectoA
```

navegar dentro.

Al seleccionar un archivo:

```text
README.md
```

NO abrirlo.

En su lugar abrir un panel lateral:

```text
┌────────────────────────────────────┐
│ README.md                          │
├────────────────────────────────────┤
│ Tipo: Markdown                     │
│ Tamaño: 18 KB                      │
│ Revisión: r1842                    │
│ Autor: Miguel                      │
│ Última modificación: 04/09/2026    │
│                                    │
│ Estado local                       │
│ ✓ Ya descargado                    │
│                                    │
│ [ Descargar ]                      │
└────────────────────────────────────┘
```

---

# 25. INFORMACIÓN REMOTA

El panel debe mostrar, cuando esté disponible:

- nombre;
- tipo;
- tamaño;
- última revisión;
- última modificación;
- autor;
- URL;
- ruta;
- propiedades;
- locks;
- MIME type;
- estado local;
- working copy relacionada.

---

# 26. DESCARGAR DESDE MARKETPLACE

Botón:

```text
Descargar
```

debe abrir selector de destino.

Pero el selector solamente puede aceptar destinos dentro del Workspace Root.

Ejemplo:

```text
Workspace:

C:\SVN
```

El usuario selecciona:

```text
C:\SVN\ClienteA
```

y la aplicación descarga ahí.

---

# 27. DOWNLOAD ≠ EXPORT

Implementar dos conceptos claramente separados.

## Exportar

Obtiene contenido sin metadata SVN.

```text
svn export
```

Ideal para:

- copia limpia;
- distribución;
- documentos;
- archivos que no necesitan seguimiento.

## Descargar como proyecto

Realiza un:

```text
svn checkout
```

y crea una working copy real.

Esto es obligatorio cuando el usuario quiera posteriormente:

- actualizar;
- modificar;
- hacer commit;
- comparar;
- resolver conflictos;
- cambiar de rama;
- fusionar.

No ocultar esta diferencia.

---

# 28. ESTADO DEL MARKETPLACE

Cuando un archivo remoto ya existe localmente, determinar si está:

```text
✓ Descargado
↓ Actualizable
⚠ Desactualizado
✎ Modificado localmente
⚠ Conflicto
↓ No descargado
```

Ejemplo:

```text
README.md

✓ Descargado
Revision local: r1840
Revision remota: r1842

[ Actualizar ]
```

---

# 29. CARPETAS DESCARGADAS

Si una carpeta remota corresponde a una working copy local:

```text
📁 ProyectoA
   ✓ Descargado
```

Si la revisión local es inferior:

```text
📁 ProyectoA
   ↓ Desactualizado
```

Si contiene modificaciones:

```text
📁 ProyectoA
   ✎ Cambios locales
```

Si existen conflictos:

```text
📁 ProyectoA
   ⚠ Conflictos
```

El estado debe obtenerse de SVN, no de timestamps locales.

---

# 30. DETECCIÓN DE CORRESPONDENCIA LOCAL/REMOTA

No depender exclusivamente del nombre de la carpeta.

Relacionar mediante información SVN:

```text
Repository Root
Repository URL
Relative URL
UUID
Working Copy Root
```

Ejemplo:

```text
Local:

C:\SVN\ProyectoA

SVN:

https://svn.empresa.com/repos/ProyectoA/trunk
```

La aplicación debe conocer que ambas entidades están relacionadas.

---

# 31. DESCARGAR ARCHIVO INDIVIDUAL

Cuando sea técnicamente apropiado, permitir descargar un archivo individual.

Pero distinguir:

```text
Descargar archivo
```

de:

```text
Crear working copy rastreable
```

Si una operación individual no puede mantener correctamente la semántica de working copy, explicarlo al usuario y ofrecer la alternativa apropiada.

No crear falsas working copies.

---

# 32. DESCARGAR CARPETA

Permitir:

```text
Descargar carpeta
```

con opciones:

```text
○ Working Copy
○ Export limpio

Revisión:
○ HEAD
○ Específica: [1842]

Profundidad:
○ Completa
○ Archivos
○ Inmediatos
○ Vacía

☑ Incluir externals
```

---

# 33. LOG / HISTORIAL

Cada archivo, carpeta y repositorio debe poder mostrar historial.

Mostrar:

```text
r1842  Miguel
04/09/2026

Implementa módulo de clientes

├── Program.cs
├── Cliente.cs
└── Service.cs
```

Acciones:

- ver revisión;
- comparar;
- blame;
- checkout;
- export;
- revert;
- crear branch/tag;
- editar log cuando los permisos lo permitan;
- copiar detalles.

TortoiseSVN proporciona numerosas operaciones directamente desde el historial, incluyendo comparar revisiones, browse repository, blame, checkout/export, crear branch/tag y editar propiedades de revisión.

---

# 34. DIFF

Implementar:

```text
Diff local vs BASE
Diff local vs HEAD
Diff revisión A vs revisión B
Diff archivo vs archivo
Diff carpeta vs carpeta
```

Vista:

```text
┌───────────────┬───────────────┐
│ ORIGINAL      │ ACTUAL        │
├───────────────┼───────────────┤
│ - línea       │ + línea       │
│               │               │
└───────────────┴───────────────┘
```

Soportar:

- ignorar espacios;
- ignorar cambios de whitespace;
- diff binario cuando aplique;
- comparación de carpetas.

---

# 35. EDITOR DE DOCUMENTOS

Quiero que la aplicación sea también un gestor documental.

Debe poder abrir prácticamente cualquier tipo de archivo razonable mediante un sistema de proveedores/editors.

Crear una abstracción:

```text
DocumentProvider
```

Ejemplos:

```text
TextEditor
MarkdownEditor
ImageViewer
PdfViewer
OfficeDocumentProvider
SpreadsheetProvider
PresentationProvider
CodeEditor
HexViewer
BinaryViewer
```

---

# 36. CÓDIGO

Para código utilizar un editor profesional.

Idealmente:

```text
Monaco Editor
```

Soportar:

- C#;
- C++;
- C;
- Rust;
- JavaScript;
- TypeScript;
- JSON;
- XML;
- YAML;
- SQL;
- HTML;
- CSS;
- Python;
- PowerShell;
- Bash;
- etc.

Características:

- resaltado;
- búsqueda;
- reemplazo;
- múltiples pestañas;
- minimapa;
- números de línea;
- selección;
- undo/redo;
- detección de cambios;
- guardado;
- autosave opcional.

---

# 37. MARKDOWN

Markdown debe tener:

```text
[Editor] [Preview] [Dividido]
```

Ejemplo:

```text
┌────────────────┬────────────────────────┐
│ # Documento    │ Documento              │
│                │                        │
│ ## Introducción│ Introducción           │
│                │                        │
│ - elemento     │ • elemento             │
└────────────────┴────────────────────────┘
```

---

# 38. OFFICE

La aplicación debe diseñarse para soportar:

```text
.doc
.docx
.xls
.xlsx
.ppt
.pptx
.odt
.ods
.odp
```

No asumir que Tauri puede editar nativamente todos estos formatos.

Diseñar un sistema de proveedores.

Opciones posibles:

1. integración con aplicaciones instaladas;
2. LibreOffice mediante automatización;
3. editores embebidos;
4. preview mediante conversión;
5. proveedor externo;
6. apertura con aplicación predeterminada.

El objetivo funcional es:

> El usuario no debería tener que abandonar la aplicación para trabajar con un documento.

Pero si un formato requiere una aplicación externa, debe abrirse de forma controlada y transparente.

---

# 39. PDF

Implementar preview PDF dentro de la aplicación cuando sea posible.

---

# 40. IMÁGENES

Soportar preview:

```text
png
jpg
jpeg
gif
webp
bmp
svg
ico
```

---

# 41. ARCHIVOS DESCONOCIDOS

Para archivos desconocidos:

```text
Archivo binario

Tipo:
application/octet-stream

Tamaño:
2.4 MB

[ Abrir con... ]
[ Mostrar hexadecimal ]
[ Abrir aplicación predeterminada ]
```

Nunca intentar interpretar automáticamente un binario como UTF-8.

---

# 42. SISTEMA DE EDITORES INSTALABLES

Crear arquitectura extensible:

```text
Editor Registry
│
├── Markdown
├── Código
├── Texto
├── PDF
├── Imagen
├── Word
├── Excel
├── PowerPoint
└── Otros
```

A futuro debe ser posible instalar providers.

---

# 43. CONFLICTOS

Implementar una experiencia profesional para conflictos.

Tipos:

```text
File Conflict
Property Conflict
Tree Conflict
```

TortoiseSVN distingue precisamente estos tipos de conflicto.

Interfaz:

```text
CONFLICTO

Archivo:
UserService.cs

┌──────────────┬──────────────┬──────────────┐
│ BASE         │ MÍO          │ SUYO         │
├──────────────┼──────────────┼──────────────┤
│              │              │              │
└──────────────┴──────────────┴──────────────┘

[ Usar mío ]
[ Usar suyo ]
[ Combinar ]
[ Editar manualmente ]

[ Marcar como resuelto ]
```

---

# 44. RESOLVE

Después de solucionar el archivo:

```text
svn resolve
```

Debe existir una operación explícita:

```text
Marcar como resuelto
```

Nunca marcar automáticamente como resuelto simplemente porque el archivo cambió.

---

# 45. TREE CONFLICTS

Crear interfaz específica para:

- archivo eliminado remotamente;
- archivo movido;
- archivo renombrado;
- carpeta movida;
- cambios incompatibles;
- operaciones de merge que generan conflictos estructurales.

No tratar todos los conflictos como simples conflictos de texto.

---

# 46. MERGE

Implementar completamente:

```text
Merge range of revisions
Merge two repository trees
```

Permitir:

- origen;
- destino;
- revisión;
- rangos;
- dry run;
- ignore ancestry;
- record only;
- merge tracking;
- preview;
- resultado;
- conflictos.

Subversion maneja merges de rangos y merges entre dos árboles, además de `svn:mergeinfo` para seguimiento de merges.

---

# 47. MERGEINFO

Mostrar visualmente:

```text
Mergeinfo

Source:
branches/feature

Merged:
r1820
r1821
r1822

Pending:
r1823
r1824
```

Permitir revisar `svn:mergeinfo`.

---

# 48. BRANCH / TAG

Implementar:

```text
Crear branch
Crear tag
```

con:

```text
Origen
Destino
Mensaje
Revisión
```

Opcionalmente:

```text
☑ Cambiar working copy al nuevo branch
☑ Crear carpetas intermedias
```

---

# 49. SWITCH

Implementar:

```text
Switch working copy
```

Ejemplo:

```text
Actualmente:

/trunk

Cambiar a:

/branches/feature-x
```

Soportar profundidad y externals.

---

# 50. LOCKS

Implementar completamente:

```text
Lock
Unlock
Lock status
```

Mostrar:

```text
🔒 bloqueado por Miguel

Comentario:
Editando documento final
```

Soportar:

- lock;
- unlock;
- steal lock cuando los permisos lo permitan;
- mantener locks después de commit;
- información de locks.

Subversion soporta locks sobre working-copy paths y URLs.

---

# 51. PROPIEDADES SVN

Crear inspector de propiedades.

Soportar:

```text
svn:ignore
svn:global-ignores
svn:externals
svn:mime-type
svn:eol-style
svn:keywords
svn:executable
svn:needs-lock
svn:mergeinfo
```

y propiedades personalizadas.

Permitir:

```text
Ver
Editar
Agregar
Eliminar
```

---

# 52. EXTERNALS

Detectar:

```text
svn:externals
```

Mostrar:

```text
🔗 External

libs/common

https://svn.empresa.com/common

Revision:
1840
```

Permitir:

```text
Actualizar external
Ignorar external
Ver repositorio
```

Las externals pueden apuntar incluso a otros repositorios y forman working copies anidadas; deben tratarse como entidades relacionadas pero distintas.

---

# 53. SPARSE CHECKOUT

Soportar profundidades:

```text
empty
files
immediates
infinity
exclude
```

Interfaz visual:

```text
Contenido del repositorio

☑ src
☐ docs
☑ config
☐ tests
```

No descargar innecesariamente grandes cantidades de contenido.

---

# 54. REVERT

Permitir:

```text
Revertir archivo
Revertir carpeta
Revertir selección
```

Mostrar advertencia:

```text
Esta operación eliminará los cambios locales.

¿Continuar?
```

Nunca ejecutar revert destructivo sin confirmación.

---

# 55. CLEANUP

Implementar:

```text
Cleanup working copy
```

con opciones disponibles.

Debe detectar working copies bloqueadas.

---

# 56. RELOCATE

Implementar una herramienta avanzada:

```text
Relocate working copy
```

con advertencia explícita.

No presentarlo como "actualizar".

Debe dejar claro que modifica la URL base asociada a la working copy.

---

# 57. IMPORT

Permitir:

```text
Importar carpeta local a SVN
```

con:

```text
URL destino
Mensaje
Autoprops
```

---

# 58. ADD / DELETE / MOVE / RENAME

Desde el explorador local:

```text
Nuevo archivo
Nueva carpeta

Agregar a SVN

Eliminar

Renombrar

Mover
```

Cuando un elemento esté versionado, realizar la operación SVN apropiada.

Evitar hacer:

```text
filesystem rename
```

si eso provoca que SVN interprete la operación como delete + add.

Usar las operaciones de Subversion para preservar la semántica.

---

# 59. IGNORE

Context menu:

```text
Ignorar
```

Opciones:

```text
Ignorar este archivo
Ignorar extensión
Ignorar patrón
Editar reglas
```

Utilizar propiedades SVN correspondientes.

---

# 60. BLAME

Implementar:

```text
Blame
```

Mostrar:

```text
Línea | Autor | Revisión | Fecha | Código
```

Ejemplo:

```text
12 | Miguel | r1842 | 04/09 | var user = ...
13 | Juan   | r1820 | 02/09 | ...
```

Permitir seleccionar una línea y navegar a su revisión.

---

# 61. REVISION GRAPH

Implementar un gráfico visual de ramas/revisiones.

TortoiseSVN genera esta visualización analizando información obtenida del repositorio; no es un comando nativo equivalente de `svn`.

Mostrar:

```text
trunk
 │
 ├──── feature-A
 │       │
 │       └──── merge
 │
 └──── feature-B
```

Permitir:

- zoom;
- pan;
- seleccionar revisión;
- abrir log;
- branch;
- tag;
- merge.

---

# 62. PATCH

Implementar:

```text
Crear patch
Aplicar patch
```

con preview.

---

# 63. CHANGELISTS

Soportar changelists.

Ejemplo:

```text
Cambios

Autenticación
  Program.cs
  AuthService.cs

UI
  Dashboard.razor
  styles.css
```

Permitir:

- crear;
- eliminar;
- agregar archivo;
- quitar archivo;
- commit por changelist.

---

# 64. SHELVING

Investigar y soportar shelving cuando el cliente SVN instalado lo permita.

Debe considerarse una característica opcional/experimental de Subversion 1.14.

No asumir disponibilidad universal.

Si no está disponible:

```text
Shelving no disponible en la versión actual de Subversion.
```

Subversion 1.14 documenta shelving como experimental.

---

# 65. EXPORT

Implementar:

```text
Exportar
```

a una carpeta dentro del Workspace Root.

Permitir:

- revisión;
- profundidad;
- externals;
- destino.

---

# 66. ARCHIVOS Y CARPETAS REMOTOS

El Repository Browser debe permitir acciones contextuales según permisos:

```text
Abrir
Descargar
Checkout
Exportar
Historial
Blame
Diff
Branch/Tag
Copiar
Mover
Eliminar
Crear carpeta
Propiedades
Lock
Unlock
```

TortoiseSVN proporciona operaciones de apertura/edición, historial, graph, blame y checkout directamente desde su Repository Browser.

Sin embargo, en MI Marketplace:

> **No abrir archivos remotos directamente.**

Siempre mostrar primero información lateral y acción de descarga.

---

# 67. AUTENTICACIÓN

Soportar los mecanismos normales de SVN.

Nunca almacenar contraseñas en texto plano.

Permitir:

```text
Usuario
Contraseña
Guardar credenciales
```

pero delegar almacenamiento seguro al mecanismo apropiado del sistema/Subversion cuando sea posible.

Mostrar:

```text
Credenciales requeridas
```

cuando SVN devuelva autenticación.

---

# 68. CERTIFICADOS SSL

Cuando aparezca un certificado desconocido:

```text
Certificado no confiable

Servidor:
...

Emisor:
...

Huella:
...

[Cancelar]
[Confiar]
```

No aceptar certificados arbitrarios silenciosamente.

No utilizar equivalentes peligrosos de:

```text
--trust-server-cert
```

sin consentimiento explícito.

---

# 69. PROGRESO

Todas las operaciones largas deben mostrar progreso:

```text
Actualizando ProyectoA

████████████████░░░░ 78%

Procesando:
src/Services/UserService.cs

Actualizados: 183
Pendientes: 47
```

Operaciones:

- checkout;
- update;
- commit;
- merge;
- export;
- import;
- cleanup;
- diff grande;
- búsqueda remota.

Permitir cancelar cuando SVN lo permita.

---

# 70. OPERACIONES EN SEGUNDO PLANO

No congelar la interfaz.

Usar tareas asíncronas.

El usuario debe poder:

```text
Actualizar ProyectoA
```

y continuar navegando en:

```text
ProyectoB
```

siempre que las operaciones no entren en conflicto.

---

# 71. OPERACIONES CONFLICTIVAS

No permitir simultáneamente operaciones incompatibles sobre la misma working copy.

Ejemplo:

```text
Update
```

y:

```text
Commit
```

sobre la misma working copy.

Crear un gestor de operaciones por working copy.

---

# 72. CACHÉ

No ejecutar `svn status` recursivamente cada vez que el usuario mueve el mouse.

Implementar:

- caché;
- invalidación;
- refresh manual;
- refresh al volver a una pestaña;
- filesystem watcher;
- actualización diferida.

Tauri filesystem puede utilizar watchers; aprovecharlos para detectar cambios locales.

---

# 73. ACTUALIZACIÓN AUTOMÁTICA DEL ESTADO

Si el usuario edita:

```text
Program.cs
```

la aplicación debe detectar:

```text
M Program.cs
```

sin tener que pulsar manualmente Refresh.

Pero no hacer una consulta SVN al servidor por cada modificación local.

Separar:

```text
Estado local
```

de:

```text
Estado remoto
```

---

# 74. ESTADO LOCAL VS REMOTO

Mostrar claramente:

```text
LOCAL
M Program.cs

REMOTO
r1842 disponible

RESULTADO
⚠ Tu working copy está desactualizada y además tienes cambios locales.
```

No confundir:

```text
archivo modificado localmente
```

con:

```text
archivo modificado en servidor.
```

---

# 75. BÚSQUEDA

Implementar búsqueda:

### Local

Buscar:

- archivos;
- carpetas;
- contenido;
- extensiones;
- SVN status.

### Marketplace

Buscar dentro del contenido remoto cuando el servidor/operación SVN lo permita.

No asumir que `svn list` puede buscar contenido textual arbitrariamente en todo el servidor.

Si la búsqueda remota no es posible mediante SVN estándar:

```text
La búsqueda de contenido remoto requiere una fuente de indexación adicional.
```

No fingir funcionalidad.

---

# 76. MENÚ CONTEXTUAL

Crear menú contextual rico.

Para archivo local:

```text
Abrir
Abrir con...
Editar
Renombrar
Copiar
Mover
Eliminar
Duplicar
Mostrar en Explorer

SVN
  Ver estado
  Diff
  Historial
  Blame
  Commit
  Revertir
  Lock
  Unlock
  Propiedades
  Add
  Ignore
```

Para carpeta:

```text
Abrir
Checkout
Update
Commit
Merge
Switch
Branch/Tag
Export
Cleanup
Repository Browser
```

---

# 77. TERMINAL SVN

Añadir una vista avanzada:

```text
Terminal / SVN Output
```

Para debugging.

Mostrar:

```text
> svn update C:\SVN\ProyectoA

Updating...
At revision 1842.
```

Permitir copiar salida.

No necesariamente permitir un shell arbitrario desde la interfaz principal.

---

# 78. REGISTRO DE OPERACIONES

Crear historial interno:

```text
04/09 17:31
Update
ProyectoA
✓

04/09 17:20
Commit
ProyectoB
r1842
✓

04/09 16:50
Merge
ProyectoA
⚠ Conflict
```

---

# 79. LOGGING

Logs técnicos separados de la interfaz.

Registrar:

- operación;
- duración;
- working copy;
- repository URL;
- revisión;
- exit code;
- stdout;
- stderr;
- error SVN;
- stack trace cuando aplique.

No registrar contraseñas.

---

# 80. MANEJO DE ERRORES

Nunca mostrar:

```text
Error: exit code 1
```

como única información.

Mostrar:

```text
No fue posible actualizar la carpeta.

Motivo:
La working copy contiene conflictos.

Archivos afectados:
- appsettings.json
- UserService.cs

[ Ver conflictos ]
[ Ver detalles técnicos ]
```

---

# 81. OPERACIONES DESTRUCTIVAS

Confirmación obligatoria para:

- revert;
- delete;
- overwrite;
- export sobre carpeta existente;
- checkout sobre carpeta existente;
- relocate;
- steal lock;
- resolución que descarte cambios;
- eliminar working copy.

---

# 82. DRAG & DROP

Soportar:

- mover archivos;
- mover carpetas;
- abrir documentos;
- arrastrar al Marketplace;
- arrastrar remoto → Workspace;
- arrastrar local → otra carpeta.

Si una operación afecta SVN:

```text
filesystem operation
```

no debe ejecutarse directamente.

Debe convertirse en:

```text
svn move
svn copy
svn add
svn delete
```

cuando corresponda.

---

# 83. DOCUMENTOS MODIFICADOS

Si un documento abierto está modificado:

```text
README.md *
```

Al cerrar:

```text
Este documento tiene cambios sin guardar.

[Guardar]
[Descartar]
[Cancelar]
```

Si ya está guardado pero tiene cambios SVN:

```text
M README.md
```

no confundir ambos estados.

Debe existir:

```text
dirtyDocument
```

y:

```text
svnModified
```

como conceptos independientes.

---

# 84. SISTEMA DE ESTADOS VISUALES

Crear un sistema consistente:

```text
SVN_OK
SVN_MODIFIED
SVN_ADDED
SVN_DELETED
SVN_REPLACED
SVN_CONFLICT
SVN_UNVERSIONED
SVN_MISSING
SVN_LOCKED
SVN_REMOTE_MODIFIED
SVN_OUTDATED
SVN_EXTERNAL
```

Los iconos/colores deben ser configurables y accesibles.

---

# 85. REPOSITORIOS GRANDES

Diseñar para repositorios enormes.

No cargar:

```text
100,000 archivos
```

en memoria simultáneamente.

Utilizar:

- lazy loading;
- paginación donde sea posible;
- virtualización;
- carga bajo demanda;
- árboles virtualizados.

---

# 86. WORKING COPIES GRANDES

No recorrer toda la working copy innecesariamente.

Ejemplo:

```text
C:\SVN\ProyectoGigante
```

puede contener cientos de miles de archivos.

El explorador debe cargar directorios bajo demanda.

---

# 87. WINDOWS

La aplicación inicialmente será:

```text
Windows 10/11 x64
```

Prioridad absoluta:

```text
Windows
```

No sacrificar la UX de Windows para conseguir portabilidad prematura.

---

# 88. INTEGRACIÓN CON WINDOWS

Permitir:

```text
Abrir en Explorer
Copiar ruta
Copiar URL SVN
Abrir terminal aquí
Abrir con aplicación predeterminada
```

Opcionalmente:

- asociación de archivos;
- icono de aplicación;
- arrastrar desde Explorer;
- abrir carpeta desde Explorer.

---

# 89. EXPLORADOR VISUAL

Quiero que el explorador local sea uno de los componentes principales de la aplicación.

No quiero:

```text
tabla de archivos de administrador web
```

Quiero algo visualmente equivalente a:

```text
Explorer
Finder
IDE
Document Manager
```

pero con SVN integrado.

---

# 90. DOCUMENT TABS

Cuando abra:

```text
Program.cs
README.md
Manual.docx
Datos.xlsx
```

cada uno debe aparecer como una pestaña de documento.

Ejemplo:

```text
┌────────────────────────────────────────────────────────┐
│ ProyectoA │ Program.cs │ README.md │ Manual.docx │ + │
├────────────────────────────────────────────────────────┤
│                                                        │
│                   Documento                            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

# 91. MARKETPLACE Y DOCUMENTOS

El Marketplace nunca debe utilizar directamente los editores.

Esto es intencional.

Marketplace:

```text
Remote Repository
       │
       ▼
Metadata
       │
       ▼
Download
       │
       ▼
Local Workspace
       │
       ▼
Document Editor
```

No:

```text
Remote Repository
       │
       ▼
Open remote file
```

---

# 92. RELACIÓN MARKETPLACE ↔ LOCAL

Esta es una característica central.

Ejemplo:

Marketplace:

```text
ProyectoA
└── Manual.docx

Estado:
✓ Descargado
Revision:
1842
```

Local:

```text
C:\SVN\ProyectoA\Manual.docx
```

Si remoto:

```text
r1842
```

y local:

```text
r1840
```

mostrar:

```text
↓ Actualización disponible
```

Si local está modificado:

```text
✎ Modificado localmente
```

Si además remoto cambió:

```text
⚠ Cambios locales + remotos
```

---

# 93. SINCRONIZACIÓN

No implementar una sincronización inventada tipo Dropbox.

La sincronización debe respetar completamente la semántica SVN:

```text
Checkout
Update
Commit
Merge
Switch
```

---

# 94. REPOSITORIOS CON BRANCHES

El Marketplace debe representar correctamente:

```text
/trunk
/branches
/tags
```

si existen.

Opcionalmente detectar:

```text
Branch
Tag
Trunk
```

mediante patrones configurables.

No asumir que una carpeta llamada `tags` es siempre un tag si la configuración del repositorio no lo permite.

---

# 95. TAGS

Si se detecta una ubicación que parece ser un tag:

```text
🏷 tag
```

Mostrar advertencia antes de intentar commit.

TortoiseSVN tiene una advertencia específica para commits sobre tags y permite configurar los patrones de clasificación.

---

# 96. PROPIEDADES DEL REPOSITORIO

Crear panel:

```text
Información SVN

Repository Root
Repository UUID
Repository URL
Revision
Relative URL
Working Copy Root
Node Kind
Schedule
Depth
Last Changed Author
Last Changed Revision
Last Changed Date
```

---

# 97. REVISION PROPERTIES

Permitir ver:

```text
svn:log
svn:author
svn:date
```

y otras revision properties cuando los permisos del servidor permitan modificarlas.

---

# 98. ISSUE TRACKER

Diseñar una interfaz de integración opcional.

Por ejemplo:

```text
Issue:
[ABC-123]

Commit message:
Fix ABC-123 - Corrección de autenticación
```

No acoplar inicialmente a Jira/Azure DevOps/etc.

Crear una abstracción:

```text
IssueTrackerProvider
```

---

# 99. HOOKS

Soportar conceptualmente hooks/client hooks donde corresponda.

No asumir que los hooks de servidor pueden ser modificados desde el cliente.

Distinguir:

```text
Client hooks
Server hooks
```

Los hooks de servidor son ejecutados por el servidor del repositorio.

---

# 100. AUTOPROPS

Detectar/configurar:

```text
enable-auto-props
```

y propiedades automáticas cuando estén disponibles.

---

# 101. CONFIGURACIÓN SVN

Crear:

```text
Configuración
├── General
├── SVN
├── Credenciales
├── Repositorios
├── Workspace
├── Editores
├── Apariencia
├── Marketplace
├── Diff/Merge
├── Hooks
└── Avanzado
```

---

# 102. DIFF/MERGE TOOLS EXTERNAS

Permitir configurar:

```text
Diff tool
Merge tool
Editor
```

Ejemplos:

```text
VS Code
Beyond Compare
WinMerge
KDiff3
```

No incluirlos obligatoriamente.

---

# 103. APLICACIONES EXTERNAS

Permitir:

```text
Abrir con aplicación predeterminada
Abrir con...
```

para cualquier tipo de archivo.

---

# 104. CONFIGURACIÓN PERSISTENTE

Persistir:

```text
Workspace Root
Repositorios
Favoritos
Pestañas
Últimas ubicaciones
Vista seleccionada
Tamaño de paneles
Editores
Configuración SVN
Preferencias
```

No almacenar secretos en un JSON plano.

---

# 105. CACHE REMOTO

Puede existir caché de:

```text
repository listings
metadata
revision information
```

pero nunca utilizar la caché como fuente definitiva para operaciones destructivas.

Antes de:

```text
commit
update
merge
lock
branch
delete
```

consultar al servidor cuando sea necesario.

---

# 106. OFFLINE

Si no hay conexión:

```text
Modo sin conexión
```

permitir:

- navegar archivos locales;
- editar;
- revisar cambios locales;
- diff local;
- historial cacheado si existe.

No permitir operaciones que requieran servidor.

---

# 107. ESTADO DE CONEXIÓN

Mostrar:

```text
🟢 SVN conectado
```

o:

```text
🟡 Sin conexión
```

No hacer ping constantemente.

---

# 108. EXPERIENCIA DE PRIMER ARRANQUE

Primera ejecución:

```text
Bienvenido

Antes de comenzar necesitamos configurar:

1. Carpeta de trabajo
2. Cliente SVN
3. Repositorios opcionales
4. Editores opcionales
```

Pero el usuario debe poder saltarse la configuración de repositorios.

---

# 109. NO DUPLICAR TortoiseSVN

No intentar copiar visualmente TortoiseSVN.

La aplicación debe tomar:

> **las capacidades de TortoiseSVN**

pero proporcionar:

> **una experiencia completamente diferente.**

No utilizar overlays tradicionales como mecanismo principal de UX.

---

# 110. CAPACIDADES QUE DEBEN QUEDAR CUBIERTAS

Antes de considerar terminada la arquitectura, verificar explícitamente:

```text
[ ] Checkout
[ ] Update
[ ] Update to revision
[ ] Commit
[ ] Status
[ ] Remote status
[ ] Diff
[ ] Log
[ ] Revision graph
[ ] Repository browser
[ ] Resolve
[ ] File conflicts
[ ] Property conflicts
[ ] Tree conflicts
[ ] Revert
[ ] Cleanup
[ ] Rename
[ ] Move
[ ] Delete
[ ] Add
[ ] Ignore
[ ] Import
[ ] Export
[ ] Relocate
[ ] Branch
[ ] Tag
[ ] Switch
[ ] Merge revision range
[ ] Merge two trees
[ ] Merge tracking
[ ] Mergeinfo
[ ] Lock
[ ] Unlock
[ ] Lock status
[ ] Blame
[ ] Patch create
[ ] Patch apply
[ ] Changelists
[ ] Shelving cuando esté disponible
[ ] Properties
[ ] Revision properties
[ ] Externals
[ ] Sparse checkout
[ ] Autoprops
[ ] Client hooks
[ ] Issue tracker abstraction
[ ] Authentication
[ ] SSL/certificates
[ ] Working-copy detection
[ ] Local/remote status
```

Esta lista está basada en las operaciones expuestas por TortoiseSVN y en las capacidades del cliente Subversion.

---

# 111. COMANDOS SVN A CONSIDERAR

La capa SVN debe cubrir como mínimo las operaciones equivalentes a:

```text
svn add
svn blame
svn cat
svn changelist
svn checkout
svn cleanup
svn commit
svn copy
svn delete
svn diff
svn export
svn import
svn info
svn list
svn lock
svn log
svn merge
svn mergeinfo
svn mkdir
svn move
svn patch
svn propdel
svn propedit
svn propget
svn proplist
svn propset
svn relocate
svn resolve
svn resolved
svn revert
svn status
svn switch
svn unlock
svn update
svn upgrade
```

Esta relación corresponde al conjunto de comandos del cliente SVN documentado en la referencia de Subversion.

No todos tienen que aparecer como botones principales.

Algunos serán operaciones avanzadas/contextuales.

---

# 112. NO IMPLEMENTAR FALSAMENTE FUNCIONALIDADES

Regla crítica:

Si Subversion no puede realizar una operación de manera segura mediante el cliente disponible:

NO inventar una implementación que solamente parezca funcionar.

Mostrar:

```text
Esta operación no está disponible con la versión actual de Subversion.
```

o:

```text
Esta operación requiere un componente adicional.
```

---

# 113. VERSIONAMIENTO DE SVN

Detectar versión:

```text
svn --version --quiet
```

y adaptar características.

Especialmente:

```text
Shelving
Conflict resolver
```

y otras características que puedan variar según versión.

Subversion 1.14 es actualmente la línea LTS documentada y mantiene compatibilidad con clientes/servidores anteriores, aunque ciertas capacidades pueden requerir versiones recientes en ambos extremos.

---

# 114. COMPATIBILIDAD

El cliente debe funcionar contra:

```text
SVN 1.x
```

dentro de las compatibilidades normales del protocolo.

No asumir:

```text
cliente == servidor
```

ni:

```text
versión cliente == versión repository
```

---

# 115. TESTING

Crear pruebas para:

### Unitarias

- path validation;
- workspace security;
- command construction;
- XML parsing;
- SVN status parsing;
- log parsing;
- repository item parsing;
- conflict parsing;
- revision parsing.

### Integración

Crear un repositorio SVN local de pruebas y probar:

```text
checkout
update
commit
merge
branch
tag
switch
conflict
resolve
lock
unlock
revert
cleanup
export
import
externals
properties
```

### UI

Probar:

- abrir proyecto;
- navegar;
- editar;
- guardar;
- commit;
- update;
- conflicto;
- Marketplace;
- descarga;
- detección de estado;
- pestañas;
- documentos.

---

# 116. REPOSITORIO SVN DE PRUEBAS

Para desarrollo/test crear un repositorio temporal/local.

No depender de un servidor corporativo para las pruebas.

Los tests deben ser reproducibles.

---

# 117. SEGURIDAD

No permitir:

```text
Command injection
Path traversal
Credential leakage
Arbitrary executable execution
Arbitrary filesystem access
```

Nunca construir:

```text
Command("svn.exe", ["..." + userInput])
```

sin validar cada argumento.

Preferir estructuras tipadas.

---

# 118. DISEÑO DE API INTERNA

Crear algo conceptualmente parecido a:

```text
SvnClient
├── repository
│   ├── info()
│   ├── list()
│   ├── log()
│   └── browse()
│
├── working_copy
│   ├── info()
│   ├── status()
│   ├── update()
│   ├── commit()
│   ├── revert()
│   ├── cleanup()
│   └── resolve()
│
├── changes
│   ├── diff()
│   ├── patch()
│   └── changelist()
│
├── branching
│   ├── branch()
│   ├── tag()
│   ├── switch()
│   └── merge()
│
├── locking
│   ├── lock()
│   ├── unlock()
│   └── status()
│
└── properties
    ├── get()
    ├── set()
    ├── delete()
    └── list()
```

---

# 119. RESULTADOS TIPADOS

Nunca devolver al frontend simplemente:

```text
stdout: string
```

para todo.

Por ejemplo:

```typescript
interface SvnStatusItem {
    path: string;
    status: SvnStatus;
    localRevision?: number;
    remoteRevision?: number;
    author?: string;
    locked: boolean;
    conflicted: boolean;
    versioned: boolean;
}
```

---

# 120. DISEÑO DEL MARKETPLACE

El Marketplace debe sentirse como una tienda/explorador remoto, pero NO debe fingir que SVN es un marketplace.

Ejemplo:

```text
Marketplace

Repositorios
────────────────────

★ Corporativo
  Proyectos

★ Legacy
  Sistemas

★ Documentación
  Manuales
```

Luego:

```text
/Proyectos/API

📁 Backend
📁 Frontend
📄 README.md
📄 Manual.docx
```

Seleccionar:

```text
Manual.docx
```

abre:

```text
┌───────────────────────────────────────────┐
│ Manual.docx                               │
├───────────────────────────────────────────┤
│ Microsoft Word                            │
│ 4.2 MB                                    │
│ r1842                                     │
│                                           │
│ Última modificación                       │
│ Miguel · 04/09/2026                       │
│                                           │
│ Estado local                              │
│ ↓ No descargado                           │
│                                           │
│ [ Descargar ]                             │
└───────────────────────────────────────────┘
```

---

# 121. DESCARGAS

Crear administrador de descargas.

Ejemplo:

```text
Descargas

ProyectoA
███████████████░░░ 78%

Manual.docx
██████████████████ 100% ✓

Datos.xlsx
Pendiente
```

Permitir:

- cancelar;
- reintentar;
- abrir ubicación;
- mostrar detalles.

---

# 122. TAREAS

Crear un centro de operaciones:

```text
Actividad

✓ Checkout ProyectoA
✓ Update ProyectoB
⚠ Merge ProyectoC
✓ Commit ProyectoD
```

---

# 123. DISEÑO FINAL

La aplicación debe sentirse:

- moderna;
- profesional;
- rápida;
- visual;
- elegante;
- extremadamente orientada a archivos;
- amigable para desarrolladores;
- útil para documentos;
- centrada en SVN sin verse como software de control de versiones antiguo.

Evitar:

- formularios interminables;
- tablas administrativas innecesarias;
- botones gigantes;
- interfaces de "ERP";
- exceso de diálogos modales;
- UX heredada de TortoiseSVN.

---

# 124. PRINCIPIO DE DISEÑO

La aplicación debe ocultar la complejidad de SVN cuando no sea necesaria.

Ejemplo:

Usuario:

```text
Quiero actualizar mi proyecto.
```

Aplicación:

```text
[Actualizar]
```

Internamente:

```text
svn update
```

Pero cuando algo falla:

```text
SVN detectó un conflicto.

[Resolver conflictos]
```

y no:

```text
svn: E155015: ...
```

aunque los detalles técnicos deben seguir disponibles.

---

# 125. PRINCIPIO DE TRANSPARENCIA

Aunque la aplicación esconda la complejidad, nunca debe mentir.

Debe poder mostrar:

```text
Operación:
svn merge

Origen:
...

Destino:
...

Revisiones:
1820:1842
```

para usuarios avanzados.

---

# 126. DOCUMENTACIÓN

Crear documentación del proyecto:

```text
docs/
├── architecture.md
├── svn-integration.md
├── workspace.md
├── marketplace.md
├── editors.md
├── conflicts.md
├── security.md
├── testing.md
└── roadmap.md
```

---

# 127. ROADMAP

Dividir implementación en fases.

## Fase 1 — Fundación

```text
Tauri
Rust
Frontend
Workspace
Filesystem
svn detection
svn info
svn status
svn checkout
svn update
svn commit
```

## Fase 2 — Explorador

```text
File explorer
Favorites
Tabs
Views
Document opening
Editors
```

## Fase 3 — Marketplace

```text
Repositories
Repository browser
Remote metadata
Download
Checkout
Export
Local state detection
```

## Fase 4 — SVN avanzado

```text
Log
Diff
Blame
Revert
Cleanup
Properties
Locks
```

## Fase 5 — Branching

```text
Branch
Tag
Switch
Merge
Mergeinfo
Revision graph
```

## Fase 6 — Conflictos

```text
File conflicts
Tree conflicts
Property conflicts
3-way editor
Resolve
```

## Fase 7 — Document ecosystem

```text
Markdown
PDF
Office
Images
Code
External editors
Provider architecture
```

---

# 128. REGLA SOBRE EL PROYECTO DocuMalia

Antes de escribir componentes visuales nuevos, estudiar:

```text
C:\workspace_miguel\MaliAPI\DocuMalia
```

y determinar qué puede reutilizarse conceptualmente.

Especialmente:

```text
WindowManager
TabManager
DocumentManager
FileExplorer
Sidebar
Navigation
Panels
Modals
Theme
Claymorphism
State management
Persistence
```

Si el proyecto no está disponible en el entorno de desarrollo, NO inventar su estructura.

Solicitar que se proporcione el proyecto o los archivos relevantes.

---

# 129. REGLA DE IMPLEMENTACIÓN

No crear una enorme cantidad de código de una sola vez.

Trabajar incrementalmente.

Después de cada fase:

```text
cargo check
cargo test
npm test / equivalente
npm run build
tauri build
```

según las herramientas reales del proyecto.

Corregir errores antes de avanzar.

---

# 130. REGLA DE INVESTIGACIÓN

Cuando exista una duda sobre el comportamiento de Subversion:

1. consultar documentación oficial de Apache Subversion;
2. consultar documentación oficial de TortoiseSVN;
3. comprobar el comportamiento real mediante `svn.exe`;
4. crear un test reproducible;
5. implementar únicamente después de confirmar el comportamiento.

No asumir que Git y SVN funcionan igual.

---

# 131. REGLA SOBRE TortoiseSVN

TortoiseSVN debe considerarse una **referencia funcional**, no una dependencia.

La aplicación debe buscar cubrir las capacidades funcionales relevantes de TortoiseSVN utilizando Subversion directamente.

La tabla oficial de TortoiseSVN relaciona sus operaciones GUI con comandos SVN y debe utilizarse como matriz de cobertura.

---

# 132. DEFINICIÓN DE "TERMINADO"

No considerar terminado simplemente porque:

```text
svn checkout
svn update
svn commit
```

funcionen.

La aplicación solamente puede considerarse funcionalmente madura cuando exista cobertura significativa de:

```text
Filesystem
Documents
Tabs
Editors
Workspace
SVN status
Remote status
Repository browser
Marketplace
Checkout
Update
Commit
Diff
Log
Blame
Revert
Cleanup
Conflicts
Resolve
Merge
Branch
Tag
Switch
Locks
Properties
Externals
Changelists
Patch
Export
Import
Relocate
Revision graph
Authentication
Security
```

---

# 133. PRIMER OBJETIVO

NO intentes construir todo inmediatamente.

Primero:

1. Inspecciona DocuMalia.
2. Inspecciona el proyecto actual de esta aplicación si ya existe.
3. Analiza la arquitectura.
4. Propón la estructura de carpetas.
5. Propón los modelos.
6. Propón los comandos Tauri.
7. Propón el servicio SVN.
8. Propón el modelo de Workspace.
9. Propón el modelo de Repository/Working Copy.
10. Propón el sistema de pestañas/documentos.
11. Propón el Marketplace.
12. Propón la estrategia de editores.
13. Propón el sistema de estados SVN.
14. Propón las pruebas.
15. Después comienza la implementación.

No hagas cambios masivos sin entender primero la arquitectura existente.

---

# 134. ENTREGABLE INICIAL

Antes de escribir grandes cantidades de código, entrega:

```text
1. Arquitectura
2. Diagrama de componentes
3. Estructura de carpetas
4. Modelo de datos
5. API Rust → Frontend
6. SVN command matrix
7. Workspace design
8. Marketplace design
9. Document editor architecture
10. Conflict resolution architecture
11. Security model
12. Testing strategy
13. Roadmap
```

Después de eso comienza a implementar.

---

# 135. MATRIZ DE COBERTURA

Mantener permanentemente:

```text
docs/svn-feature-matrix.md
```

con:

| Función | TortoiseSVN | SVN CLI | Implementado | UI | Tests |
|---|---|---|---|---|---|
| Checkout | ✓ | ✓ | | | |
| Update | ✓ | ✓ | | | |
| Commit | ✓ | ✓ | | | |
| Status | ✓ | ✓ | | | |
| Diff | ✓ | ✓ | | | |
| Log | ✓ | ✓ | | | |
| Blame | ✓ | ✓ | | | |
| Merge | ✓ | ✓ | | | |
| Branch | ✓ | ✓ | | | |
| Tag | ✓ | ✓ | | | |
| Switch | ✓ | ✓ | | | |
| Conflict | ✓ | ✓ | | | |
| Resolve | ✓ | ✓ | | | |
| Lock | ✓ | ✓ | | | |
| Properties | ✓ | ✓ | | | |
| Externals | ✓ | ✓ | | | |
| Revision Graph | ✓ | — | | | |
| Repository Browser | ✓ | `svn list` | | | |
| Changelists | ✓ | ✓ | | | |
| Shelving | ✓/experimental | ✓/experimental | | | |

Completar esta matriz a medida que avance el desarrollo.

---

# 136. PRINCIPIO FINAL

Quiero construir:

> **un "Explorador de archivos + IDE + gestor documental + cliente SVN profesional", no simplemente otro clon de TortoiseSVN.**

El usuario debe poder instalar la aplicación, elegir:

```text
C:\SVN
```

y desde ese momento sentir que esa carpeta es su universo de trabajo.

Desde:

```text
Mis archivos
```

puede trabajar normalmente con sus documentos.

Desde:

```text
Marketplace
```

puede explorar repositorios remotos, consultar información, descargar proyectos/archivos/carpetas y ver inmediatamente cuáles de esos elementos ya existen localmente, cuáles están actualizados, cuáles están desactualizados y cuáles contienen cambios.

Y desde cualquier lugar debe poder llegar a:

```text
Update
Commit
Diff
History
Branch
Tag
Merge
Switch
Lock
Resolve
Revert
Properties
```

sin tener que abandonar la aplicación.

**No sacrificar la semántica real de Subversion por simplificar la interfaz.**

La interfaz debe ser sencilla.

El motor debe ser correcto.

---

# INSTRUCCIÓN FINAL PARA EL AGENTE

Comienza por analizar el proyecto existente y la referencia DocuMalia.

Después crea el diseño arquitectónico.

No comiences implementando el Marketplace antes de tener correctamente modeladas:

```text
Workspace
Repository
Repository URL
Working Copy
Revision
Local Path
Remote Path
SVN Status
Document
Editor
Tab
```

Una vez definidos esos modelos, implementa verticalmente:

```text
Workspace
    ↓
Working Copy detection
    ↓
svn status
    ↓
File Explorer
    ↓
Document opening
    ↓
Commit
    ↓
Repository Browser
    ↓
Marketplace
```

Cada etapa debe ser funcional y comprobable.

No dejar funcionalidades críticas como pseudocódigo.

No utilizar mocks permanentes donde pueda probarse contra un repositorio SVN real.

No afirmar que una característica funciona hasta haberla probado.

El objetivo final es que el usuario pueda dejar de utilizar TortoiseSVN para su flujo cotidiano y utilizar exclusivamente esta aplicación.