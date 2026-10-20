import { describe, expect, it } from 'vitest'
import { describe as say, fieldsOf, styled, valueOf, type Format } from '../settingformat'

const pair: Format = { kind: 'pair', parts: ['Defense', 'Mobility'] }

describe('settings in the player’s terms, written in the file’s (model/settingformat.ts)', () => {
  it('Long War’s xxyy: two numbers in, one out', () => {
    expect(fieldsOf(pair, '104')).toEqual(['1', '4'])
    expect(fieldsOf(pair, '1204')).toEqual(['12', '4'])
    expect(valueOf(pair, ['2', '5'], '104')).toEqual({ value: '205' })
    expect(valueOf(pair, ['0', '7'], '104')).toEqual({ value: '7' })
    expect(valueOf(pair, ['1', '100'], '104')).toEqual({ error: 'Whole numbers, 0 to 99' })
    expect(say(pair, '104')).toBe('Defense 1, mobility 4')
    expect(say({ kind: 'pair', parts: ['HP', 'Will'] }, '301')).toBe('HP 3, will 1')
  })

  it('a percentage the file keeps as a fraction', () => {
    const f: Format = { kind: 'percent', fraction: true }
    expect(fieldsOf(f, '0.45')).toEqual(['45'])
    expect(valueOf(f, ['25'], '0.45')).toEqual({ value: '0.25' })
    expect(valueOf(f, ['7'], '.45')).toEqual({ value: '0.07' })
    expect(valueOf(f, ['120'], '0.45')).toEqual({ error: 'At most 100' })
    expect(say(f, '0.45')).toBe('45 %')
  })

  it('LWR’s floats keep their "f" and decimal point', () => {
    expect(styled(5, '4f')).toBe('5f')
    expect(styled(0, '1.0f')).toBe('0.0f')
    expect(styled(0.25, '0.5f')).toBe('0.25f')
    expect(styled(7, '5.0')).toBe('7.0')
    expect(styled(0.1 + 0.2, '1')).toBe('0.3')
    const speed: Format = { kind: 'number', min: 1, max: 10 }
    expect(fieldsOf(speed, '4f')).toEqual(['4'])
    expect(valueOf(speed, ['6'], '4f')).toEqual({ value: '6f' })
    expect(valueOf(speed, ['11'], '4f')).toEqual({ error: 'At most 10' })
    expect(valueOf(speed, ['fast'], '4f')).toEqual({ error: 'Not a number' })
  })

  it('on and off, choices, multipliers and hours, in words', () => {
    const stats: Format = { kind: 'switch', on: 1, off: 0 }
    expect(fieldsOf(stats, '1.0f')).toEqual(['on'])
    expect(valueOf(stats, ['off'], '1.0f')).toEqual({ value: '0.0f' })
    // War Record popups: 1 turns them off.
    const popups: Format = { kind: 'switch', on: 0, off: 1 }
    expect(say(popups, '0')).toBe('on')
    expect(valueOf(popups, ['off'], '0')).toEqual({ value: '1' })
    const order: Format = {
      kind: 'choice',
      options: [
        [1, 'by class'],
        [0, 'by rank'],
      ],
    }
    expect(say(order, '0')).toBe('by rank')
    expect(valueOf(order, ['3'], '1')).toEqual({ error: 'Not one of the choices' })
    expect(say({ kind: 'times' }, '0.61')).toBe('× 0.61')
    expect(say({ kind: 'hours' }, '1320')).toBe('1320 hours (55 days)')
    expect(say({ kind: 'hours' }, '24')).toBe('24 hours')
    expect(say({ kind: 'number', unit: 'missions' }, '1')).toBe('1 mission')
  })
})
