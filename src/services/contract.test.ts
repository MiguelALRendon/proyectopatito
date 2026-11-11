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
import * as archiveApi from './archiveApi';
import * as filesApi from './filesApi';
import * as marketplaceApi from './marketplaceApi';
import {
  TRUST_FAILURES,
  type CertPrompt,
  type MarketplaceView,
  type RepoDraft,
  type RepoTestArgs,
  type RepoTestResult,
  type TrustedCert,
  type TrustRequest,
} from './marketplaceApi';
import {
  CHECKOUT_DEPTHS,
  CLOSE_REQUESTED_EVENT,
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
  type SvnDetection,
  type UpdateRequest,
  SVN_ORIGINS,
} from './tauri';
import {
  LINE_ENDINGS,
  PROBE_KINDS,
  SORT_DIRECTIONS,
  SORT_KEYS,
  TAB_KINDS,
  TEXT_ENCODINGS,
  VIEW_COLUMNS,
  VIEW_MODES,
  type DirListing,
  type FileProbe,
  type TextDocument,
  type StatusMapRequest,
  type TextWritten,
  type UiState,
  type UiStateView,
  type WcStatusMap,
  type WriteTextRequest,
} from './filesApi';
import rawContract from '../../src-tauri/tests/fixtures/contract.json?raw';
import rawBackend from '../../src-tauri/src/lib.rs?raw';

const commandSources = import.meta.glob('../../src-tauri/src/commands/*.rs', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const rawCommands = Object.values(commandSources).join('\n');

interface Contract {
  error_kinds: string[];
  svn_origins: string[];
  svn_detection: SvnDetection;
  probe_kinds: string[];
  encodings: string[];
  eols: string[];
  view_modes: string[];
  view_columns: string[];
  sort_keys: string[];
  sort_directions: string[];
  tab_kinds: string[];
  ui_state: UiStateView;
  fs: {
    listing: DirListing;
    probe: FileProbe;
    text_document: TextDocument;
    text_written: TextWritten;
  };
  status_map: WcStatusMap;
  marketplace_view: MarketplaceView;
  marketplace_repo_test: RepoTestResult;
  trust_failures: string[];
  marketplace_cert_prompt: CertPrompt;
  marketplace_trusted: TrustedCert[];
  marketplace_requests: {
    save_new: RepoDraft;
    save_edit: RepoDraft;
    test: RepoTestArgs;
    test_minimal: RepoTestArgs;
    cert_trust: TrustRequest;
  };
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
    write_text: WriteTextRequest;
    status_map: StatusMapRequest;
    ui_state_set: UiState;
  };
}

const contract = JSON.parse(rawContract) as Contract;

const HELPERS = [
  'call',
  'normalizeError',
  'runOperation',
  'pickDirectory',
  'pickFile',
  'onCloseRequested',
  'onEvent',
  'onArchiveProgress',
  'newArchiveTaskId',
];

function backendParameters(): Record<string, string[]> {
  const injected = ['state', 'app', 'request'];
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

  it('keeps multi-word command parameters in snake_case on the wire', () => {
    const commands = [
      ...rawCommands.matchAll(
        /#\[tauri::command([^\]]*)\]\s*pub (?:async )?fn (\w+)\(([^)]*)\)/g,
      ),
    ];
    const multiWord = commands.filter(([, , , params]) =>
      /\b[a-z]+_[a-z_]+\s*:/.test(params.replace(/state\s*:.*/s, '')),
    );
    expect(multiWord.map(([, , name]) => name)).toContain('fs_probe');
    for (const [, attributes, name] of multiWord) {
      expect(attributes, name).toContain('rename_all = "snake_case"');
    }
  });

  it('reads the svn detection exactly as the backend serializes it', () => {
    expect([...SVN_ORIGINS]).toEqual(contract.svn_origins);
    expect(Object.keys(contract.svn_detection).sort()).toEqual([
      'binary',
      'error',
      'warning',
    ]);
    expect(Object.keys(contract.svn_detection.binary ?? {}).sort()).toEqual([
      'origin',
      'path',
      'version',
    ]);
  });

  it('lists exactly the probe kinds and file payloads the backend serializes', () => {
    expect([...PROBE_KINDS]).toEqual(contract.probe_kinds);
    expect(Object.keys(contract.fs.listing.entries[0]).sort()).toEqual([
      'cloud_only',
      'escapes_workspace',
      'hidden',
      'is_link',
      'kind',
      'modified_ms',
      'name',
      'read_only',
      'size',
    ]);
    expect(PROBE_KINDS).toContain(contract.fs.probe.kind);
  });

  it('lists exactly the encodings, line endings and text payloads the backend uses', () => {
    expect([...TEXT_ENCODINGS]).toEqual(contract.encodings);
    expect([...LINE_ENDINGS]).toEqual(contract.eols);
    expect(Object.keys(contract.fs.text_document).sort()).toEqual([
      'content',
      'encoding',
      'eol',
      'eol_mixed',
      'has_bom',
      'len',
      'version',
    ]);
    expect(Object.keys(contract.fs.text_written)).toEqual(['version']);
    expect(Object.keys(contract.requests.write_text).sort()).toEqual([
      'content',
      'encoding',
      'eol',
      'expected_version',
      'has_bom',
      'path',
    ]);
    expect(TEXT_ENCODINGS).toContain(contract.fs.text_document.encoding);
    expect(LINE_ENDINGS).toContain(contract.requests.write_text.eol);
  });

  it('lists exactly the status map and status entry fields the backend serializes', () => {
    expect(Object.keys(contract.status_map).sort()).toEqual([
      'against_revision',
      'changed_folders',
      'entries',
      'truncated',
    ]);
    expect(Object.keys(contract.status_map.entries[0]).sort()).toEqual([
      'copied',
      'item',
      'lock',
      'path',
      'props',
      'remote_item',
      'remote_props',
      'revision',
      'switched',
      'tree_conflicted',
      'wc_locked',
    ]);
    expect(
      Object.keys(contract.status_map.entries[0].lock ?? {}).sort(),
    ).toEqual(['comment', 'owner']);
    expect(Object.keys(contract.requests.status_map).sort()).toEqual([
      'password',
      'refresh',
      'remote',
      'username',
      'wc_root',
    ]);
  });

  it('lists exactly the marketplace fields the backend serializes and accepts', () => {
    const { marketplace_view: view, marketplace_requests: requests } = contract;
    expect(Object.keys(view).sort()).toEqual(['recovered', 'repos']);
    const repoFields = [
      'client_cert',
      'favorite',
      'id',
      'last_path',
      'name',
      'root',
      'url',
      'username',
      'uuid',
    ];
    for (const repo of view.repos) {
      expect(Object.keys(repo).sort()).toEqual(repoFields);
    }
    expect(Object.keys(contract.marketplace_repo_test).sort()).toEqual([
      'revision',
      'root',
      'url',
      'uuid',
    ]);
    for (const draft of [requests.save_new, requests.save_edit]) {
      expect(Object.keys(draft).sort()).toEqual([
        'client_cert',
        'id',
        'name',
        'url',
        'username',
      ]);
    }
    for (const args of [requests.test, requests.test_minimal]) {
      expect(Object.keys(args).sort()).toEqual([
        'client_cert',
        'client_cert_passphrase',
        'no_auth_cache',
        'password',
        'repo_id',
        'url',
        'username',
      ]);
    }
    expect(view.repos[0].client_cert).toMatch(/\.p12$/);
    expect(requests.test.client_cert_passphrase).toBe('frase');
  });

  it('lists exactly the certificate fields the backend serializes and accepts', () => {
    expect([...TRUST_FAILURES]).toEqual(contract.trust_failures);
    const prompt = contract.marketplace_cert_prompt;
    expect(Object.keys(prompt).sort()).toEqual(['info', 'reasons']);
    expect(Object.keys(prompt.info).sort()).toEqual([
      'host',
      'issuer',
      'not_after',
      'not_before',
      'port',
      'sha256',
      'subject',
    ]);
    for (const cert of contract.marketplace_trusted) {
      expect(Object.keys(cert).sort()).toEqual([
        'added_at',
        'allowed',
        'issuer',
        'kind',
        'not_after',
        'scope',
        'sha256',
        'subject',
      ]);
    }
    expect(contract.marketplace_trusted.map((cert) => cert.kind)).toEqual([
      'pinned',
      'authority',
    ]);
    expect(
      Object.keys(contract.marketplace_requests.cert_trust).sort(),
    ).toEqual(['allowed', 'sha256', 'url']);
  });

  it('lists exactly the ui state enums and fields the backend uses', () => {
    expect([...VIEW_MODES]).toEqual(contract.view_modes);
    expect([...VIEW_COLUMNS]).toEqual(contract.view_columns);
    expect([...SORT_KEYS]).toEqual(contract.sort_keys);
    expect([...SORT_DIRECTIONS]).toEqual(contract.sort_directions);
    expect([...TAB_KINDS]).toEqual(contract.tab_kinds);
    expect(Object.keys(contract.requests.ui_state_set).sort()).toEqual([
      'active_tab',
      'favorites',
      'tabs',
      'version',
      'views',
    ]);
    expect(Object.keys(contract.requests.ui_state_set.tabs[0]).sort()).toEqual([
      'id',
      'kind',
      'path',
      'title',
    ]);
    expect(
      Object.keys(contract.requests.ui_state_set.favorites[0]).sort(),
    ).toEqual(['name', 'path']);
    const view = Object.values(contract.requests.ui_state_set.views)[0];
    expect(Object.keys(view).sort()).toEqual([
      'columns',
      'mode',
      'sort',
      'sort_direction',
      'updated_ms',
    ]);
  });

  it('reads the ui state view as the request plus an exists flag on every path', () => {
    const request = contract.requests.ui_state_set;
    const view = contract.ui_state;
    const withoutExists = ({ exists: _exists, ...rest }: { exists: boolean }) =>
      rest;
    expect(view.favorites.map(withoutExists).slice(0, 1)).toEqual(
      request.favorites,
    );
    expect(view.tabs.map(withoutExists)).toEqual(request.tabs);
    expect(Object.keys(view.views)).toEqual(Object.keys(request.views));
    expect(view.tabs.every((tab) => typeof tab.exists === 'boolean')).toBe(
      true,
    );
    expect(view.active_tab).toBe(request.active_tab);
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
    expect(archiveApi.ARCHIVE_PROGRESS_EVENT).toBe(
      rustConst('ARCHIVE_PROGRESS_EVENT'),
    );
  });

  it('listens for the close request on the event name the backend emits', () => {
    const rustName = rawCommands.match(
      /const CLOSE_REQUESTED_EVENT: &str = "([^"]+)"/,
    )?.[1];
    expect(CLOSE_REQUESTED_EVENT).toBe(rustName);
    const handler = vi.fn();
    gateway.onCloseRequested(handler);
    emit(CLOSE_REQUESTED_EVENT, null);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('lists exactly the progress actions and depths the backend uses', () => {
    expect([...ITEM_ACTIONS]).toEqual(contract.item_actions);
    expect([...CHECKOUT_DEPTHS]).toEqual(contract.depths);
  });

  it('invokes every registered command, and only those, with the parameter names the backend declares', async () => {
    const wrappers = Object.entries({
      ...gateway,
      ...filesApi,
      ...archiveApi,
      ...marketplaceApi,
    }).filter(
      ([name, value]) => typeof value === 'function' && !HELPERS.includes(name),
    );
    for (const [, wrapper] of wrappers) {
      await (wrapper as (arg: unknown) => Promise<unknown>)('x');
    }
    const calls = vi.mocked(invoke).mock.calls;
    const registered = [
      ...rawBackend.matchAll(/commands::(?:\w+::)*(\w+),/g),
    ].map((match) => match[1]);
    expect(calls.map(([name]) => name).sort()).toEqual([...registered].sort());
    const declared = backendParameters();
    for (const [name, args] of calls) {
      expect(Object.keys(args ?? {}).sort(), name).toEqual(
        [...declared[name]].sort(),
      );
    }
  });
});
