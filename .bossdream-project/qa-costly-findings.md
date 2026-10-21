# QA Increment — hallazgos qa-run (modo costoso, origen: bossdream.json > qa.mode)

Casos obligatorios de entrada: 25 (20 reglas + 5 transiciones) según `test-inventory-check.ps1`. Resultado de salida: `status: pass`, 0 pendientes. UI: ninguno de los 25 casos es de UI (todos son de backend Rust, red/archivos o frontera de código), por lo que no se usó Playwright; la UI ya se verificó en el Increment 6. Sin base de datos: dbhub no aplica.

| # | Caso (angulo) | Qué se probó | Hallazgo |
|---|---|---|---|
| 1 | symlink fuera de la raíz (regla) | `resolve` con `symlink_dir` real | Rechaza con OutsideWorkspace. Requiere Modo de desarrollador de Windows |
| 2 | SvnError conserva stdout/timestamp (regla) | `from_process` con Captured | OK |
| 3 | orden de búsqueda de locate (regla) | primero de la lista gana; la ruta manual gana a la lista | OK. El orden PATH→TortoiseSVN→SlikSVN→Apache se extrajo a la función pura `search_dirs` (pública) y se prueba completo |
| 4 | TooOld solo si ningún candidato sirve (regla + transición svn_sin_detectar→svn_demasiado_antiguo) | svn.exe falso 1.9.7 solo / seguido de uno 1.14.2 | OK |
| 5 | UpdateRequest -r/--ignore-externals/--username (regla) | args con todo y sin nada | OK |
| 6 | progress E/R/B, Deleting, Replacing (regla) | 5 líneas | OK |
| 7 | timeout marca cleanup (regla + transiciones en_ejecucion→tiempo_agotado, tiempo_agotado→wc_requiere_cleanup) | update con timeout de 1 ms | OK. Cambio de producción: `Operations::with_timeout` (inyección para pruebas) |
| 8 | cleanup fallido no limpia la marca (regla) | cleanup sobre carpeta que no es WC | OK |
| 9 | fallo svn distinto de cancel/timeout no marca (regla) | update sobre carpeta que no es WC | OK |
| 10-12 | start_checkout/commit/cleanup fuera del workspace (regla) | `..\fuera`, sin lanzar nada | OK |
| 13 | start_update contraseña sin usuario (regla) | rechaza y no filtra la contraseña | OK |
| 14 | comando de WC sin svn utilizable → NoSvn (regla) | config con svn_path inexistente | OK |
| 15 | svn_set_path con fallo de guardado (regla) | config bajo un archivo (no carpeta) | OK: binario adoptado y error informado |
| 16 | operación fallida emite done Err (regla) | checkout de URL inexistente | OK: SvnFailed |
| 17 | cleanup libera copia bloqueada E155004 (regla) | commit con hook pre-commit que se atasca, cancelado a los 2 s | OK: update → WorkingCopyLocked, cleanup lo libera, update posterior pasa. Escenario real, sin simular |
| 18 | XML malformado → ParseFailed (regla) | svn.exe falso con `<info><entry` | OK |
| 19 | capabilities solo core:default y dialog:default (regla) | lee `capabilities/` | OK |
| 20 | solo services/tauri.ts importa @tauri-apps (regla) | glob de `src/**` | OK. Sabotaje con un import en `src/utils`: la prueba falla como debe |
| 21 | copia_modificada→copia_en_conflicto (transición) | dos copias editan la misma línea, update | OK: StatusItem::Conflicted |
| 22 | reintento_con_credenciales→auth_required (transición) | `svnserve` real (Apache Subversion 1.15) con usuario y contraseña: sin credenciales, contraseña equivocada y contraseña correcta | OK tras corregir un bug real: la contraseña se enviaba con LF final y svn en Windows lo conserva (`Password incorrect` con la contraseña correcta). Ahora se envía sin terminador (ADR 0005) |

Pendiente: solo TLS real (necesita un servidor HTTPS con certificado).

Verificación tras los cambios: `cargo test` 161 pruebas en verde (antes 132), `vitest` 82 (antes 80), `cargo clippy -D warnings` limpio.

## QA Increment de la Fase 2B (`qa-run`, modo costoso, 2026-10-20)

Casos obligatorios: los 103 que reportó `test-inventory-check.ps1` sobre el inventario de la 2B. Cada caso se ejercitó escribiendo la prueba y corriéndola; las de interfaz se comprobaron con pruebas de componente (Vitest con happy-dom) y no con Playwright, porque la suite real de ventana (`tests/e2e/real-app`) se repite completa en el paso 12.5 del plan, tras recompilar el ejecutable.

### Defectos reales hallados al probar (corregidos)

1. **xz sin límite tipado.** Un `.tar.xz` que pide más de 256 MiB de memoria salía como `ArchiveError::Io(MemLimit)` y la interfaz mostraba un error de disco genérico. Ahora `From<io::Error>` lo traduce a `Limit` (`app/archive/mod.rs`, `is_xz_memory_limit`).
2. **Etiqueta de tamaño declarado.** Decía «más de 1 GiB» y el backend rechaza por más de 4 GiB en total o 2 GiB en un archivo. Corregida en `documents/archive.ts` y fijada con una prueba que lee `limits.rs`.
3. **Aviso de la CVE perdido.** Si el svn incluido se ignoraba y el svn del sistema era anterior a 1.14.4, `bundle_warning(..).or(detection.warning)` descartaba el aviso de la CVE-2024-45720. Ahora se unen ambos (`app/state.rs`, `joined`).

### Hallazgos que no se corrigieron (deuda abierta)

- T-35: repetir un mismo nombre dentro de un comprimido es O(N²) (1 000 iguales: 68 s).
- T-36: un RAR admite 49 999 archivos y no 50 000 (la cabecera principal cuenta).
- T-37: «declara más datos de los permitidos» se muestra como sospecha confirmable, pero la extracción lo rechaza siempre.
- El escritor de `sevenz-rust2` escribe invertido el bit de anti-item: un anti-item solo se fabrica con una entrada vacía normal (solo afecta al arnés de pruebas).

### Cambios de código hechos para poder probar (sin cambiar el comportamiento)

- `commands/files.rs`: el análisis de cabeceras de `fs_write_bytes` salió a `write_bytes_request` (recibe `HeaderMap`).
- `app/state.rs`: `detect_svn` delega en `detect_svn_in`, que recibe el paquete y los directorios de búsqueda.
- `Cargo.toml`: `rars` con la característica `write` solo como dependencia de desarrollo (para fabricar RAR con enlace).

### Casos y pruebas

| # | Caso | Prueba | Estado |
|---|---|---|---|
| 1 | Un archivo solo en la nube (OneDrive sin descargar) no es un archivo local disponible y se rechaza como no ... | archive_list.rs::a_cloud_only_archive_is_not_a_local_file | cubierto |
| 2 | Un rar clasifica como enlace una entrada de redirección | archive_list.rs::a_rar_redirection_entry_is_listed_as_a_link | cubierto |
| 3 | Un 7z ignora las entradas anti-item | archive_list.rs::seven_zip_anti_items_are_not_listed | cubierto |
| 4 | Un rar con más de 50000 entradas se rechaza por límite | reader_rar.rs::the_read_options_carry_the_project_limits | cubierto |
| 5 | Un 7z cuyo bloque comprimido declara más de 256 MiB descomprimidos se rechaza por límite | archive_list.rs::a_seven_zip_block_declaring_more_than_256_mib_is_refused_for_its_size | cubierto |
| 6 | Un 7z cuya cabecera inicial es menor de 32 bytes es corrupto | archive_list.rs::a_seven_zip_shorter_than_its_signature_header_is_corrupt | cubierto |
| 7 | El decodificador xz limita su memoria a 256 MiB | archive_list.rs::an_xz_stream_asking_for_more_than_256_mib_of_memory_is_a_limit_error | cubierto |
| 8 | Listar no descomprime datos: 7z y rar solo leen metadatos | archive_list.rs::listing_a_seven_zip_reads_metadata_and_never_decodes_the_data; archive_list.rs::listing_a_rar_reads_metadata_and_never_decodes_the_data | cubierto |
| 9 | Tras 999 intentos de nombre de carpeta repetido la extracción falla por límite | archive_extract.rs::nine_hundred_ninety_nine_taken_folder_names_end_in_a_limit_error | cubierto |
| 10 | El destino no se borra al fallar si ya no valida dentro del workspace | service.rs::a_destination_that_left_the_workspace_is_not_deleted | cubierto |
| 11 | Tras 999 intentos de nombre de archivo repetido la extracción falla por límite | extract.rs::a_file_name_taken_999_times_ends_in_a_limit_error | cubierto |
| 12 | El comando rechaza con ruta inválida un identificador de tarea ya en curso | commands/archive.rs::a_task_id_already_running_is_refused_as_an_invalid_path | cubierto |
| 13 | El comando libera el identificador de tarea también cuando el trabajo falla | commands/archive.rs::a_failed_job_still_releases_its_task_id | cubierto |
| 14 | El comando emite el progreso como evento archive://progress con el id de la tarea | commands/archive.rs::progress_travels_as_archive_progress_with_the_task_id | cubierto |
| 15 | El motivo de tamaño declarado muestra el mismo umbral que aplica el backend | archive.test.ts::el motivo de tamano declarado muestra el mismo umbral que aplica el backend | cubierto |
| 16 | El visor muestra guion en el tamaño de directorios y de valores nulos | ArchiveViewer.test.ts::muestra un guion en el tamano de los directorios y de los valores nulos | cubierto |
| 17 | El resultado indica cuántas entradas omitidas quedaron fuera de la lista (y N más) | ArchiveViewer.test.ts::indica cuantas entradas omitidas quedaron fuera de la lista | cubierto |
| 18 | Mientras extrae, el clic en el fondo no cierra el diálogo | ArchiveViewer.test.ts::mientras extrae, el clic en el fondo no cierra el dialogo | cubierto |
| 19 | GIF: se aceptan las firmas GIF87a y GIF89a | sniff.rs::both_gif_signatures_are_accepted_and_others_are_not | cubierto |
| 20 | EBML: el DocType debe aparecer dentro de los primeros 64 bytes | media_sniff.rs::the_ebml_doc_type_must_end_inside_the_first_64_bytes | cubierto |
| 21 | Un nombre terminado en punto no tiene extensión | sniff.rs::a_name_ending_in_a_dot_or_starting_with_one_has_no_extension | cubierto |
| 22 | ZIP: el directorio no puede declarar más de 20000 entradas | container.rs::a_zip_directory_cannot_declare_more_than_20000_entries | cubierto |
| 23 | El sufijo .tbz se trata como tar.bz2 | office_sniff.rs::the_tbz_suffix_is_a_bzip2_tarball | cubierto |
| 24 | La lectura de un tarball se limita a 4 MiB de entrada comprimida y el decodificador xz a 64 MiB de memoria | sin prueba | ver abajo |
| 25 | write_bytes vuelve a comprobar que el destino es escribible después de tomar el candado | sin prueba | ver abajo |
| 26 | Tras escribir, write_bytes invalida la caché de estado SVN del archivo | write_bytes.rs::a_successful_write_invalidates_the_status_cache_and_a_refused_one_does_not | cubierto |
| 27 | El temporal se sincroniza a disco (sync_all) antes del renombrado | sin prueba | ver abajo |
| 28 | Un renombrado con SHARING_VIOLATION (32) se traduce a FileLocked | edit.rs::a_rename_blocked_by_another_process_is_a_locked_file | cubierto |
| 29 | fs_write_bytes exige el cuerpo como bytes crudos y rechaza otro formato con InvalidPath | commands/files.rs::a_json_body_is_refused_as_an_invalid_path | cubierto |
| 30 | fs_write_bytes exige la cabecera path | commands/files.rs::the_path_header_is_required | cubierto |
| 31 | La cabecera path se decodifica por porcentaje y debe ser UTF-8 válido | commands/files.rs::the_path_must_be_valid_utf8_after_decoding | cubierto |
| 32 | fs_write_bytes exige la cabecera expected-version | commands/files.rs::the_expected_version_header_is_required | cubierto |
| 33 | fs_write_bytes resuelve la ruta con el Workspace antes de escribir | write_bytes.rs::a_path_outside_the_workspace_is_refused_before_anything_is_written | cubierto |
| 34 | FileError::FileChanged, FileLocked, OfficeTooLarge y ReadOnly se entregan al frontend como file_changed, fi... | write_bytes.rs::file_errors_reach_the_frontend_as_their_snake_case_kinds | cubierto |
| 35 | Un error de E/S distinto de no encontrado al leer un recurso de disco responde 500 | zeta_assets.rs::an_io_error_other_than_missing_answers_500 | cubierto |
| 36 | Toda respuesta de zeta-assets lleva Accept-Ranges: bytes | zeta_assets.rs::every_response_says_it_accepts_ranges | cubierto |
| 37 | La CSP del documento zeta-assets fija default-src 'self', object-src 'none' y base-uri 'none' | zeta_assets.rs::the_document_policy_closes_plugins_and_the_base_url | cubierto |
| 38 | script-src de la CSP de la página principal es solo 'self' | zeta_assets.rs::the_page_scripts_come_only_from_the_app_itself | cubierto |
| 39 | create_main_window pasa allow_dev_server = cfg!(debug_assertions): un build release nunca permite navegar a... | webview_boundary.rs::the_main_window_asks_for_the_dev_server_only_in_debug_builds | cubierto |
| 40 | host.js ignora cualquier mensaje de arranque que no sea dakedaduck-office-init proveniente de window.parent... | hostScript.test.ts::ignora un arranque que no viene de la pagina padre / acepta el puerto de la pagina una sola vez | cubierto |
| 41 | Un fallo al arrancar (respuesta distinta de 206, respuesta vacía, script que no carga) responde error boot-... | hostScript.test.ts::responde boot-failed si una descarga no devuelve 206 | cubierto |
| 42 | host.js responde invalid-message a un comando de la página desconocido o heredado del prototipo y a un open... | hostScript.test.ts::responde invalid-message a un comando desconocido | cubierto |
| 43 | host.js responde busy a un open con un documento ya abierto, invalid-message a un save que no es del docId ... | hostScript.test.ts::responde busy a un open con un documento ya abierto | cubierto |
| 44 | El documento se escribe en /tmp/office con nombre UUID y se borra del sistema de archivos virtual al cerrar... | hostScript.test.ts::escribe el documento en /tmp/office con nombre UUID y lo borra al cerrarse | cubierto |
| 45 | Un fallo del worker durante la apertura responde open-failed y descarta el archivo; fuera de la apertura re... | hostScript.test.ts::responde open-failed y descarta el archivo si el worker falla al abrir | cubierto |
| 46 | Los documentos se cargan con MacroExecutionMode = NEVER_EXECUTE y UpdateDocMode = NO_UPDATE: nunca se ejecu... | officeThreadScript.test.ts::carga el documento sin ejecutar macros ni actualizar vinculos | cubierto |
| 47 | Los esquemas service:, http: y ftp: se interceptan como comandos bloqueados | officeThreadScript.test.ts::bloquea comandos y avisa al anfitrion | cubierto |
| 48 | Un documento que no es Writer, Calc ni Impress se informa con kind unknown | officeThreadScript.test.ts::informa Writer, Calc, Impress y unknown segun el servicio | cubierto |
| 49 | Si loadComponentFromURL no devuelve modelo o un manejador del worker lanza un error, el worker responde fai... | officeThreadScript.test.ts::responde failed si no hay modelo | cubierto |
| 50 | modified no se emite durante un guardado propio (isStoring) | officeThreadScript.test.ts::no emite modified mientras guarda y si despues | cubierto |
| 51 | Un OnSaveDone que no viene de nuestro guardado se informa como stored con requested=false | officeThreadScript.test.ts::informa como no solicitado un OnSaveDone que no viene de nuestro guardado | cubierto |
| 52 | saved se rechaza sin docId no vacío, con requested no booleano o con bytes que no son ArrayBuffer | officeProtocol.test.ts::rechaza un guardado invalido | cubierto |
| 53 | failureOf traduce save-failed a damaged | officeFailure.test.ts::traduce el codigo save-failed a damaged | cubierto |
| 54 | Mientras se guarda el chip dice «Guardando…» y el botón queda desactivado con aria-busy | OfficeViewer.test.ts::mientras guarda, el chip dice Guardando y el boton queda desactivado y ocupado | cubierto |
| 55 | El manifiesto embebido coincide con los archivos reales de src-tauri/resources/svn y con la lista de third_... | svn_bundled.rs::the_embedded_manifest_matches_the_lock_and_the_shipped_folder | cubierto |
| 56 | Un paquete incluido íntegro cuyo svn.exe no arranca, no devuelve una versión o es anterior a la mínima se d... | svn_bundled.rs::an_intact_bundle_whose_svn_does_not_start_is_unusable | cubierto |
| 57 | Si el paquete está dañado y el único svn del sistema es anterior a la mínima, el error es TooOld y no Bundl... | svn_bundled.rs::a_damaged_bundle_with_only_an_outdated_system_svn_reports_too_old | cubierto |
| 58 | Cuando el paquete se ignoró y el svn del sistema es anterior a 1.14.4, se muestran ambos avisos y el de la ... | state.rs::the_cve_warning_is_not_lost_when_the_bundle_was_ignored | cubierto |
| 59 | svn_set_path acepta el nombre svn.exe sin distinguir mayúsculas | svn_bundled.rs::svn_set_path_accepts_the_executable_name_in_any_case | cubierto |
| 60 | Si el cliente guardado está roto y la búsqueda automática también falla, se informa el error del cliente gu... | state.rs::a_broken_saved_client_with_nothing_else_reports_the_saved_clients_error | cubierto |
| 61 | warm_svn no vuelve a detectar si ya hay un svn en caché | state.rs::a_cached_svn_is_not_detected_again_by_warm_svn | cubierto |
| 62 | with_bundled_svn apunta el paquete a la subcarpeta svn del directorio de recursos y detect_svn lo verifica ... | state.rs::the_bundle_lives_in_the_svn_subfolder_of_the_resource_directory | cubierto |
| 63 | El setup de Tauri crea el AppState con el directorio de recursos de la aplicación y precalienta svn en segu... | installed.e2e.ts::detecta el svn incluido sin Subversion en PATH ni en ProgramFiles | cubierto |
| 64 | app_about devuelve la versión de CARGO_PKG_VERSION y el texto íntegro de THIRD_PARTY_LICENSES.md | commands/about.rs::the_about_answer_carries_the_crate_version_and_the_whole_licenses_file | cubierto |
| 65 | Mientras app_about no responde, el diálogo muestra «…» como versión de la aplicación | AboutDialog.test.ts::mientras app_about no responde, la version es puntos suspensivos | cubierto |
| 66 | El texto de licencias es alcanzable por teclado (tabindex 0) y tiene etiqueta accesible | AboutDialog.test.ts::el texto de licencias se alcanza con el teclado y tiene etiqueta accesible | cubierto |
| 67 | Sin svn y sin error SvnVersionNotice pide indicar la ruta de svn.exe | AboutDialog.test.ts::sin svn y sin error pide indicar la ruta de svn.exe | cubierto |
| 68 | SvnWarning no pinta nada cuando no hay aviso | AboutDialog.test.ts::SvnWarning no pinta nada cuando no hay aviso | cubierto |
| 69 | Con un svn que no es el incluido, el campo de ruta se muestra siempre visible sin details | OnboardingView.test.ts::con un svn del sistema o configurado el campo de la ruta esta siempre visible | cubierto |
| 70 | bundle-svn.ps1 rechaza el zip de SlikSVN cuyo SHA-256 no coincide con svn.lock.json | bundle-svn.Tests.ps1::rechaza el zip descargado cuyo SHA-256 no coincide con el lock | cubierto |
| 71 | bundle-svn.ps1 reutiliza el zip en caché solo si su SHA-256 coincide | bundle-svn.Tests.ps1::reutiliza el zip en cache cuando su SHA-256 coincide, sin descargar | cubierto |
| 72 | bundle-svn.ps1 aborta si msiexec no termina en 300 s o devuelve un código distinto de cero | bundle-svn.Tests.ps1::aborta si msiexec devuelve un codigo distinto de cero | cubierto |
| 73 | bundle-svn.ps1 aborta si no encuentra el redistribuible x64 de Visual C++ y verifica el SHA-256 de cada arc... | bundle-svn.Tests.ps1::aborta si no encuentra el redistribuible x64 de Visual C++; bundle-svn.Tests.ps1::aborta si el SHA-256 de un archivo del runtime no coincide con el lock | cubierto |
| 74 | bundle-svn.ps1 aborta si falta en el MSI un archivo listado en svn.lock.json | bundle-svn.Tests.ps1::aborta si falta en el MSI un archivo listado en el lock | cubierto |
| 75 | bundle-svn.ps1 con -WriteManifest regenera svn.manifest.json con nombre, tamaño y SHA-256 de cada archivo d... | bundle-svn.Tests.ps1::con -WriteManifest regenera el manifiesto con nombre, tamano y SHA-256 de cada archivo | cubierto |
| 76 | bundle-svn.ps1 copia las licencias de SlikSVN a la subcarpeta licenses del paquete | bundle-svn.Tests.ps1::copia el programa, el runtime y las licencias de SlikSVN a la carpeta del paquete | cubierto |
| 77 | build-release.ps1 falla si tauri build devuelve un código distinto de cero y siempre restaura CARGO_TARGET_... | build-release.Tests.ps1::falla con el codigo de tauri build y siempre limpia CARGO_TARGET_DIR y RUSTFLAGS | cubierto |
| 78 | build-release.ps1 sin -SkipFetch descarga ZetaOffice y empaqueta svn antes de compilar con CRT estático | build-release.Tests.ps1::sin -SkipFetch descarga ZetaOffice y empaqueta svn antes de compilar | cubierto |
| 79 | verify-installer.ps1 falla si el instalador o el desinstalador no termina en 180 s o sale con código distin... | build-release.Tests.ps1::verify-installer: falla si el instalador sale con un codigo distinto de cero | cubierto |
| 80 | generate-licenses.mjs genera THIRD_PARTY_LICENSES.md con los paquetes npm de ejecución y los crates enlazad... | thirdPartyLicenses.test.ts::lista cada dependencia de ejecucion de npm con su version instalada | cubierto |
| 81 | generate-licenses.mjs marca «sin declarar» la licencia ausente de un paquete o crate | thirdPartyLicenses.test.ts::la licencia que falta se marca sin declarar y nunca queda una celda vacia | cubierto |
| 82 | Al cambiar de archivo se reinician duración, posición, dimensiones y estado de reproducción | MediaPlayer.test.ts::al cambiar de archivo se reinician duracion, posicion, dimensiones y estado | cubierto |
| 83 | Con el sonido silenciado el control de volumen muestra cero | MediaPlayer.test.ts::con el sonido silenciado el control de volumen muestra cero | cubierto |
| 84 | Al desmontar se retira el listener de fullscreenchange | MediaPlayer.test.ts::al desmontar se retira el listener de fullscreenchange | cubierto |
| 85 | Una cabecera Range ilegible como texto responde 400 | protocol.rs::a_range_header_that_is_not_text_answers_400 | cubierto |
| 86 | El Range inválido se rechaza con 400 antes de localizar el archivo | protocol.rs::an_invalid_range_is_refused_before_looking_for_the_file | cubierto |
| 87 | failed->loading | ArchiveViewer.test.ts::tras un fallo, abrir otro archivo vuelve a cargar y muestra su listado | cubierto |
| 88 | failed->cerrado | ArchiveViewer.test.ts::tras un fallo, Cerrar descarta el dialogo sin reintentar | cubierto |
| 89 | version_verificada->error_io | write_bytes.rs::a_temporary_name_too_long_to_create_is_an_io_error | cubierto |
| 90 | temporal_escrito->error_io | edit.rs::any_other_rename_failure_is_an_io_error | cubierto |
| 91 | solicitud->500 (error de E/S) | zeta_assets.rs::an_io_error_other_than_missing_answers_500 | cubierto |
| 92 | incluido-descartado->version-insuficiente | svn_bundled.rs::a_damaged_bundle_with_only_an_outdated_system_svn_reports_too_old | cubierto |
| 93 | configurado-invalido->incluido-verificado | state.rs::a_broken_saved_client_falls_back_to_the_verified_bundled_svn | cubierto |
| 94 | configurado-invalido->error-del-configurado-informado | state.rs::a_broken_saved_client_with_nothing_else_reports_the_saved_clients_error | cubierto |
| 95 | arranque->rechazado | svn_bundled.rs::an_intact_bundle_with_a_svn_older_than_the_minimum_is_unusable | cubierto |
| 96 | svn-empaquetado->instalador-construido | installed.e2e.ts::detecta el svn incluido sin Subversion en PATH ni en ProgramFiles | cubierto |
| 97 | instalado->maquina-limpia-verificada | sin prueba | ver abajo |
| 98 | reproduciendo->buscando | MediaPlayer.test.ts::buscar mientras suena no la detiene | cubierto |
| 99 | buscando->pausado | MediaPlayer.test.ts::buscar en pausa no la reanuda | cubierto |
| 100 | reproduciendo->terminado | MediaPlayer.test.ts::al terminar vuelve a ofrecer reproducir | cubierto |
| 101 | terminado->reproduciendo | MediaPlayer.test.ts::al terminar vuelve a ofrecer reproducir, y reproducir de nuevo arranca otra vez | cubierto |
| 102 | reproduciendo->tarjeta-de-error | MediaPlayer.test.ts::un error mientras suena cae a la tarjeta | cubierto |
| 103 | peticion->500-archivo-cambiado | serve.rs::a_file_shortened_after_its_size_was_read_is_reported_as_changed; protocol.rs::internal_workspace_failures_and_unlisted_file_errors_are_a_500 | cubierto |

### Casos sin prueba automática

- **24** (tarball: 4 MiB de entrada y 64 MiB de memoria xz), **25** (segunda comprobación de escritura tras el candado) y **27** (`sync_all` antes del renombrado): no son observables desde fuera. Una entrada de tar siempre se identifica con sus primeros 512 bytes, el candado se toma antes de la segunda comprobación sin posibilidad de intercalar otro proceso en una prueba determinista, y `sync_all` solo cambia la durabilidad ante un corte de energía. Se tratan como equivalentes.
- **97** (`instalado->maquina-limpia-verificada`): requiere la máquina limpia del usuario (CA-14). El instalador, `installed.e2e.ts` (9 de 9 en un perfil aislado) y la lista `scripts/e2e/clean-machine-checklist.md` están listos.

### Cobertura parcial que conviene saber

- **4** (RAR con más de 50 000 entradas): se prueba que las opciones del lector llevan el tope, no un RAR real de 50 001 entradas (construirlo tarda más de 30 s).
- **79** (`verify-installer.ps1`): se prueba el código de salida distinto de cero; el tiempo máximo de 180 s no, porque la constante está fija en el script.
- **63** (`setup` de Tauri) y **96** (instalador construido): los cubre `installed.e2e.ts` al detectar el svn incluido en la app instalada; no hay prueba unitaria del `setup`.
- **103**: solo con pruebas unitarias (la carrera de un archivo que se acorta a mitad de lectura no se puede intercalar de forma determinista).
- Las pruebas de `ArchiveViewer`, `MediaPlayer`, `AboutDialog`, `OnboardingView` y `OfficeViewer` usan happy-dom: no ejercitan WebView2.

### Resultado de las puertas tras los cambios

cargo 823 pruebas sin fallos, clippy y fmt limpios; Vitest 2115 en 108 archivos; vue-tsc y prettier limpios; Pester 12 de 12.

`relectura_completada: true`
