import assert from 'node:assert/strict'
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { crc32 } from 'node:zlib'
import { BaseStore, deletesIn, exePatchesIn } from './bases'
import { readZip } from './zip'

/** A zip of stored files, written by hand (the format's simplest form). */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const n = Buffer.from(name)
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(n.length, 26)
    locals.push(local, n, data)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(data.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += 30 + n.length + data.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

const LWR_FILES = {
  'LW Rebalance v9.1.0/Change Log v9.1.0.txt': 'notes',
  'LW Rebalance v9.1.0/Long_War_Rebalance_Installer.exe': 'not an installer',
  'LW Rebalance v9.1.0/CookedPCConsole/LWRebalance.u': 'rebalance',
  'LW Rebalance v9.1.0/CookedPCConsole/XComGame.upk': 'lwr upk',
  'LW Rebalance v9.1.0/Config/DefaultGameCore.ini': '[A]\r\nB=2\r\n',
  'LW Rebalance v9.1.0/Localization/INT/XComGame.int': 'int',
}

test('the Long War installer’s own scripts: what it deletes, how it patches the exe', () => {
  assert.deepEqual(
    deletesIn(
      'REM This is a temp file.\r\ndel "..\\XComGame\\CookedPCConsole\\XComGame.upk.uncompressed_size"\r\n' +
        'del "..\\Binaries\\Win32\\other.txt"\r\n',
    ),
    ['CookedPCConsole/XComGame.upk.uncompressed_size'],
  )
  const xml = `<PatcherConfiguration><PatchTargets><PatchTarget>
    <TargetPath>XEW\\Binaries\\Win32\\XComEW.exe</TargetPath><IsUPKFile>false</IsUPKFile>
    <Patches><PatchEntry><Description>Prevent Phone Home</Description>
      <FindValue>70 00 72 00</FindValue><ReplaceValue>70 00 78 00</ReplaceValue>
    </PatchEntry></Patches></PatchTarget></PatchTargets></PatcherConfiguration>`
  assert.deepEqual(exePatchesIn(xml), [
    { description: 'Prevent Phone Home', find: '70007200', replace: '70007800' },
  ])
  assert.throws(
    () => exePatchesIn(xml.replace('XEW\\Binaries\\Win32\\XComEW.exe', 'XEW\\Other.exe')),
    /does not know/,
  )
})

test('LWR from a zip or a folder in the library: found, named, unpacked to its game folders', async () => {
  const library = mkdtempSync(path.join(tmpdir(), 'lwtree-library-'))
  writeFileSync(path.join(library, 'LWR download.zip'), makeZip(LWR_FILES))
  // The same, unpacked by the player, a level down.
  for (const [p, t] of Object.entries(LWR_FILES)) {
    const f = path.join(library, 'unpacked', ...p.split('/'))
    mkdirSync(path.dirname(f), { recursive: true })
    writeFileSync(f, t)
  }
  // Mods are not bases, even with the same files.
  mkdirSync(path.join(library, 'Mods', 'x', 'CookedPCConsole'), { recursive: true })
  writeFileSync(path.join(library, 'Mods', 'x', 'CookedPCConsole', 'LWRebalance.u'), 'x')
  writeFileSync(path.join(library, 'notes.zip'), makeZip({ 'a.txt': 'not LWR' }))
  // A zip dropped into Mods is found too.
  writeFileSync(path.join(library, 'Mods', 'LWR in mods.zip'), makeZip(LWR_FILES))

  const store = new BaseStore(library, mkdtempSync(path.join(tmpdir(), 'lwtree-cache-')))
  const found = await store.list()
  assert.deepEqual(found.map((b) => [b.kind, b.name, b.source, b.unpacked]).sort(), [
    ['lwr', 'Long War Rebalanced 9.1.0', 'LWR download.zip', false],
    ['lwr', 'Long War Rebalanced 9.1.0', 'Mods/LWR in mods.zip', false],
    ['lwr', 'Long War Rebalanced 9.1.0', 'unpacked/LW Rebalance v9.1.0', false],
  ])
  for (const b of found) {
    const m = await store.unpack(b.id)
    assert.deepEqual(
      m.files.map((f) => f.path).sort(),
      [
        'Config/DefaultGameCore.ini',
        'CookedPCConsole/LWRebalance.u',
        'CookedPCConsole/XComGame.upk',
        'Localization/INT/XComGame.int',
      ],
      b.source,
    )
    assert.ok(existsSync(await store.file(b.id, 'cookedpcconsole/lwrebalance.u')))
  }
  assert.ok((await store.list()).every((b) => b.unpacked))
})

test('a zip: stored and checked; a damaged one refused', () => {
  const z = makeZip({ 'a/b.txt': 'hello' })
  const zip = readZip(z)
  assert.equal(Buffer.from(zip.read(zip.entries[0]!)).toString(), 'hello')
  const bad = Buffer.from(z)
  bad[30 + 'a/b.txt'.length] = 'j'.charCodeAt(0)
  assert.throws(() => readZip(bad).read(readZip(bad).entries[0]!), /did not unpack whole/)
})

// The person's Long War installer and LWR download (git-ignored samples/).
const SAMPLES = path.join(__dirname, '..', '..', 'samples')
const LW = path.join(
  SAMPLES,
  'Long War Mod Manager 1.0d-620-1-0d',
  'Long War EW 1.0 for PC-88-1-0.exe',
)
const LWR = path.join(
  SAMPLES,
  'LW Rebalance V2.06.00 - Perkicon 686 2.06.00 2026-10-18T00-20Z IYVlw8ZX.zip',
)

test(
  'the real Long War installer and LWR zip, from a library',
  { skip: !(existsSync(LW) && existsSync(LWR)) && 'no samples/' },
  async () => {
    const library = mkdtempSync(path.join(tmpdir(), 'lwtree-library-'))
    // Linked where the disk allows it (no admin needed on Windows), else copied.
    for (const f of [LW, LWR]) {
      const to = path.join(library, path.basename(f))
      try {
        linkSync(f, to)
      } catch {
        copyFileSync(f, to)
      }
    }
    const store = new BaseStore(library, mkdtempSync(path.join(tmpdir(), 'lwtree-cache-')))
    const found = await store.list()
    const lw = found.find((b) => b.kind === 'lw')!
    const lwr = found.find((b) => b.kind === 'lwr')!
    assert.equal(lw.name, 'Long War 1.0')
    assert.equal(lwr.name, 'Long War Rebalanced 2.06.00')
    // Unpacked off the main thread: a timer here keeps ticking meanwhile (it
    // froze the window for some seconds when the unpacking ran on it).
    let last = Date.now()
    let gap = 0
    const tick = setInterval(() => {
      gap = Math.max(gap, Date.now() - last)
      last = Date.now()
    }, 50)
    const m = await store.unpack(lw.id)
    clearInterval(tick)
    assert.ok(gap < 1000, `the main thread stalled for ${gap} ms`)
    assert.equal(m.files.length, 380)
    assert.ok(m.files.some((f) => f.path === 'CookedPCConsole/LongWar.upk'))
    assert.deepEqual(m.deletes, [
      'CookedPCConsole/XComGame.upk.uncompressed_size',
      'CookedPCConsole/XComStrategyGame.upk.uncompressed_size',
      'CookedPCConsole/Engine.upk.uncompressed_size',
    ])
    assert.deepEqual(
      m.exePatches.map((p) => p.description),
      [
        'Read DefaultGameCore.ini from Config Folder',
        'Read DefaultLoadouts.ini from Config Folder',
        'Prevent Phone Home',
      ],
    )
    // Long War's own notes, for the class colors' names.
    assert.ok(m.docs?.includes('Long_War_EW_Armor_Kit_Codes.txt'))
    assert.match(
      new TextDecoder().decode((await store.doc(lw.id, 'long_war_ew_armor_kit_codes.txt'))!),
      /^Colors/m,
    )
    assert.equal((await store.unpack(lwr.id)).files.length, 149)
  },
)
