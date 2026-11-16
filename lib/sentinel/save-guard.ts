/**
 * Save guard for decision snapshots (2026-11-16). Pure, no React. One request id per comparison shown: a second
 * click on Save sends the same id (the server then returns the stored snapshot instead of making another), and a
 * click while a save is in flight is ignored. A new comparison gets a new id.
 */
export function createSaveGuard(newId: () => string) {
  let current: unknown = undefined, id: string | null = null, inFlight = false;
  return {
    /** The request id for this comparison; the same object always gets the same id. */
    idFor(comparison: unknown) { if (comparison !== current || !id) { current = comparison; id = newId(); } return id; },
    /** True if a save may start now; false while one is running. */
    begin() { if (inFlight) return false; inFlight = true; return true; },
    end() { inFlight = false; },
    get busy() { return inFlight; },
  };
}
