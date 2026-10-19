import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { readInnoSetup } from './inno'
import { lzmaDecode, lzmaProps } from './lzma'

// Made with Python's lzma module (FORMAT_ALONE: properties, a size of -1,
// the stream, an end marker) from the text below.
const FIXTURE =
  'XQAAAQD//////////wA2GkofCKAmVk4NbLil7WOcjnzbTvaeS3gYVlz3JuvUo24cRhAMWGrnQZIdf1hLxX9kUJ7nUfC62EXta/rosJSswcm+GT6HGDDdS20Zc35QUFqw0XZQCAzHL3LbndO/ZLJRwA7E20BdqiP9MCxz13sjpLmgXwCgc9OUKP1kmtUQi7nM04YO/wgEc4mFkYQxBi/qOQCRo6e9C8CHhDJRf6f7DEVlewVLfYloJJ2BaCeXazNEmqMucefveo1ychnrJc246J9jctp9RP46V+MGmxWXKMw/Dj3PSqFCOW4z9uWbclC9WO6pF3USDvrCKHNFsYYJ0GykXlKZMe/1mar9tlsw3gJbcTI/V82T5vLiDWym5Qoc0xaJBWdlOCxcYfhZEmECU+xwbaEgMtqO2Wn8y56YvQzeeeOvU6H7cMsNA+aQTqtuKJF4rr6R7ZoBcRmDYau+kusP4k5/iC0Q1+UYbG5AMRQmGbK1Y4QkOeJFU8UikQxTC0XKUDvhy9LS8Y2e20Gsig3ToEj1du681PvR3MahCrsOCS4VOIHYXTkjB26uuHFJ3t7G2K7JptzTilvoCa55e3Im2wVggP4sRHDTudWCyT6U1ilwZ6RivIL1sJnXUkwa2TNJztZioNVEWJMlgoJNiqolaclWcLZ7ri136eESEBcB/OWW+7VNPqmA43s04YtaQXlN/rQDqp9+cHFFWzvnIDez3Dlt22j4OxBYcXBzFImitBwBhAW2YLpIy/yQBO3as/J3g76psUZqkXdgkdZNi4atnaj3yWKyEb7iHrRplzSuItPgpu5H1M50YcLe71kkaTXMxgh8xC4YskZVsH3776521U4gF+kDCPnFSArPnCdTS7ppG2APNxfE31hBt9/emrfZ+4dhxh8q59ETn0xWbtunplvq3+QTFXo5yFYvsA+unDAhan1S8NVM7IIg+OIYAmywIc/zQlGQufbVPkkyIotkRBOFxS8sGLZ2mk2RbIdf8anwrOwuVzx2UhbXE9ULn03bh77AEO71R0ObpY7ur5IxYFDsrDb3U5xbvD+1MK8Xwb6tSjx+pR7AmDMn9y1HPWAhxNRG01NBYLtn4tfp/dz50hwvgNV8xB7qsLg6My7Qv1mj1x/MK/f4ijPOMRCcQAooPVDA91gxKswW8+zVUXOlKbbfEAlnMJA/xpYl5fFabEXBzGWiwrxnMBGIKLiQpTQIUk31NhQvCeB8blvIE3m3g827ui6ky3MuycWxABTk5ac3kue+p32Ks2RcHiFno57gtYqigJpf44kKv1mOrUhJQtoAy9MlYiG5u1JDHVDIRaLFcASkWoYrlrOuSPYJphtHS7v6R1+QOO23NrC12uHS6q/alwA+BotbyQwzsM42dSV7fmElDyHZQU0HBfT+fPrUyqV2uwnPIRbv4SOkU7XEyPJmKDWrgzbBuBeFoV5cf3jKpksb6f2lN7Y4sx/e8J82f27wMjUISCiFPdflPDx+sp0yFaXfI5ynqwOPui4fFPOW55fBB7UsgeQkXhPrpjOAGd50RoOfdXU5ZUo6SpY5RYLlui84WcE0cCTJexQsRtfgEy+CJ12blL9MJiLwsSbenii/oHSEb+aSqvwvMq5THnGs28HZ63UHJv/UDSk1Wa0y3bSInaUmjd+ULCGhR9pAuEWJVC9MVgICfci8Y7I2+o+e4rGOLZCxxDXUU9D062hbWGZR4MWM/PnUSVGqgpURvdq7zx/GipREtP0kdB0hWsAkNwJJ1iMLHlI66clMMG2B3Sq/1oxtJXfvaiNZn7cm91Vs9VbWiIJ4EkeJgZn97b5v2DbzA04jkdZHSwa+4Va+wTZ75zGF6b0QRhHWkKp87pxF3zjpv8NzL6bsxZX9SQhfAfsQnEQN7AWgqW2/f/iq4Ts='
const text = () =>
  Array.from(
    { length: 600 },
    (_, i) => `line ${i}: the quick brown fox jumps over the lazy dog ${(i * i) % 97}\n`,
  ).join('')

test('LZMA: decodes to the end marker, and refuses a stream that is too long', () => {
  const b = Buffer.from(FIXTURE, 'base64')
  const props = lzmaProps(b, 0)
  assert.deepEqual([props.lc, props.lp, props.pb, props.dictSize], [3, 0, 2, 1 << 16])
  // Five property bytes, then eight of size (-1: an end marker ends it).
  const out = lzmaDecode(b, 13, props, 1 << 20)
  assert.equal(Buffer.from(out).toString(), text())
  assert.throws(() => lzmaDecode(b, 13, props, 1000), /longer than expected/)
  const cut = b.subarray(0, b.length - 200)
  assert.throws(() => lzmaDecode(cut, 13, props, 1 << 20), /ends early|bad LZMA/)
})

// The person's copy of the Long War installer, and what innounp unpacked from
// it for the Long War Mod Manager (git-ignored samples/; skipped without).
const MANAGER = path.join(__dirname, '..', '..', 'samples', 'Long War Mod Manager 1.0d-620-1-0d')
const INSTALLER = path.join(MANAGER, 'Long War EW 1.0 for PC-88-1-0.exe')
const UNPACKED = path.join(MANAGER, 'LongWarFiles', '_Long War EW 1.0 for PC-88-1-0.exe', '{app}')

test(
  'the Long War installer: every file as innounp unpacked it',
  { skip: !existsSync(INSTALLER) && 'no samples/' },
  () => {
    const setup = readInnoSetup(readFileSync(INSTALLER))
    assert.equal(setup.appName, 'XCom Long War EW Mod')
    assert.equal(setup.appVersion, '1.0')
    assert.equal(setup.files.length, 401)
    // innounp's script lists the same files, in the same order.
    const script = readFileSync(path.join(UNPACKED, '..', 'install_script.iss'), 'latin1')
    const listed = [...script.matchAll(/^Source: "\{app\}\\([^"]+)"; DestDir/gm)].map((m) => m[1])
    assert.deepEqual(
      setup.files.map((f) => f.destination.replace(/^\{app\}\\/, '')),
      listed,
    )
    let same = 0
    for (const f of setup.files) {
      if (f.filtered) continue // the installer's own helper programs
      const rel = f.destination.replace(/^\{app\}\\/, '').split('\\')
      const want = readFileSync(path.join(UNPACKED, ...rel))
      const got = setup.read(f)
      assert.equal(
        createHash('sha256').update(got).digest('hex'),
        createHash('sha256').update(want).digest('hex'),
        rel.join('/'),
      )
      same++
    }
    assert.equal(same, 397)
  },
)
