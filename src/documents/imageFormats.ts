import type { FileProbe } from '../services/filesApi';

const SVG_MIME = 'image/svg+xml';
const SVG_EXTENSION = 'svg';

export function isVectorImage(probe: FileProbe): boolean {
  return probe.mime === SVG_MIME || probe.extension === SVG_EXTENSION;
}
