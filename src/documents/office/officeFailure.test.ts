import { describe, expect, it } from 'vitest';
import { failureOf } from './officeFailure';
import { OfficeError, type OfficeFailureCode } from './officeHost';

describe('failureOf', () => {
  it.each<[OfficeFailureCode, string]>([
    ['timeout', 'timeout'],
    ['boot-failed', 'boot'],
    ['open-failed', 'damaged'],
    ['save-failed', 'damaged'],
    ['invalid-message', 'damaged'],
    ['busy', 'damaged'],
    ['destroyed', 'boot'],
  ])('traduce el código %s a %s', (code, expected) => {
    expect(failureOf(new OfficeError(code))).toBe(expected);
  });

  it.each([
    ['un TypeError de fetch', new TypeError('Failed to fetch')],
    ['un Error cualquiera', new Error('HTTP 500')],
    ['una cadena', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('lo que no es un OfficeError (%s) es no legible', (_name, error) => {
    expect(failureOf(error)).toBe('unreadable');
  });
});
