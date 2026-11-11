export interface SaveFlight<Outcome> {
  current(id: string): Promise<Outcome> | undefined;
  track(id: string, attempt: Promise<Outcome>): Promise<Outcome>;
}

export function createSaveFlight<Outcome>(): SaveFlight<Outcome> {
  const running = new Map<string, Promise<Outcome>>();
  return {
    current: (id) => running.get(id),
    track(id, attempt) {
      const tracked = attempt.finally(() => {
        if (running.get(id) === tracked) running.delete(id);
      });
      running.set(id, tracked);
      return tracked;
    },
  };
}
