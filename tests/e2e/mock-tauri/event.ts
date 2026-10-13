import { addListener, installMockApi } from './backend';

installMockApi();

export type UnlistenFn = () => void;

export async function listen<T>(
  event: string,
  handler: (event: { event: string; id: number; payload: T }) => void,
): Promise<UnlistenFn> {
  return addListener(event, (tauriEvent) =>
    handler({ ...tauriEvent, payload: tauriEvent.payload as T }),
  );
}
