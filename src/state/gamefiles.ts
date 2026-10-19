// The game's files as Tools sees them: in the desktop app, through its
// bridge (state/desktop.ts, features/desktop-app.md). Paths are relative to
// the game's XComGame folder and use "/".

export interface GameFiles {
  /** A file's bytes, or null if there is none. */
  read(path: string): Promise<Uint8Array | null>
  /** A file as a File (name and bytes). */
  file(path: string): Promise<File | null>
  /** File names in a folder ([] if none). */
  list(dir: string): Promise<string[]>
  /** Writes a whole file (creating folders), replacing it at once. */
  write(path: string, data: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
  /** Whether writing is allowed (asking, where the platform asks). */
  canWrite(ask: boolean): Promise<boolean>
}

export async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
