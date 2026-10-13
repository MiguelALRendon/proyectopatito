import { handleInvoke, installMockApi } from './backend';

installMockApi();

export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return (await handleInvoke(command, args)) as T;
}
