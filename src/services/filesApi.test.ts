import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import {
  WORKSPACE_FILE_ORIGIN,
  fileUrl,
  fsCanOpenExternal,
  fsList,
  fsOpenExternal,
  fsProbe,
  fsReadChunk,
  fsReadText,
  fsWriteBytes,
  fsWriteText,
  uiStateGet,
  uiStateSet,
  wcStatusMap,
  type UiState,
  type WriteTextRequest,
} from './filesApi';

const SAVE: WriteTextRequest = {
  path: 'wc/notas.txt',
  content: 'hola',
  encoding: 'utf16_le',
  has_bom: true,
  eol: 'crlf',
  expected_version: '4-1',
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe('wcStatusMap', () => {
  it('sends the whole request, credentials included, as one req object', async () => {
    vi.mocked(invoke).mockResolvedValue({ entries: [] });
    const req = {
      wc_root: 'wc',
      remote: true,
      refresh: true,
      username: 'alice',
      password: 'p',
    };
    await wcStatusMap(req);
    expect(vi.mocked(invoke).mock.calls).toEqual([['wc_status_map', { req }]]);
  });

  it('turns a failed status into a typed error', async () => {
    vi.mocked(invoke).mockRejectedValue({
      kind: 'auth_required',
      message: 'credenciales',
    });
    await expect(
      wcStatusMap({
        wc_root: 'wc',
        remote: true,
        refresh: false,
        username: null,
        password: null,
      }),
    ).rejects.toMatchObject({ kind: 'auth_required' });
  });
});

describe('filesApi', () => {
  it('turns a rejected command into a typed error', async () => {
    vi.mocked(invoke).mockRejectedValue({
      kind: 'forbidden_path',
      message: 'no permitido',
    });
    await expect(fsList('.svn')).rejects.toEqual({
      kind: 'forbidden_path',
      message: 'no permitido',
      codes: [],
      detail: null,
    });
  });

  it('never allows the download unless asked to', async () => {
    vi.mocked(invoke).mockResolvedValue({ kind: 'cloud' });
    await fsProbe('a.docx');
    await fsProbe('a.docx', true);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['fs_probe', { path: 'a.docx', allow_download: false }],
      ['fs_probe', { path: 'a.docx', allow_download: true }],
    ]);
  });

  it.each([
    'not_text',
    'too_large',
    'file_changed',
    'read_only',
    'file_locked',
    'working_copy_busy',
    'cloud_only',
  ])('keeps the %s error kind of a rejected read or save', async (kind) => {
    vi.mocked(invoke).mockRejectedValue({ kind, message: 'no' });
    await expect(fsWriteText(SAVE)).rejects.toMatchObject({ kind });
    await expect(fsReadText('a.txt')).rejects.toMatchObject({ kind });
  });

  it('sends the save request untouched under the req parameter', async () => {
    vi.mocked(invoke).mockResolvedValue({ version: '5-2' });
    await expect(fsWriteText(SAVE)).resolves.toEqual({ version: '5-2' });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('fs_write_text', {
      req: SAVE,
    });
  });

  it('sends the bytes raw with the path encoded and the version in headers', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(invoke).mockResolvedValue({ version: '9-1' });
    await expect(
      fsWriteBytes('wc/informe #1 ñ.docx', '5-2-ab', bytes),
    ).resolves.toEqual({ version: '9-1' });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('fs_write_bytes', bytes, {
      headers: {
        path: encodeURIComponent('wc/informe #1 ñ.docx'),
        'expected-version': '5-2-ab',
      },
    });
  });

  it.each(['office_too_large', 'file_changed', 'read_only', 'file_locked'])(
    'keeps the %s error kind of a rejected binary save',
    async (kind) => {
      vi.mocked(invoke).mockRejectedValue({ kind, message: 'no' });
      await expect(
        fsWriteBytes('a.docx', 'v', new Uint8Array()),
      ).rejects.toMatchObject({ kind });
    },
  );

  it('reads a window of bytes with snake_case parameters', async () => {
    const bytes = new Uint8Array([1, 2]).buffer;
    vi.mocked(invoke).mockResolvedValue(bytes);
    await expect(fsReadChunk('a.bin', 16, 32)).resolves.toBe(bytes);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('fs_read_chunk', {
      path: 'a.bin',
      offset: 16,
      len: 32,
    });
  });

  it('asks and opens externally by the single path parameter', async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await expect(fsCanOpenExternal('wc/a.docx')).resolves.toBe(true);
    await fsOpenExternal('wc/a.docx');
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['fs_can_open_external', { path: 'wc/a.docx' }],
      ['fs_open_external', { path: 'wc/a.docx' }],
    ]);
  });

  it('keeps the not_allowed kind of a refused external opening', async () => {
    vi.mocked(invoke).mockRejectedValue({ kind: 'not_allowed', message: 'no' });
    await expect(fsOpenExternal('wc/a.exe')).rejects.toMatchObject({
      kind: 'not_allowed',
    });
  });

  it('lists a folder by the path it is given', async () => {
    vi.mocked(invoke).mockResolvedValue({ entries: [] });
    await fsList('wc');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('fs_list', { path: 'wc' });
  });
});

describe('ui state', () => {
  const state: UiState = {
    version: 1,
    favorites: [{ path: 'wc', name: 'Copia' }],
    tabs: [],
    active_tab: null,
    views: {},
  };

  it('reads the persisted state without arguments', async () => {
    vi.mocked(invoke).mockResolvedValue(state);
    await expect(uiStateGet()).resolves.toEqual(state);
    expect(vi.mocked(invoke).mock.calls).toEqual([['ui_state_get', undefined]]);
  });

  it('sends the whole state as one req object', async () => {
    vi.mocked(invoke).mockResolvedValue(state);
    await uiStateSet(state);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['ui_state_set', { req: state }],
    ]);
  });

  it('turns a rejected path into a typed error', async () => {
    vi.mocked(invoke).mockRejectedValue({
      kind: 'outside_workspace',
      message: 'fuera',
    });
    await expect(uiStateSet(state)).rejects.toMatchObject({
      kind: 'outside_workspace',
    });
  });
});

describe('fileUrl', () => {
  it('encodes each segment so # % ? and spaces never reach the URL syntax', () => {
    expect(fileUrl('wc/a#b%c d ñ?.txt')).toBe(
      `${WORKSPACE_FILE_ORIGIN}/wc/a%23b%25c%20d%20%C3%B1%3F.txt`,
    );
  });

  it('accepts the backslashes that Windows listings use', () => {
    expect(fileUrl('wc\\sub\\x.png')).toBe(
      `${WORKSPACE_FILE_ORIGIN}/wc/sub/x.png`,
    );
  });

  it('drops empty segments and keeps a bare root as the origin', () => {
    expect(fileUrl('/wc//x.png')).toBe(`${WORKSPACE_FILE_ORIGIN}/wc/x.png`);
    expect(fileUrl('')).toBe(WORKSPACE_FILE_ORIGIN);
  });

  it('double-encodes a literal percent so a name is never decoded twice', () => {
    expect(fileUrl('wc/%2e%2e')).toBe(`${WORKSPACE_FILE_ORIGIN}/wc/%252e%252e`);
  });
});
