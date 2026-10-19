import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  gameDirUnder,
  inside,
  librariesWithApp,
  listInside,
  readInside,
  regValue,
  removeInside,
  writeInside,
} from './game'

function steamGame() {
  const steam = path.join(mkdtempSync(path.join(tmpdir(), 'lwtree-game-')), 'XCom-Enemy-Unknown')
  for (const d of ['XComGame/CookedPCConsole', 'XComGame/Config', 'XEW/XComGame/CookedPCConsole', 'XEW/XComGame/Config'])
    mkdirSync(path.join(steam, d), { recursive: true })
  const game = path.join(steam, 'XEW', 'XComGame')
  writeFileSync(path.join(game, 'Config', 'DefaultGameCore.ini'), 'A=1\r\n')
  return { steam, game }
}

test('takes XEW/XComGame over Enemy Unknown’s XComGame, from any of the game’s folders', async () => {
  const { steam, game } = steamGame()
  for (const p of [steam, path.join(steam, 'XEW'), game]) assert.equal(await gameDirUnder(p), game)
  assert.equal(await gameDirUnder(path.dirname(steam)), null)
})

test('reads a registry value as reg prints it', () => {
  const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\Steam App 200510\r\n    InstallLocation    REG_SZ    I:\\Games\\Steam\\steamapps\\common\\XCom-Enemy-Unknown\r\n'
  assert.equal(regValue(out, 'InstallLocation'), 'I:\\Games\\Steam\\steamapps\\common\\XCom-Enemy-Unknown')
  assert.equal(regValue('    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n', 'SteamPath'), 'c:\\program files (x86)\\steam')
  assert.equal(regValue('ERROR: The system was unable to find the specified registry key', 'SteamPath'), '')
})

test('finds the Steam library that holds the game', () => {
  const vdf = `"libraryfolders"
{
	"0" { "path"		"C:\\\\Program Files (x86)\\\\Steam" "apps" { "228980" "1" } }
	"1" { "path"		"I:\\\\Games\\\\Steam" "apps" { "200510" "2" "225340" "3" } }
}`
  assert.deepEqual(librariesWithApp(vdf, '200510'), ['I:\\Games\\Steam'])
  // An old list without apps: every library.
  assert.deepEqual(librariesWithApp('"1" "D:\\\\Steam"\n"path" "D:\\\\Steam"', '200510'), ['D:\\Steam'])
})

test('keeps every path inside the game folder, matching names whatever their case', async () => {
  const { game } = steamGame()
  for (const bad of ['../XComGame', 'Config/../../x', '/etc/passwd', 'C:\\Windows\\win.ini', '..\\x', ''])
    await assert.rejects(inside(game, bad), /bad path/)
  assert.equal(await inside(game, 'config/defaultgamecore.ini'), path.join(game, 'Config', 'DefaultGameCore.ini'))
})

test('reads, lists, writes in one go and removes', async () => {
  const { game } = steamGame()
  assert.deepEqual([...(await readInside(game, 'Config/DefaultGameCore.ini'))!], [...Buffer.from('A=1\r\n')])
  assert.deepEqual([...(await readInside(game, 'Config/DefaultGameCore.ini', 2, 3))!], [0x31])
  assert.equal(await readInside(game, 'Config/Nope.ini'), null)
  await writeInside(game, 'lwtree-backup/Config/DefaultGameCore.ini', Buffer.from('A=1\r\n'))
  await writeInside(game, 'Config/DefaultGameCore.ini', Buffer.from('A=2\r\n'))
  assert.equal(readFileSync(path.join(game, 'Config', 'DefaultGameCore.ini'), 'latin1'), 'A=2\r\n')
  assert.deepEqual(readdirSync(path.join(game, 'Config')), ['DefaultGameCore.ini']) // no temporary file left
  assert.deepEqual((await listInside(game, 'Config')).map((e) => e.name), ['DefaultGameCore.ini'])
  await removeInside(game, 'lwtree-backup/Config/DefaultGameCore.ini')
  assert.equal(await readInside(game, 'lwtree-backup/Config/DefaultGameCore.ini'), null)
})
