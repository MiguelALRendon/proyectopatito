export function u32(value: number, bigEndian = false): Buffer {
  const out = Buffer.alloc(4);
  if (bigEndian) out.writeUInt32BE(value);
  else out.writeUInt32LE(value);
  return out;
}

export function storedZip(entries: [string, string][]): Buffer {
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04'),
      Buffer.from([20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      u32(data.length),
      u32(data.length),
      Buffer.from([nameBytes.length, 0, 0, 0]),
      nameBytes,
      data,
    ]);
    directory.push(
      Buffer.concat([
        Buffer.from('PK\x01\x02'),
        Buffer.from([20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        u32(data.length),
        u32(data.length),
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
