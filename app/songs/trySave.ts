// A save through a server action, which can fail in ways the action never
// sees: the body is refused before it runs (next.config.mjs allows 15mb), or
// the network is down. Either one rejects the call, and a save UI awaiting it
// bare was left on "saving…".
const MAX_CHARS = 14_000_000;

export async function trySave<T extends { error?: string }>(
  data: unknown,
  save: () => Promise<T>,
): Promise<T> {
  try {
    if (JSON.stringify(data).length > MAX_CHARS)
      return { error: "this song is too big to save: its samples take it past 14MB" } as T;
    return await save();
  } catch {
    return { error: "the save did not reach the server" } as T;
  }
}
