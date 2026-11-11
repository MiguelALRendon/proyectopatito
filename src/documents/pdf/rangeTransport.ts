import { PDFDataRangeTransport } from 'pdfjs-dist';

const CONTENT_RANGE_TOTAL = /\/(\d+)$/;
const PARTIAL_CONTENT = 206;

export interface FirstRead {
  bytes: Uint8Array;
  total: number;
  isComplete: boolean;
}

async function readRange(url: string, begin: number, end: number) {
  const response = await fetch(url, {
    headers: { Range: `bytes=${begin}-${end - 1}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    response,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

export async function readFirstChunk(
  url: string,
  chunkBytes: number,
): Promise<FirstRead> {
  const { response, bytes } = await readRange(url, 0, chunkBytes);
  const declared = response.headers
    .get('Content-Range')
    ?.match(CONTENT_RANGE_TOTAL);
  const isPartial = response.status === PARTIAL_CONTENT && declared;
  const total = isPartial ? Number(declared[1]) : bytes.length;
  return { bytes, total, isComplete: bytes.length >= total };
}

export class ProtocolRangeTransport extends PDFDataRangeTransport {
  private readonly url: string;

  constructor(url: string, first: FirstRead) {
    super(first.total, first.bytes);
    this.url = url;
  }

  requestDataRange(begin: number, end: number) {
    const limit = Math.min(end, this.length);
    readRange(this.url, begin, limit)
      .then(({ bytes }) => this.onDataRange(begin, bytes))
      .catch(() => this.abort());
  }
}
