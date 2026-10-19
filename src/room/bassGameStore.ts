import { createBassGame, type BassGameSnapshot } from "./bassGame";

/** Only the small rhythm overlay subscribes to the fast-moving note timeline. */
export function createBassGameStore() {
  let value = createBassGame().snapshot();
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish(snapshot: BassGameSnapshot) {
      value = snapshot;
      for (const listener of listeners) listener();
    },
  };
}
