import type { FileFilter } from '../services/tauri';

export const AUTHORITY_FILTERS: FileFilter[] = [
  { name: 'Certificados', extensions: ['crt', 'pem', 'cer', 'der'] },
];

export const CLIENT_CERT_FILTERS: FileFilter[] = [
  { name: 'PKCS#12', extensions: ['p12', 'pfx'] },
];
