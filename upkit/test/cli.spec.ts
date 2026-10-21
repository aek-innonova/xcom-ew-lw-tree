import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CORPUS, haveCorpus } from './corpus.ts'

// The command line as a modder runs it: the common case end to end, in a scratch folder.
const cli = new URL('../src/cli.ts', import.meta.url).pathname
const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

describe.skipIf(!haveCorpus)('the command line', () => {
  it('class, edit, compile to a mod script and to a package; usage; errors said in a line', () => {
    const game = dirname(CORPUS[0]!)
    const pkg = CORPUS[3]!
    const dir = mkdtempSync(join(tmpdir(), 'lwtree-upkit-'))
    try {
      expect(run('info', pkg)).toContain('XComStrategyGame: version 845')
      const src = run('class', pkg, 'XGFacility_Labs')
      expect(src).toContain('class XGFacility_Labs')
      writeFileSync(join(dir, 'Labs.uc'), src)
      expect(run('compile', pkg, 'XGFacility_Labs', join(dir, 'Labs.uc'), '--patch', join(dir, 'none.txt'))).toContain('nothing edited')
      writeFileSync(join(dir, 'Labs.uc'), src.replace('float(1) + m_fLabBonus', 'float(3) + m_fLabBonus'))
      expect(run('compile', pkg, 'XGFacility_Labs', join(dir, 'Labs.uc'), '--patch', join(dir, 'labs.txt'))).toContain('XGFacility_Labs.GetResearchPerHour as a PatchUPK mod script')
      expect(readFileSync(join(dir, 'labs.txt'), 'utf8')).toContain('OBJECT=XGFacility_Labs.GetResearchPerHour:AUTO')
      run('compile', pkg, 'XGFacility_Labs', join(dir, 'Labs.uc'), '--out', join(dir, 'new.upk'), '--game', game)
      expect(run('decompile', join(dir, 'new.upk'), 'XGFacility_Labs.GetResearchPerHour', '--game', game)).toContain('float(3) + m_fLabBonus')
      run('export', pkg, join(dir, 'src'))
      expect(existsSync(join(dir, 'src', 'XGFacility_Labs.uc'))).toBe(true)
      // No command: the usage; a bad one: one line, no stack.
      let err = ''
      try {
        execFileSync(process.execPath, [cli], { encoding: 'utf8', stdio: 'pipe' })
      } catch (e) {
        err = String((e as { stderr: string }).stderr)
      }
      expect(err).toContain('Commands:')
      try {
        execFileSync(process.execPath, [cli, 'compile', pkg, 'XGFacility_Labs.Nope', join(dir, 'Labs.uc'), '--patch', join(dir, 'x.txt')], { encoding: 'utf8', stdio: 'pipe' })
      } catch (e) {
        err = String((e as { stderr: string }).stderr)
      }
      expect(err.trim().split('\n').length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
