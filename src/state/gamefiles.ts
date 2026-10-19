// The game's files as Tools sees them: in the desktop app, through its
// bridge (state/desktop.ts, features/desktop-app.md). Paths are relative to
// the game's XComGame folder and use "/"; "xew:" before a path reads from XEW
// instead (Long War's backups, and XComEW.exe, the one file there the app
// writes; features/game-bases.md).

/** Where a copy comes from: the game's own files, or an unpacked base. */
export type CopySource = { game: string } | { base: string; path: string }

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
  /** Size and SHA-256, worked out where the file is (no bytes moved), or null if there is none. */
  hash?(path: string): Promise<{ size: number; sha256: string } | null>
  /** Copies a file into the game, replacing what is there at once. */
  copy?(from: CopySource, to: string): Promise<void>
}

/** Size and SHA-256 of a game file, by the platform's own hash where it has one. */
export async function hashOf(
  files: GameFiles,
  path: string,
): Promise<{ size: number; sha256: string } | null> {
  if (files.hash) return files.hash(path)
  const b = await files.read(path)
  return b ? { size: b.length, sha256: await sha256(b) } : null
}

export async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
