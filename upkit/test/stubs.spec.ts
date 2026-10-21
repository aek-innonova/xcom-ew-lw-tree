import { describe, expect, it } from 'vitest'
import { stubs } from '../src/stubs.ts'

describe('what a new package reads from outside it', () => {
  it('localized values for its .int, config values for its .ini, from its defaults', () => {
    const src = `class MyThing extends Object config(MyMod);
var config int m_iCount;
var config array<string> m_arrNames;
var localized string m_strTitle;
var int m_iNotRead;
defaultproperties
{
    m_iCount=3
    m_arrNames(0)="a"
    m_arrNames(1)="b"
    m_strTitle="My thing"
    m_iNotRead=7
}
`
    const r = stubs('MyMod', [src])
    expect(r.int).toBe('[MyThing]\r\nm_strTitle="My thing"\r\n')
    expect(r.ini.get('MyMod')).toBe('[MyMod.MyThing]\r\nm_iCount=3\r\nm_arrNames(0)="a"\r\nm_arrNames(1)="b"\r\n')
  })
})
