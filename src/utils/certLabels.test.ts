import { describe, expect, it } from 'vitest';
import { TRUST_FAILURES } from '../services/marketplaceApi';
import {
  ALL_SERVERS_SCOPE,
  TRUST_FAILURE_LABELS,
  certScope,
  formatFingerprint,
  shortFingerprint,
} from './certLabels';

const SHA = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('certLabels', () => {
  it('groups the fingerprint in uppercase pairs separated by colons', () => {
    expect(formatFingerprint(SHA)).toBe(
      'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
    );
    expect(formatFingerprint('')).toBe('');
  });

  it('abbreviates to the first 16 hex digits', () => {
    expect(shortFingerprint(SHA)).toBe('AB:CD:EF:01:23:45:67:89');
  });

  it('describes every failure reason with a sentence', () => {
    TRUST_FAILURES.forEach((failure) =>
      expect(TRUST_FAILURE_LABELS[failure]).toMatch(/\.$/),
    );
  });

  it('falls back to every server when there is no scope', () => {
    expect(certScope(null)).toBe(ALL_SERVERS_SCOPE);
    expect(certScope('host:443')).toBe('host:443');
  });
});
