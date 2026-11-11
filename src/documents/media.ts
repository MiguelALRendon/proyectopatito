export const SEEK_STEP_SECONDS = 5;
export const VOLUME_STEP = 0.1;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const MEDIA_ERROR_ABORTED = 1;
export const MEDIA_ERROR_NETWORK = 2;
export const MEDIA_ERROR_DECODE = 3;
export const MEDIA_ERROR_UNSUPPORTED = 4;

export type MediaKeyAction =
  'toggle' | 'back' | 'forward' | 'louder' | 'quieter' | 'mute' | 'fullscreen';

export type MediaFailure =
  'unrecognized' | 'unsupported' | 'decode' | 'network' | 'aborted';

const KEY_ACTIONS: Record<string, MediaKeyAction> = {
  ' ': 'toggle',
  ArrowLeft: 'back',
  ArrowRight: 'forward',
  ArrowUp: 'louder',
  ArrowDown: 'quieter',
  m: 'mute',
  M: 'mute',
  f: 'fullscreen',
  F: 'fullscreen',
};

const FAILURE_BY_ERROR_CODE: Record<number, MediaFailure> = {
  [MEDIA_ERROR_ABORTED]: 'aborted',
  [MEDIA_ERROR_NETWORK]: 'network',
  [MEDIA_ERROR_DECODE]: 'decode',
  [MEDIA_ERROR_UNSUPPORTED]: 'unsupported',
};

export function mediaKeyAction(key: string): MediaKeyAction | null {
  return Object.prototype.hasOwnProperty.call(KEY_ACTIONS, key)
    ? KEY_ACTIONS[key]
    : null;
}

export function isRecognized(
  probe: Pick<HTMLMediaElement, 'canPlayType'>,
  mime: string,
): boolean {
  return probe.canPlayType(mime) !== '';
}

export function failureOfError(code: number | null | undefined): MediaFailure {
  if (code === null || code === undefined) return 'unsupported';
  return FAILURE_BY_ERROR_CODE[code] ?? 'unsupported';
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function seekTarget(
  current: number,
  delta: number,
  duration: number,
): number {
  const limit = Number.isFinite(duration) ? duration : Number.MAX_SAFE_INTEGER;
  return clamp(current + delta, 0, limit);
}

export function stepVolume(volume: number, delta: number): number {
  return Math.round(clamp(volume + delta, 0, 1) * 100) / 100;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = twoDigits(total % SECONDS_PER_MINUTE);
  if (hours > 0) return `${hours}:${twoDigits(minutes)}:${rest}`;
  return `${minutes}:${rest}`;
}

export function describeDimensions(
  width: number,
  height: number,
): string | null {
  if (!width || !height) return null;
  return `${width} × ${height} px`;
}
