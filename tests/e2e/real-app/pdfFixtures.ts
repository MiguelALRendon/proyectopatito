import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_WIDTH = 300;
const PAGE_HEIGHT = 200;
const FIRST_EXTRA_OBJECT = 5;
const IMAGE_SIDE = 8;
const IMAGE_PLACEMENT = 'q 200 0 0 120 50 40 cm /Im1 Do Q';
const IMAGE_DICTIONARY = `/Type /XObject /Subtype /Image /Width ${IMAGE_SIDE} /Height ${IMAGE_SIDE} /ColorSpace /DeviceGray`;
const STANDARD_FONT_DIR = join('node_modules', 'pdfjs-dist', 'standard_fonts');
const EMBEDDED_FONT_FILE = 'LiberationSans-Regular.ttf';

const JPX_MARKER = {
  start: 0xff4f,
  size: 0xff51,
  codingStyle: 0xff52,
  quantization: 0xff5c,
  tile: 0xff90,
  data: 0xff93,
  end: 0xffd9,
};
const JPEG_MARKER = {
  start: 0xffd8,
  quantization: 0xffdb,
  baseline: 0xffc0,
  huffman: 0xffc4,
  scan: 0xffda,
  end: 0xffd9,
};
const JBIG2_SEGMENT = { pageInfo: 0x30, immediateGenericRegion: 0x26 };

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function bytes(...values: number[]): Buffer {
  return Buffer.from(values);
}

function markerSegment(marker: number, body: Buffer): Buffer {
  return Buffer.concat([u16(marker), u16(body.length + 2), body]);
}

function pdfPageObjects(pages: number): string[] {
  const fontObject = 3 + 2 * pages;
  return Array.from({ length: pages }, (_page, index) => {
    const number = index + 1;
    const stream = `BT /F1 24 Tf 20 100 Td (Pagina ${number} de ${pages}) Tj ET`;
    return [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${4 + 2 * index} 0 R /Resources << /Font << /F1 ${fontObject} 0 R >> >> >>`,
      `<< /Length ${stream.length} >>
stream
${stream}
endstream`,
    ];
  }).flat();
}

function pdfTrailer(offsets: number[], xrefAt: number): string {
  const size = offsets.length + 1;
  const entries = offsets.map(
    (offset) => `${String(offset).padStart(10, '0')} 00000 n
`,
  );
  return `xref
0 ${size}
0000000000 65535 f
${entries.join('')}trailer
<< /Size ${size} /Root 1 0 R >>
startxref
${xrefAt}
%%EOF
`;
}

function assemblePdf(bodies: string[]): Buffer {
  let document = '%PDF-1.4\n';
  const offsets = bodies.map((body, index) => {
    const offset = document.length;
    document += `${index + 1} 0 obj
${body}
endobj
`;
    return offset;
  });
  return Buffer.from(document + pdfTrailer(offsets, document.length), 'latin1');
}

function streamObject(dictionary: string, data: Buffer | string): string {
  const content = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
  return `<< ${dictionary} /Length ${content.length} >>
stream
${content.toString('latin1')}
endstream`;
}

function onePagePdf(
  resources: string,
  content: string,
  extras: string[],
): Buffer {
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents 4 0 R /Resources ${resources} >>`,
    streamObject('', content),
    ...extras,
  ]);
}

export function paddedPdf(pages: number, paddingBytes: number): Buffer {
  const kids = Array.from({ length: pages }, (_page, i) => `${3 + 2 * i} 0 R`);
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`,
    ...pdfPageObjects(pages),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${paddingBytes} >>
stream
${' '.repeat(paddingBytes)}
endstream`,
  ]);
}

export function cmykPdf(): Buffer {
  return onePagePdf('<< >>', '0 1 1 0 k 40 40 220 120 re f', []);
}

function cjkFonts(): string[] {
  const descriptor = `${FIRST_EXTRA_OBJECT + 4} 0 R`;
  const cidFont = (name: string) =>
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor ${descriptor} /DW 1000 >>`;
  const composite = (encoding: string, descendant: number) =>
    `<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /${encoding} /DescendantFonts [${descendant} 0 R] >>`;
  return [
    composite('90ms-RKSJ-H', FIRST_EXTRA_OBJECT + 1),
    cidFont('HeiseiMin-W3'),
    composite('UniJIS-UCS2-H', FIRST_EXTRA_OBJECT + 3),
    cidFont('HeiseiMin-W3'),
    '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 6 /FontBBox [-123 -257 1001 910] /ItalicAngle 0 /Ascent 723 /Descent -241 /CapHeight 709 /StemV 69 >>',
  ];
}

export function cjkPdf(): Buffer {
  const content = [
    'BT /F1 48 Tf 20 120 Td <82A082A282A482A682A8> Tj ET',
    'BT /F2 48 Tf 20 50 Td <3042304430463048304A> Tj ET',
  ].join('\n');
  return onePagePdf(
    `<< /Font << /F1 ${FIRST_EXTRA_OBJECT} 0 R /F2 ${FIRST_EXTRA_OBJECT + 2} 0 R >> >>`,
    content,
    cjkFonts(),
  );
}

export function standardFontsPdf(): Buffer {
  const names = [
    'Helvetica-Bold',
    'Times-Italic',
    'Courier-Bold',
    'Symbol',
    'ZapfDingbats',
  ];
  const fonts = names.map(
    (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`,
  );
  const entries = names.map(
    (_name, index) => `/F${index + 1} ${FIRST_EXTRA_OBJECT + index} 0 R`,
  );
  const lines = names.map(
    (name, index) =>
      `BT /F${index + 1} 20 Tf 20 ${174 - 40 * index} Td (${name} abc) Tj ET`,
  );
  return onePagePdf(
    `<< /Font << ${entries.join(' ')} >> >>`,
    lines.join('\n'),
    fonts,
  );
}

export function embeddedFontPdf(): Buffer {
  const font = readFileSync(join(STANDARD_FONT_DIR, EMBEDDED_FONT_FILE));
  const descriptor = `${FIRST_EXTRA_OBJECT + 1} 0 R`;
  return onePagePdf(
    `<< /Font << /F1 ${FIRST_EXTRA_OBJECT} 0 R >> >>`,
    'BT /F1 32 Tf 20 100 Td (Fuente incrustada) Tj ET',
    [
      `<< /Type /Font /Subtype /TrueType /BaseFont /LiberationSans /Encoding /WinAnsiEncoding /FontDescriptor ${descriptor} >>`,
      `<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-200 -300 1200 1000] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 ${FIRST_EXTRA_OBJECT + 2} 0 R >>`,
      streamObject(`/Length1 ${font.length}`, font),
    ],
  );
}

function imagePdf(filterDictionary: string, data: Buffer): Buffer {
  return onePagePdf(
    `<< /XObject << /Im1 ${FIRST_EXTRA_OBJECT} 0 R >> >>`,
    IMAGE_PLACEMENT,
    [streamObject(`${IMAGE_DICTIONARY} ${filterDictionary}`, data)],
  );
}

export function jpxCodestream(): Buffer {
  const size = Buffer.concat([
    u16(0),
    u32(IMAGE_SIDE),
    u32(IMAGE_SIDE),
    u32(0),
    u32(0),
    u32(IMAGE_SIDE),
    u32(IMAGE_SIDE),
    u32(0),
    u32(0),
    u16(1),
    bytes(7, 1, 1),
  ]);
  const codingStyle = Buffer.concat([
    bytes(0, 0),
    u16(1),
    bytes(0, 0, 2, 2, 0, 1),
  ]);
  const emptyPacket = bytes(0);
  const tileHeaderBytes = 2 + 2 + 8 + 2;
  const tile = Buffer.concat([
    u16(0),
    u32(tileHeaderBytes + emptyPacket.length),
    bytes(0, 1),
  ]);
  return Buffer.concat([
    u16(JPX_MARKER.start),
    markerSegment(JPX_MARKER.size, size),
    markerSegment(JPX_MARKER.codingStyle, codingStyle),
    markerSegment(JPX_MARKER.quantization, bytes(0x40, 0x40)),
    markerSegment(JPX_MARKER.tile, tile),
    u16(JPX_MARKER.data),
    emptyPacket,
    u16(JPX_MARKER.end),
  ]);
}

export function jpxPdf(): Buffer {
  return imagePdf('/BitsPerComponent 8 /Filter /JPXDecode', jpxCodestream());
}

export function jpegBytes(): Buffer {
  const singleCodeTable = (kind: number) =>
    markerSegment(
      JPEG_MARKER.huffman,
      Buffer.concat([bytes(kind, 1), Buffer.alloc(15), bytes(0)]),
    );
  return Buffer.concat([
    u16(JPEG_MARKER.start),
    markerSegment(
      JPEG_MARKER.quantization,
      Buffer.concat([bytes(0), Buffer.alloc(64, 1)]),
    ),
    markerSegment(
      JPEG_MARKER.baseline,
      Buffer.concat([
        bytes(8),
        u16(IMAGE_SIDE),
        u16(IMAGE_SIDE),
        bytes(1, 1, 0x11, 0),
      ]),
    ),
    singleCodeTable(0x00),
    singleCodeTable(0x10),
    markerSegment(JPEG_MARKER.scan, bytes(1, 1, 0, 0, 0x3f, 0)),
    bytes(0x3f),
    u16(JPEG_MARKER.end),
  ]);
}

export function jpegPdf(): Buffer {
  return imagePdf('/BitsPerComponent 8 /Filter /DCTDecode', jpegBytes());
}

function packBits(bits: string): Buffer {
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
  const packed = padded.match(/.{8}/g) ?? [];
  return Buffer.from(packed.map((byte) => parseInt(byte, 2)));
}

function jbig2Segment(number: number, type: number, data: Buffer): Buffer {
  return Buffer.concat([
    u32(number),
    bytes(type, 0, 1),
    u32(data.length),
    data,
  ]);
}

export function jbig2Stream(): Buffer {
  const pageInfo = Buffer.concat([
    u32(IMAGE_SIDE),
    u32(IMAGE_SIDE),
    u32(0),
    u32(0),
    bytes(0),
    u16(0),
  ]);
  const regionInfo = Buffer.concat([
    u32(IMAGE_SIDE),
    u32(IMAGE_SIDE),
    u32(0),
    u32(0),
    bytes(0),
  ]);
  const firstRowBlack = '001' + '00110101' + '000101';
  const otherRowsBlack = '11'.repeat(IMAGE_SIDE - 1);
  const mmrFlag = bytes(1);
  const region = Buffer.concat([
    regionInfo,
    mmrFlag,
    packBits(firstRowBlack + otherRowsBlack),
  ]);
  return Buffer.concat([
    jbig2Segment(0, JBIG2_SEGMENT.pageInfo, pageInfo),
    jbig2Segment(1, JBIG2_SEGMENT.immediateGenericRegion, region),
  ]);
}

export function jbig2Pdf(): Buffer {
  return imagePdf('/BitsPerComponent 1 /Filter /JBIG2Decode', jbig2Stream());
}
