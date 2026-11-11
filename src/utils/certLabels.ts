import type { TrustFailure, TrustKind } from '../services/marketplaceApi';

const HEX_PAIR = /.{1,2}/g;
const SHORT_FINGERPRINT_HEX = 16;

export const ALL_SERVERS_SCOPE = 'todos los servidores';

export const TRUST_FAILURE_LABELS: Record<TrustFailure, string> = {
  'unknown-ca': 'La autoridad que firmó el certificado no es de confianza.',
  'cn-mismatch': 'El certificado pertenece a otro nombre de servidor.',
  expired: 'El certificado está vencido.',
  'not-yet-valid': 'El certificado todavía no es válido.',
  other: 'Subversion rechazó el certificado por otro motivo.',
};

export const TRUST_KIND_LABELS: Record<TrustKind, string> = {
  authority: 'Autoridad',
  pinned: 'Fijado',
};

export function formatFingerprint(hex: string): string {
  return (hex.toUpperCase().match(HEX_PAIR) ?? []).join(':');
}

export function shortFingerprint(hex: string): string {
  return formatFingerprint(hex.slice(0, SHORT_FINGERPRINT_HEX));
}

export function certScope(scope: string | null): string {
  return scope ?? ALL_SERVERS_SCOPE;
}
