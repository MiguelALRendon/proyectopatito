import { describe, expect, it } from 'vitest';
import {
  MEDIA_ERROR_ABORTED,
  MEDIA_ERROR_DECODE,
  MEDIA_ERROR_NETWORK,
  MEDIA_ERROR_UNSUPPORTED,
  clamp,
  describeDimensions,
  failureOfError,
  formatClock,
  isRecognized,
  mediaKeyAction,
  seekTarget,
  stepVolume,
} from './media';

describe('mediaKeyAction: lo que no es una tecla del reproductor', () => {
  it.each([
    '',
    'a',
    'Enter',
    'Escape',
    'Tab',
    'Home',
    'End',
    'PageUp',
    'Shift',
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'mm',
    ' m',
  ])('%j no hace nada', (key) => {
    expect(mediaKeyAction(key)).toBeNull();
  });
});

describe('mediaKeyAction: las teclas del reproductor', () => {
  it.each([
    [' ', 'toggle'],
    ['ArrowLeft', 'back'],
    ['ArrowRight', 'forward'],
    ['ArrowUp', 'louder'],
    ['ArrowDown', 'quieter'],
    ['m', 'mute'],
    ['M', 'mute'],
    ['f', 'fullscreen'],
    ['F', 'fullscreen'],
  ])('%j es %s', (key, action) => {
    expect(mediaKeyAction(key)).toBe(action);
  });
});

describe('isRecognized', () => {
  const probe = (answer: CanPlayTypeResult) => ({ canPlayType: () => answer });

  it('una cadena vacía es un formato que el WebView no reconoce', () => {
    expect(isRecognized(probe(''), 'video/x-msvideo')).toBe(false);
  });

  it.each(['maybe', 'probably'] as const)(
    '«%s» se intenta reproducir',
    (answer) => {
      expect(isRecognized(probe(answer), 'audio/mpeg')).toBe(true);
    },
  );

  it('pregunta por el tipo MIME recibido', () => {
    const asked: string[] = [];
    isRecognized(
      {
        canPlayType: (mime) => {
          asked.push(mime);
          return '';
        },
      },
      'video/webm',
    );
    expect(asked).toEqual(['video/webm']);
  });
});

describe('failureOfError', () => {
  it.each([
    [MEDIA_ERROR_ABORTED, 'aborted'],
    [MEDIA_ERROR_NETWORK, 'network'],
    [MEDIA_ERROR_DECODE, 'decode'],
    [MEDIA_ERROR_UNSUPPORTED, 'unsupported'],
  ])('el código %d es %s', (code, failure) => {
    expect(failureOfError(code)).toBe(failure);
  });

  it.each([null, undefined, 0, 5, -1, 99, Number.NaN])(
    'un código desconocido (%s) se trata como formato no compatible',
    (code) => {
      expect(failureOfError(code)).toBe('unsupported');
    },
  );
});

describe('formatClock', () => {
  it.each([
    [Number.NaN, '--:--'],
    [Number.POSITIVE_INFINITY, '--:--'],
    [Number.NEGATIVE_INFINITY, '--:--'],
    [-1, '--:--'],
    [0, '0:00'],
    [0.9, '0:00'],
    [5, '0:05'],
    [59.99, '0:59'],
    [60, '1:00'],
    [75, '1:15'],
    [599, '9:59'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [36000, '10:00:00'],
  ])('%s se muestra como %s', (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });
});

describe('seekTarget', () => {
  it('no baja de cero ni pasa de la duración', () => {
    expect(seekTarget(2, -5, 30)).toBe(0);
    expect(seekTarget(28, 5, 30)).toBe(30);
    expect(seekTarget(10, 5, 30)).toBe(15);
    expect(seekTarget(10, -5, 30)).toBe(5);
  });

  it('con una duración desconocida solo se limita por abajo', () => {
    expect(seekTarget(10, 5, Number.POSITIVE_INFINITY)).toBe(15);
    expect(seekTarget(10, 5, Number.NaN)).toBe(15);
    expect(seekTarget(1, -5, Number.NaN)).toBe(0);
  });
});

describe('stepVolume', () => {
  it('sube y baja en pasos y se queda entre 0 y 1', () => {
    expect(stepVolume(0.5, 0.1)).toBe(0.6);
    expect(stepVolume(0.5, -0.1)).toBe(0.4);
    expect(stepVolume(1, 0.1)).toBe(1);
    expect(stepVolume(0, -0.1)).toBe(0);
  });

  it('no acumula error de coma flotante', () => {
    let volume = 0;
    for (let step = 0; step < 10; step += 1) volume = stepVolume(volume, 0.1);
    expect(volume).toBe(1);
  });
});

describe('clamp y describeDimensions', () => {
  it('clamp respeta los dos extremos', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it.each([
    [0, 0],
    [160, 0],
    [0, 120],
  ])('unas dimensiones %d × %d no se muestran', (width, height) => {
    expect(describeDimensions(width, height)).toBeNull();
  });

  it('unas dimensiones válidas se muestran con la unidad', () => {
    expect(describeDimensions(1920, 1080)).toBe('1920 × 1080 px');
  });
});
