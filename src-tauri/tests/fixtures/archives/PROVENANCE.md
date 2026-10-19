# Fixtures de comprimidos

| Archivo | Procedencia | Licencia |
|---|---|---|
| `rar4.rar`, `rar5.rar`, `solid.rar`, `multifile.rar`, `empty_file.rar`, `with_comment.rar`, `password_aes.rar`, `header_encrypted.rar`, `subdata_size_underflow.rar`, `zero_fill_out_of_window.rar`, `algorithm_version_2.rar` | Copiados de `tests/fixtures` de `rars` 0.10.0 (verificados por su autor contra RAR 7.12 y UnRAR 7.20) y de `mathiasbynens/small` | Apache-2.0 (rars) y CC0 (small) |
| `simple.7z` | Generado con `sevenz-rust2` (`archive_support::sevenz`) para la E2E de comprimidos: `leeme.txt` y `docs/nota.txt` | Propio |
| `cifrado.zip`, `cifrado.7z` | Generados por el spike S3 de este proyecto (`spikes/archives`, contraseña `clave`, un archivo de texto) | Propios |

No hay codificador RAR libre: el resto de los archivos de prueba (zip, tar, 7z, bombas, zip-slip, enlaces, nombres reservados) se fabrican por código en cada prueba (`archive_support/mod.rs`). Los `.rar` «fabricados para ser rechazados» (`algorithm_version_2`, `subdata_size_underflow`, `zero_fill_out_of_window`) se dejan tal cual: la prueba espera un error tipado, no una extracción.
