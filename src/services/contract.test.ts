import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Handler>();

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return Promise.resolve(() => undefined);
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import * as gateway from './tauri';
import {
  CHECKOUT_DEPTHS,
  DONE_EVENT,
  ERROR_KINDS,
  ITEM_ACTIONS,
  PROGRESS_EVENT,
  runOperation,
  type CheckoutRequest,
  type CleanupRequest,
  type CommitRequest,
  type OperationResult,
  type ProgressEvent,
  type UpdateRequest,
} from './tauri';
import rawContract from '../../src-tauri/tests/fixtures/contract.json?raw';
import rawBackend from '../../src-tauri/src/lib.rs?raw';
import rawCommands from '../../src-tauri/src/commands/mod.rs?raw';

interface Contract {
  error_kinds: string[];
  item_actions: string[];
  depths: string[];
  events: Record<
    string,
    { id: number; event?: ProgressEvent; result?: OperationResult }
  >;
  requests: {
    checkout: CheckoutRequest;
    update: UpdateRequest;
    commit: CommitRequest;
    cleanup: CleanupRequest;
  };
}

const contract = JSON.parse(rawContract) as Contract;

function backendParameters(): Record<string, string[]> {
  const injected = ['state', 'app'];
  const entries = [
    ...rawCommands.matchAll(/pub (?:async )?fn (\w+)\(([^)]*)\)/g),
  ].map(([, name, params]) => [
    name,
    [...params.matchAll(/(\w+)\s*:/g)]
      .map((param) => param[1])
      .filter((param) => !injected.includes(param)),
  ]);
  return Object.fromEntries(entries);
}

function emit(name: string, payload: unknown) {
  handlers.get(name)?.({ payload });
}

async function deliver(name: string): Promise<{
  result: OperationResult;
  seen: ProgressEvent[];
}> {
  const payload = contract.events[name];
  const seen: ProgressEvent[] = [];
  const done = payload.result
    ? payload
    : { id: payload.id, result: { status: 'ok', revision: null } };
  const run = runOperation(
    async () => {
      setTimeout(() => {
        if (payload.event) emit(PROGRESS_EVENT, payload);
        emit(DONE_EVENT, done);
      }, 0);
      return payload.id;
    },
    (event) => seen.push(event),
  );
  return { result: await run, seen };
}

beforeEach(() => {
  handlers.clear();
  vi.mocked(invoke).mockReset();
});

describe('contract with the Rust backend', () => {
  it('lists exactly the error kinds the backend serializes', () => {
    expect([...ERROR_KINDS]).toEqual(contract.error_kinds);
  });

  it.each(['progress_item', 'progress_revision', 'progress_other'])(
    'delivers the backend progress payload %s untouched',
    async (name) => {
      const { seen } = await deliver(name);
      expect(seen).toEqual([contract.events[name].event]);
    },
  );

  it.each(['done_ok', 'done_ok_without_revision', 'done_err'])(
    'resolves with the backend done payload %s untouched',
    async (name) => {
      const { result } = await deliver(name);
      expect(result).toEqual(contract.events[name].result);
    },
  );

  it('listens on the event names the backend emits', () => {
    const rustConst = (name: string) =>
      rawCommands.match(new RegExp(`const ${name}: &str = "([^"]+)"`))?.[1];
    expect(PROGRESS_EVENT).toBe(rustConst('PROGRESS_EVENT'));
    expect(DONE_EVENT).toBe(rustConst('DONE_EVENT'));
    expect(PROGRESS_EVENT).not.toBe(DONE_EVENT);
  });

  it('lists exactly the progress actions and depths the backend uses', () => {
    expect([...ITEM_ACTIONS]).toEqual(contract.item_actions);
    expect([...CHECKOUT_DEPTHS]).toEqual(contract.depths);
  });

  it('invokes every registered command, and only those, with the parameter names the backend declares', async () => {
    const helpers = ['normalizeError', 'runOperation', 'pickDirectory'];
    const wrappers = Object.entries(gateway).filter(
      ([name, value]) => typeof value === 'function' && !helpers.includes(name),
    );
    for (const [, wrapper] of wrappers) {
      await (wrapper as (arg: unknown) => Promise<unknown>)('x');
    }
    const calls = vi.mocked(invoke).mock.calls;
    const registered = [...rawBackend.matchAll(/commands::(\w+),/g)].map(
      (match) => match[1],
    );
    expect(calls.map(([name]) => name).sort()).toEqual([...registered].sort());
    const declared = backendParameters();
    for (const [name, args] of calls) {
      expect(Object.keys(args ?? {}).sort(), name).toEqual(
        [...declared[name]].sort(),
      );
    }
  });
});
