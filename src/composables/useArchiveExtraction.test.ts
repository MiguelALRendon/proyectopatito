import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import type { ExtractProgress, ExtractReport } from '../services/archiveApi';
import type { CommandError } from '../services/tauri';

const api = vi.hoisted(() => ({
  archiveCancel: vi.fn(),
  archiveExtract: vi.fn(),
  newArchiveTaskId: vi.fn(),
  onArchiveProgress: vi.fn(),
}));
vi.mock('../services/archiveApi', () => api);

import { useArchiveExtraction } from './useArchiveExtraction';

const REPORT: ExtractReport = {
  destination: 'wc/a',
  files: 2,
  directories: 1,
  bytes: 30,
  skipped: [],
  skipped_more: 0,
};

function failure(kind: CommandError['kind'], codes: string[] = []) {
  return { kind, message: kind, codes, detail: null };
}

function setup(path = 'wc/a.zip') {
  let result!: ReturnType<typeof useArchiveExtraction>;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useArchiveExtraction(() => path);
        return () => null;
      },
    }),
  );
  return { extraction: result, wrapper };
}

let handler: (progress: ExtractProgress) => void;
const unlisten = vi.fn();

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  unlisten.mockReset();
  api.newArchiveTaskId.mockReturnValue(7);
  api.archiveCancel.mockResolvedValue(true);
  api.onArchiveProgress.mockImplementation(async (next) => {
    handler = next;
    return unlisten;
  });
});

describe('useArchiveExtraction', () => {
  it('extrae con el id de la tarea y termina con el informe', async () => {
    api.archiveExtract.mockResolvedValue(REPORT);
    const { extraction } = setup();
    await extraction.start();
    expect(api.archiveExtract).toHaveBeenCalledWith('wc/a.zip', 7, false);
    expect(extraction.phase.value).toBe('done');
    expect(extraction.report.value).toEqual(REPORT);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('solo hace caso al progreso de su propia tarea', async () => {
    let finish!: (report: ExtractReport) => void;
    api.archiveExtract.mockReturnValue(
      new Promise<ExtractReport>((resolve) => (finish = resolve)),
    );
    const { extraction } = setup();
    const running = extraction.start();
    await vi.waitFor(() => expect(extraction.phase.value).toBe('running'));
    handler({ id: 99, files: 5, bytes: 5, total_bytes: 10 });
    expect(extraction.progress.value).toBeNull();
    handler({ id: 7, files: 1, bytes: 4, total_bytes: 10 });
    expect(extraction.progress.value?.bytes).toBe(4);
    finish(REPORT);
    await running;
  });

  it('cancelar pide cancelar la tarea en curso y una cancelación termina como tal', async () => {
    let fail!: (error: CommandError) => void;
    api.archiveExtract.mockReturnValue(
      new Promise((_, reject) => (fail = reject)),
    );
    const { extraction } = setup();
    const running = extraction.start();
    await vi.waitFor(() => expect(extraction.phase.value).toBe('running'));
    await extraction.cancel();
    expect(api.archiveCancel).toHaveBeenCalledWith(7);
    fail(failure('cancelled'));
    await running;
    expect(extraction.phase.value).toBe('cancelled');
  });

  it('cancelar sin extracción en curso no hace nada', async () => {
    const { extraction } = setup();
    await extraction.cancel();
    expect(api.archiveCancel).not.toHaveBeenCalled();
  });

  it('una sospecha descubierta al extraer pide confirmación y se reintenta confirmada', async () => {
    api.archiveExtract.mockRejectedValueOnce(
      failure('archive_needs_confirmation', ['ratio']),
    );
    const { extraction } = setup();
    await extraction.start();
    expect(extraction.phase.value).toBe('needs_confirmation');
    expect(extraction.failure.value?.codes).toEqual(['ratio']);
    api.archiveExtract.mockResolvedValueOnce(REPORT);
    await extraction.start(true);
    expect(api.archiveExtract).toHaveBeenLastCalledWith('wc/a.zip', 7, true);
    expect(extraction.phase.value).toBe('done');
  });

  it('cualquier otro error queda como fallo con su mensaje', async () => {
    api.archiveExtract.mockRejectedValue(failure('archive_corrupt'));
    const { extraction } = setup();
    await extraction.start();
    expect(extraction.phase.value).toBe('failed');
    expect(extraction.failure.value?.kind).toBe('archive_corrupt');
  });

  it('sin canal de progreso sigue extrayendo', async () => {
    api.onArchiveProgress.mockRejectedValue(new Error('sin eventos'));
    api.archiveExtract.mockResolvedValue(REPORT);
    const { extraction } = setup();
    await extraction.start();
    expect(extraction.phase.value).toBe('done');
  });

  it('no arranca dos extracciones a la vez', async () => {
    api.archiveExtract.mockReturnValue(new Promise(() => undefined));
    const { extraction } = setup();
    void extraction.start();
    await vi.waitFor(() => expect(extraction.phase.value).toBe('running'));
    await extraction.start();
    expect(api.archiveExtract).toHaveBeenCalledTimes(1);
  });

  it('al desmontar mientras extrae cancela la tarea', async () => {
    api.archiveExtract.mockReturnValue(new Promise(() => undefined));
    const { extraction, wrapper } = setup();
    void extraction.start();
    await vi.waitFor(() => expect(extraction.phase.value).toBe('running'));
    wrapper.unmount();
    expect(api.archiveCancel).toHaveBeenCalledWith(7);
    expect(unlisten).toHaveBeenCalled();
  });
});
