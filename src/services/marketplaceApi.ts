import { call } from './tauri';

export interface RepoEntry {
  id: number;
  name: string;
  url: string;
  username: string | null;
  favorite: boolean;
  last_path: string;
  uuid: string | null;
  root: string | null;
  client_cert: string | null;
}

export interface MarketplaceView {
  repos: RepoEntry[];
  recovered: boolean;
}

export interface RepoDraft {
  id: number | null;
  name: string;
  url: string;
  username: string | null;
  client_cert: string | null;
}

export interface RepoTestArgs {
  url: string;
  repo_id: number | null;
  username: string | null;
  password: string | null;
  no_auth_cache: boolean;
  client_cert?: string | null;
  client_cert_passphrase?: string | null;
}

export interface RepoTestResult {
  uuid: string;
  root: string;
  url: string;
  revision: number;
}

export const TRUST_FAILURES = [
  'unknown-ca',
  'cn-mismatch',
  'expired',
  'not-yet-valid',
  'other',
] as const;
export type TrustFailure = (typeof TRUST_FAILURES)[number];

export interface CertInfo {
  host: string;
  port: number;
  sha256: string;
  subject: string;
  issuer: string;
  not_before: string;
  not_after: string;
}

export interface CertPrompt {
  info: CertInfo;
  reasons: TrustFailure[];
}

export type TrustKind = 'pinned' | 'authority';

export interface TrustedCert {
  sha256: string;
  subject: string;
  issuer: string;
  not_after: string;
  kind: TrustKind;
  scope: string | null;
  allowed: TrustFailure[];
  added_at: number;
}

export interface TrustRequest {
  url: string;
  sha256: string;
  allowed: TrustFailure[];
}

export const marketplaceReposGet = () =>
  call<MarketplaceView>('marketplace_repos_get');
export const marketplaceRepoSave = (req: RepoDraft) =>
  call<RepoEntry>('marketplace_repo_save', { req });
export const marketplaceRepoRemove = (id: number) =>
  call<void>('marketplace_repo_remove', { id });
export const marketplaceRepoFavorite = (id: number, favorite: boolean) =>
  call<RepoEntry>('marketplace_repo_favorite', { id, favorite });
export const marketplaceRepoTest = (req: RepoTestArgs) =>
  call<RepoTestResult>('marketplace_repo_test', { req });
export const marketplaceRepoSetLastPath = (id: number, path: string) =>
  call<RepoEntry>('marketplace_repo_set_last_path', { id, path });
export const marketplaceCertInspect = (url: string, repo_id: number | null) =>
  call<CertPrompt>('marketplace_cert_inspect', { url, repo_id });
export const marketplaceCertTrust = (req: TrustRequest) =>
  call<TrustedCert>('marketplace_cert_trust', { req });
export const marketplaceCertImport = (path: string) =>
  call<TrustedCert>('marketplace_cert_import', { path });
export const marketplaceCertList = () =>
  call<TrustedCert[]>('marketplace_cert_list');
export const marketplaceCertRevoke = (sha256: string) =>
  call<void>('marketplace_cert_revoke', { sha256 });
