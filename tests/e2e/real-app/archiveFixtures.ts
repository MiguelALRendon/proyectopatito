import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, gzipSync } from 'node:zlib';
import { u32 } from './containerFixtures';

const REAL_ARCHIVES = resolve('src-tauri/tests/fixtures/archives');
const TAR_BLOCK = 512;
const TAR_NAME_BYTES = 100;
const TAR_MODE = '0000644\0';
const TAR_ZERO_FIELD = '0000000\0';
const TAR_SIZE_DIGITS = 11;
const TAR_CHECKSUM_OFFSET = 148;
const TAR_CHECKSUM_DIGITS = 6;
const TAR_OCTAL = 8;
const ZIP_VERSION = [20, 0];
const ZIP_UTF8_FIELDS = [0, 8, 0, 0, 0, 0, 0, 0];
const BIDI_OVERRIDE = String.fromCharCode(0x202e);

export type NamedBytes = [string, Buffer];

export const PLAIN_ENTRIES: NamedBytes[] = [
  ['leeme.txt', Buffer.from('Hola desde un comprimido')],
  ['docs/nota.txt', Buffer.from('Una nota dentro de una carpeta')],
];

export const HOSTILE_ENTRIES: NamedBytes[] = [
  ...PLAIN_ENTRIES,
  ['../escape.txt', Buffer.from('no debe salir de la carpeta')],
  ['CON.txt', Buffer.from('nombre reservado de Windows')],
];

export const MARKUP_NAME = '<img src=x onerror=alert(1)>.txt';
export const BIDI_NAME = `factura${BIDI_OVERRIDE}fdp.exe`;

export function zipBytes(entries: NamedBytes[]): Buffer {
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name);
    const checksum = u32(crc32(data));
    const sizes = [u32(data.length), u32(data.length)];
    const lengths = Buffer.from([nameBytes.length, 0, 0, 0]);
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04'),
      Buffer.from([...ZIP_VERSION, ...ZIP_UTF8_FIELDS]),
      checksum,
      ...sizes,
      lengths,
      nameBytes,
      data,
    ]);
    directory.push(
      Buffer.concat([
        Buffer.from('PK\x01\x02'),
        Buffer.from([...ZIP_VERSION, ...ZIP_VERSION, ...ZIP_UTF8_FIELDS]),
        checksum,
        ...sizes,
        Buffer.from([nameBytes.length, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        u32(offset),
        nameBytes,
      ]),
    );
    files.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.concat([
    Buffer.from('PK\x05\x06'),
    Buffer.from([0, 0, 0, 0, entries.length, 0, entries.length, 0]),
    u32(central.length),
    u32(offset),
    Buffer.from([0, 0]),
  ]);
  return Buffer.concat([...files, central, end]);
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(TAR_BLOCK);
  header.write(name.slice(0, TAR_NAME_BYTES), 0);
  header.write(TAR_MODE, 100);
  header.write(TAR_ZERO_FIELD, 108);
  header.write(TAR_ZERO_FIELD, 116);
  header.write(
    `${size.toString(TAR_OCTAL).padStart(TAR_SIZE_DIGITS, '0')}\0`,
    124,
  );
  header.write(`${TAR_ZERO_FIELD}0`, 136);
  header.write('        ', TAR_CHECKSUM_OFFSET);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const sum = header.reduce((total, byte) => total + byte, 0);
  const text = sum.toString(TAR_OCTAL).padStart(TAR_CHECKSUM_DIGITS, '0');
  header.write(`${text}\0 `, TAR_CHECKSUM_OFFSET);
  return header;
}

export function tarBytes(entries: NamedBytes[]): Buffer {
  const blocks = entries.flatMap(([name, data]) => {
    const padding = (TAR_BLOCK - (data.length % TAR_BLOCK)) % TAR_BLOCK;
    return [tarHeader(name, data.length), data, Buffer.alloc(padding)];
  });
  return Buffer.concat([...blocks, Buffer.alloc(TAR_BLOCK * 2)]);
}

export function tarGzBytes(entries: NamedBytes[]): Buffer {
  return gzipSync(tarBytes(entries));
}

export function truncatedZipBytes(): Buffer {
  const whole = zipBytes(PLAIN_ENTRIES);
  return whole.subarray(0, Math.floor(whole.length / 2));
}

export function copyRealArchive(name: string, folder: string): void {
  copyFileSync(join(REAL_ARCHIVES, name), join(folder, name));
}

export function writeArchives(folder: string): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'hostil.zip'), zipBytes(HOSTILE_ENTRIES));
  writeFileSync(join(folder, 'datos.tar'), tarBytes(PLAIN_ENTRIES));
  writeFileSync(join(folder, 'datos.tar.gz'), tarGzBytes(PLAIN_ENTRIES));
  writeFileSync(join(folder, 'roto.zip'), truncatedZipBytes());
  writeFileSync(
    join(folder, 'nombres.zip'),
    zipBytes([
      [MARKUP_NAME, Buffer.from('x')],
      [BIDI_NAME, Buffer.from('x')],
    ]),
  );
  for (const name of ['simple.7z', 'multifile.rar', 'cifrado.zip']) {
    copyRealArchive(name, folder);
  }
  copyRealArchive('bomba.tar.xz', folder);
}
