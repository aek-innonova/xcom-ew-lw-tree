// Mod scripts (PatchUPK's format, PatcherGUI's .txt) applied to the game's
// packages: `upkit apply` and `upkit restore` (features/upkit-apply.md). The
// engine is the site's own (src/model/modpatch.ts, game-tools), which reads
// the format as PatchUPK does; here it gets the packages from a folder,
// decompressed where they ship compressed, and the result is written only
// when every step of every script fits. The first time a file changes, it is
// kept as it was in upkit-backup/ beside the folder (XComGame/upkit-backup for
// the game's CookedPCConsole), which `restore` puts back. Not inside it: the
// game reads every package under CookedPCConsole, subfolders too, and a second
// XComGame.upk there stops it with "Ambiguous package name" (and it loads the
// copy; seen in the game, 2026-10-22).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { runScript, type Step } from '../../src/model/modpatch.ts'
import { Package as ScriptPackage } from '../../src/model/upk.ts'
import { decompress } from './package.ts'
import { upkmodRunner } from './upkmodrun.ts'

export const BACKUP = 'upkit-backup'

/** Where the originals of a folder's packages are kept: upkit-backup beside the folder. */
export const backupOf = (folder: string) => join(dirname(resolve(folder)), BACKUP)

interface Opened {
  /** The file's name as it is in the folder. */
  file: string
  original: Uint8Array
  /** The original as it is worked on (decompressed): a package is changed when it is no longer this. */
  plain: Uint8Array
  pkg: ScriptPackage
}

export interface Applied {
  /** Per script: its steps and how it stands (as the engine says). */
  scripts: { script: string; steps: Step[]; status: string }[]
  /** The packages that change, by file name. */
  changed: string[]
  /** Whether everything fits (else nothing is written). */
  ok: boolean
}

/** The file in the folder of that name, in any case (scripts name packages as the game's ini does). */
function fileIn(folder: string, name: string): string | undefined {
  const want = name.toLowerCase()
  return readdirSync(folder).find((f) => f.toLowerCase() === want)
}

/**
 * Runs the scripts, in order, on the folder's packages (in memory): what each
 * step does, and which packages would change. With `write`, and only if all
 * fits, writes them (each original kept first).
 */
export function applyScripts(folder: string, scripts: string[], write: boolean): Applied {
  const opened = new Map<string, Opened>()
  const open = (name: string) => {
    const key = name.toLowerCase()
    if (!opened.has(key)) {
      const file = fileIn(folder, name)
      if (!file) return undefined
      const original = new Uint8Array(readFileSync(join(folder, file)))
      // Compressed (whole, or in chunks): as decompressed, which is how it is written back.
      const plain = decompress(original)
      opened.set(key, { file, original, plain, pkg: new ScriptPackage(plain.slice()) })
    }
    return opened.get(key)!.pkg
  }
  const result: Applied = { scripts: [], changed: [], ok: true }
  for (const script of scripts) {
    const dir = dirname(resolve(script))
    const readFile = (name: string) => {
      const f = join(dir, name)
      return existsSync(f) ? new Uint8Array(readFileSync(f)) : undefined
    }
    // A .upkmod: compiled by upkit, the game's other packages read from the folder as they are now.
    const upkmod = upkmodRunner((file) => open(file)?.bytes)
    const r = runScript(readFileSync(script, 'latin1'), { open, readFile, upkmod })
    // (A .upkmod leaves new package objects; a PatcherGUI script changes the ones it was given.)
    for (const [name, pkg] of r.packages) {
      const o = opened.get(name.toLowerCase())
      if (o && r.status !== 'does-not-fit') o.pkg = pkg
    }
    result.scripts.push({ script, steps: r.steps, status: r.status })
    if (r.status === 'does-not-fit') result.ok = false
  }
  for (const o of opened.values()) {
    const b = o.pkg.bytes
    if (b.length !== o.plain.length || b.some((v, i) => v !== o.plain[i])) result.changed.push(o.file)
  }
  if (write && result.ok) {
    for (const o of opened.values()) {
      if (!result.changed.includes(o.file)) continue
      keep(folder, o.file)
      // A package compressed whole has its size beside it; written decompressed, it goes.
      const sizeFile = fileIn(folder, `${o.file}.uncompressed_size`)
      if (sizeFile) {
        keep(folder, sizeFile)
        rmSync(join(folder, sizeFile))
      }
      writeFileSync(join(folder, o.file), o.pkg.bytes)
    }
  }
  return result
}

/** Keeps the file as it is now in the backup folder, unless a copy is kept already (the original). */
function keep(folder: string, file: string) {
  const backup = backupOf(folder)
  mkdirSync(backup, { recursive: true })
  const to = join(backup, file)
  if (existsSync(to)) return
  copyFileSync(join(folder, file), to)
  // Read back: a backup is only one if it is the file.
  const a = readFileSync(join(folder, file))
  const b = readFileSync(to)
  if (!a.equals(b)) throw new Error(`the copy of ${file} in ${backup} is not the file`)
}

/** Puts the kept originals back and removes the backup folder; the files restored. */
export function restoreOriginals(folder: string): string[] {
  const backup = backupOf(folder)
  if (!existsSync(backup)) return []
  const files = readdirSync(backup)
  for (const f of files) copyFileSync(join(backup, f), join(folder, f))
  rmSync(backup, { recursive: true })
  return files
}
