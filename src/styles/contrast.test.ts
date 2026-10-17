import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

type Rgb = [number, number, number];
type Palette = Record<string, string>;

const TEXT_MINIMUM = 4.5;
const GRAPHIC_MINIMUM = 3;
const TONE_PERCENT_PATTERN = /--percent-selected-mix:\s*(\d+)%/;
const HEX_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const TOKEN_PATTERN = /(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
const BADGE_TONES = [
  '--color-text-muted',
  '--color-success',
  '--color-conflict-marker',
  '--color-error',
];
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const SYSTEM_DARK_BLOCK = '@media (prefers-color-scheme: dark)';
const DARK_BLOCK = ':root[data-theme="dark"] {';

function paletteIn(css: string): Palette {
  return Object.fromEntries(
    [...css.matchAll(TOKEN_PATTERN)].map((match) => [match[1], match[2]]),
  );
}

function tonePercent(css: string): number {
  const match = TONE_PERCENT_PATTERN.exec(css);
  if (!match) throw new Error('falta --percent-selected-mix en tokens.css');
  return Number(match[1]);
}

const systemDarkStart = tokens.indexOf(SYSTEM_DARK_BLOCK);
const lightBlock = tokens.slice(0, systemDarkStart);
const systemDarkBlock = tokens.slice(
  systemDarkStart,
  tokens.indexOf(DARK_BLOCK),
);
const darkBlock = tokens.slice(tokens.indexOf(DARK_BLOCK));
const BADGE_TONE_PERCENT = tonePercent(lightBlock);
const THEMES: Record<string, Palette> = {
  light: paletteIn(lightBlock),
  dark: { ...paletteIn(lightBlock), ...paletteIn(darkBlock) },
  'system dark': { ...paletteIn(lightBlock), ...paletteIn(systemDarkBlock) },
};

function rgbOf(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex);
  if (!match) throw new Error(`color no valido: ${hex}`);
  return [match[1], match[2], match[3]].map((part) =>
    parseInt(part, 16),
  ) as Rgb;
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]: Rgb): number {
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

function contrast(first: Rgb, second: Rgb): number {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

function mix(tone: Rgb, base: Rgb, percent: number): Rgb {
  const share = percent / 100;
  return tone.map((part, index) =>
    Math.round(part * share + base[index] * (1 - share)),
  ) as Rgb;
}

describe.each(Object.entries(THEMES))(
  'contrast in the %s theme',
  (_name, palette) => {
    const color = (token: string) => rgbOf(palette[token]);

    it.each(BADGE_TONES)(
      'keeps the badge text readable over a %s tint',
      (tone) => {
        const tint = mix(
          color(tone),
          color('--color-bg-elevated'),
          BADGE_TONE_PERCENT,
        );
        expect(contrast(color('--color-text'), tint)).toBeGreaterThanOrEqual(
          TEXT_MINIMUM,
        );
      },
    );

    it.each(BADGE_TONES)(
      'keeps the shape and border of %s visible over its tint',
      (tone) => {
        const tint = mix(
          color(tone),
          color('--color-bg-elevated'),
          BADGE_TONE_PERCENT,
        );
        expect(contrast(color(tone), tint)).toBeGreaterThanOrEqual(
          GRAPHIC_MINIMUM,
        );
      },
    );

    it.each(BADGE_TONES)(
      'keeps %s visible over the list background',
      (tone) => {
        expect(
          contrast(color(tone), color('--color-bg')),
        ).toBeGreaterThanOrEqual(GRAPHIC_MINIMUM);
      },
    );

    it('keeps the muted text of notes and hints readable on both surfaces', () => {
      const muted = color('--color-text-muted');
      expect(contrast(muted, color('--color-bg'))).toBeGreaterThanOrEqual(
        TEXT_MINIMUM,
      );
      expect(
        contrast(muted, color('--color-bg-elevated')),
      ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    });

    it('keeps the unavailable flag readable', () => {
      const background = color('--color-conflict-bg');
      expect(
        contrast(color('--color-text'), background),
      ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      expect(
        contrast(color('--color-conflict-marker'), background),
      ).toBeGreaterThanOrEqual(GRAPHIC_MINIMUM);
    });

    it('keeps the focus ring and the current-folder border visible on both surfaces', () => {
      const primary = color('--color-primary');
      expect(contrast(primary, color('--color-bg'))).toBeGreaterThanOrEqual(
        GRAPHIC_MINIMUM,
      );
      expect(
        contrast(primary, color('--color-bg-elevated')),
      ).toBeGreaterThanOrEqual(GRAPHIC_MINIMUM);
    });

    it.each(['--color-primary', '--color-primary-hover'])(
      'keeps the label of a pressed toolbar button readable over %s',
      (fill) => {
        expect(
          contrast(color('--color-bg'), color(fill)),
        ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      },
    );

    it('keeps the text of rows readable on both surfaces', () => {
      const text = color('--color-text');
      expect(contrast(text, color('--color-bg'))).toBeGreaterThanOrEqual(
        TEXT_MINIMUM,
      );
      expect(
        contrast(text, color('--color-bg-elevated')),
      ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    });
  },
);

describe('the contrast helper', () => {
  it('gives 21 for black on white and 1 for the same color', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([9, 9, 9], [9, 9, 9])).toBe(1);
  });
});
