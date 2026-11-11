const cMaps = import.meta.glob<string>(
  '/node_modules/pdfjs-dist/cmaps/*.bcmap',
  {
    query: '?url',
    import: 'default',
    eager: true,
  },
);
const standardFonts = import.meta.glob<string>(
  '/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}',
  { query: '?url', import: 'default', eager: true },
);
const wasm = import.meta.glob<string>(
  '/node_modules/pdfjs-dist/wasm/{jbig2,openjpeg,qcms_bg}.wasm',
  {
    query: '?url',
    import: 'default',
    eager: true,
  },
);
const profiles = import.meta.glob<string>(
  '/node_modules/pdfjs-dist/iccs/*.icc',
  {
    query: '?url',
    import: 'default',
    eager: true,
  },
);

function baseUrlOf(files: Record<string, string>): string {
  const [first] = Object.values(files);
  const absolute = new URL(first, document.baseURI).href;
  return absolute.slice(0, absolute.lastIndexOf('/') + 1);
}

export const PDF_ASSET_URLS = {
  cMapUrl: baseUrlOf(cMaps),
  standardFontDataUrl: baseUrlOf(standardFonts),
  wasmUrl: baseUrlOf(wasm),
  iccUrl: baseUrlOf(profiles),
};
