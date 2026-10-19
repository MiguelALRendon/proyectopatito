import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ARCHIVE_PROGRESS_EVENT,
  archiveCancel,
  archiveExtract,
  archiveList,
  newArchiveTaskId,
  onArchiveProgress,
} from './archiveApi';

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
});

describe('archive task ids', () => {
  it('are unique and increasing', () => {
    const first = newArchiveTaskId();
    const second = newArchiveTaskId();
    expect(second).toBe(first + 1);
  });
});

describe('archive commands', () => {
  it('lists with the task id in snake_case', async () => {
    vi.mocked(invoke).mockResolvedValue({ entries: [] });
    await archiveList('wc/a.zip', 7);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('archive_list', {
      path: 'wc/a.zip',
      task_id: 7,
    });
  });

  it('extracts without confirmation by default', async () => {
    vi.mocked(invoke).mockResolvedValue({ destination: 'wc/a' });
    await archiveExtract('wc/a.zip', 8);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('archive_extract', {
      path: 'wc/a.zip',
      task_id: 8,
      allow_suspicious: false,
    });
  });

  it('sends the confirmation when the user gave it', async () => {
    vi.mocked(invoke).mockResolvedValue({ destination: 'wc/a' });
    await archiveExtract('wc/a.zip', 9, true);
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith('archive_extract', {
      path: 'wc/a.zip',
      task_id: 9,
      allow_suspicious: true,
    });
  });

  it('cancels by task id', async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await expect(archiveCancel(8)).resolves.toBe(true);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('archive_cancel', {
      task_id: 8,
    });
  });

  it('keeps the kind of the backend error', async () => {
    vi.mocked(invoke).mockRejectedValue({
      kind: 'archive_needs_confirmation',
      message: 'confirmar',
      codes: ['ratio'],
      detail: null,
    });
    await expect(archiveExtract('wc/a.zip', 1)).rejects.toMatchObject({
      kind: 'archive_needs_confirmation',
      codes: ['ratio'],
    });
  });
});

describe('archive progress', () => {
  it('hands the payload to the handler and returns the unlisten function', async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);
    const handler = vi.fn();
    const stop = await onArchiveProgress(handler);
    const [name, callback] = vi.mocked(listen).mock.calls[0];
    expect(name).toBe(ARCHIVE_PROGRESS_EVENT);
    const payload = { id: 3, files: 1, bytes: 10, total_bytes: 20 };
    (callback as (event: { payload: typeof payload }) => void)({ payload });
    expect(handler).toHaveBeenCalledWith(payload);
    expect(stop).toBe(unlisten);
  });
});
