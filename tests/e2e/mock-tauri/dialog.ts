import { installMockApi, state } from './backend';

installMockApi();

export async function open(): Promise<string | null> {
  return state.nextDirectory;
}
