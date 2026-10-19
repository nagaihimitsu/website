type Disposable = { dispose(): void };

export type DisposalScope = {
  /** Own only resources created here; borrowed textures stay with their caller. */
  own<T extends Disposable>(resource: T): T;
  defer(cleanup: () => void): void;
  dispose(): void;
};

/**
 * Release resources once, in reverse acquisition order. All cleanups run even
 * when one fails; dispose then throws an AggregateError containing the failures.
 * Registrations after disposal run immediately, including late async results.
 */
export function createDisposalScope(): DisposalScope {
  const owned = new WeakSet<Disposable>();
  const cleanups: (() => void)[] = [];
  let disposed = false;

  const defer = (cleanup: () => void) => {
    if (disposed) cleanup();
    else cleanups.push(cleanup);
  };

  return {
    own<T extends Disposable>(resource: T): T {
      if (!owned.has(resource)) {
        owned.add(resource);
        defer(() => resource.dispose());
      }
      return resource;
    },
    defer,
    dispose() {
      if (disposed) return;
      disposed = true;
      const failures: unknown[] = [];
      while (cleanups.length) {
        try {
          cleanups.pop()!();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, "Resource disposal failed");
    },
  };
}

/**
 * Construct a resource owner transactionally. On success the returned owner
 * must expose/call scope.dispose. On failure, release partial construction and
 * preserve the original exception; a secondary cleanup failure is diagnostic.
 */
export function withDisposalScope<T>(build: (scope: DisposalScope) => T): T {
  const scope = createDisposalScope();
  try {
    return build(scope);
  } catch (error) {
    try {
      scope.dispose();
    } catch (cleanupError) {
      console.error("Resource cleanup after initialization failed", cleanupError);
    }
    throw error;
  }
}
