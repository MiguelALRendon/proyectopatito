import type { Page } from 'playwright-core';
import { u32 } from './containerFixtures';

const SAMPLE_RATE = 8000;
const WAV_SECONDS = 3;
const TONE_HZ = 440;
const TONE_AMPLITUDE = 6000;
const MP3_FRAME_BYTES = 417;
const MP3_FRAMES = 100;
const PADDING = 64;
const RECORD_MS = 2000;
const CRC8_POLY = 0x07;
const CRC16_POLY = 0x8005;

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function tone(samples: number): Int16Array {
  return Int16Array.from({ length: samples }, (_unused, index) =>
    Math.round(
      Math.sin((2 * Math.PI * TONE_HZ * index) / SAMPLE_RATE) * TONE_AMPLITUDE,
    ),
  );
}

export function wavBytes(): Buffer {
  const samples = tone(SAMPLE_RATE * WAV_SECONDS);
  const data = Buffer.from(samples.buffer);
  return Buffer.concat([
    Buffer.from('RIFF'),
    u32(36 + data.length),
    Buffer.from('WAVEfmt '),
    u32(16),
    u16(1),
    u16(1),
    u32(SAMPLE_RATE),
    u32(SAMPLE_RATE * 2),
    u16(2),
    u16(16),
    Buffer.from('data'),
    u32(data.length),
    data,
  ]);
}

export function corruptWavBytes(): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF'),
    u32(36),
    Buffer.from('WAVEfmt '),
    u32(16),
    Buffer.alloc(16),
    Buffer.from('data'),
    u32(8),
    Buffer.alloc(8),
  ]);
}

export function mp3Bytes(): Buffer {
  const frame = Buffer.alloc(MP3_FRAME_BYTES);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: MP3_FRAMES }, () => frame));
}

export function fakeAviBytes(): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF'),
    u32(36),
    Buffer.from('AVI LIST'),
    Buffer.alloc(PADDING),
  ]);
}

export function noiseMp3Bytes(): Buffer {
  return Buffer.from(
    Array.from({ length: 512 }, (_unused, n) => 0x80 | ((n * 37) & 0x7f)),
  );
}

function crc(bytes: Buffer, polynomial: number, width: 8 | 16): number {
  const top = width === 8 ? 0x80 : 0x8000;
  const mask = width === 8 ? 0xff : 0xffff;
  let value = 0;
  for (const byte of bytes) {
    value ^= width === 8 ? byte : byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      value =
        value & top ? ((value << 1) ^ polynomial) & mask : (value << 1) & mask;
    }
  }
  return value;
}

const FLAC_BLOCK = 4096;
const FLAC_BLOCKS = 4;
const FLAC_BLOCK_CODE = 0xc4;
const FLAC_VERBATIM = 0x02;

function flacStreamInfo(samples: number, frameBytes: number): Buffer {
  const packed =
    (BigInt(SAMPLE_RATE) << 44n) | (0n << 41n) | (15n << 36n) | BigInt(samples);
  const info = Buffer.alloc(34);
  info.writeUInt16BE(FLAC_BLOCK, 0);
  info.writeUInt16BE(FLAC_BLOCK, 2);
  info.writeUIntBE(frameBytes, 4, 3);
  info.writeUIntBE(frameBytes, 7, 3);
  info.writeBigUInt64BE(packed, 10);
  return Buffer.concat([Buffer.from([0x80, 0x00, 0x00, 0x22]), info]);
}

function flacFrame(number: number, samples: Int16Array): Buffer {
  const audio = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => audio.writeInt16BE(sample, index * 2));
  const head = Buffer.from([0xff, 0xf8, FLAC_BLOCK_CODE, 0x08, number]);
  const withCrc = Buffer.concat([head, Buffer.from([crc(head, CRC8_POLY, 8)])]);
  const body = Buffer.concat([withCrc, Buffer.from([FLAC_VERBATIM]), audio]);
  const footer = Buffer.alloc(2);
  footer.writeUInt16BE(crc(body, CRC16_POLY, 16));
  return Buffer.concat([body, footer]);
}

export function flacBytes(): Buffer {
  const total = FLAC_BLOCK * FLAC_BLOCKS;
  const samples = tone(total);
  const frames = Array.from({ length: FLAC_BLOCKS }, (_unused, index) =>
    flacFrame(
      index,
      samples.subarray(index * FLAC_BLOCK, (index + 1) * FLAC_BLOCK),
    ),
  );
  return Buffer.concat([
    Buffer.from('fLaC'),
    flacStreamInfo(total, frames[0].length),
    ...frames,
  ]);
}

export interface RecordedMedia {
  name: string;
  mime: string;
  hasVideo: boolean;
}

export const RECORDINGS: RecordedMedia[] = [
  { name: 'pista.webm', mime: 'audio/webm;codecs=opus', hasVideo: false },
  { name: 'clip.webm', mime: 'video/webm;codecs=vp8,opus', hasVideo: true },
  { name: 'clip.mp4', mime: 'video/mp4;codecs=avc1,mp4a.40.2', hasVideo: true },
  {
    name: 'clip.mkv',
    mime: 'video/x-matroska;codecs=avc1,opus',
    hasVideo: true,
  },
];

export async function record(
  page: Page,
  recording: RecordedMedia,
): Promise<Buffer | null> {
  const base64 = await page.evaluate(
    async ({ mime, hasVideo, ms }) => {
      if (!MediaRecorder.isTypeSupported(mime)) return null;
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator();
      oscillator.connect(destination);
      oscillator.start();
      const tracks = [...destination.stream.getAudioTracks()];
      let painter = 0;
      if (hasVideo) {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 120;
        const paint = canvas.getContext('2d') as CanvasRenderingContext2D;
        let frame = 0;
        painter = window.setInterval(() => {
          paint.fillStyle = `hsl(${(frame * 12) % 360},80%,50%)`;
          paint.fillRect(0, 0, 160, 120);
          frame += 1;
        }, 50);
        tracks.push(...canvas.captureStream(20).getVideoTracks());
      }
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
      });
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, ms));
      recorder.stop();
      await stopped;
      window.clearInterval(painter);
      oscillator.stop();
      await context.close();
      const blob = new Blob(chunks);
      const reader = new FileReader();
      const read = new Promise<string>((resolve) => {
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
      });
      reader.readAsDataURL(blob);
      return read;
    },
    { mime: recording.mime, hasVideo: recording.hasVideo, ms: RECORD_MS },
  );
  return base64 ? Buffer.from(base64, 'base64') : null;
}
