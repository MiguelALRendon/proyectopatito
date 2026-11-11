import { OFFICE_FAILURE_NOTICES } from '../labels';
import { OfficeError, type OfficeFailureCode } from './officeHost';

export type OfficeFailure = keyof typeof OFFICE_FAILURE_NOTICES;

export class UnreadableFileError extends Error {}

const FAILURE_BY_CODE: Record<OfficeFailureCode, OfficeFailure> = {
  timeout: 'timeout',
  'boot-failed': 'boot',
  'open-failed': 'damaged',
  'save-failed': 'damaged',
  'invalid-message': 'damaged',
  busy: 'damaged',
  destroyed: 'boot',
};

export function failureOf(error: unknown): OfficeFailure {
  if (error instanceof OfficeError) return FAILURE_BY_CODE[error.code];
  return 'unreadable';
}
