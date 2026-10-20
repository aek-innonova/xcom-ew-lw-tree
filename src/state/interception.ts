// The game's own interception screen art (gfxInterception_SF.upk), for the
// air war's fights in the desktop app (features/air-war.md): the holographic
// jets and UFOs, each weapon's projectile and the explosions, the Aim, Dodge,
// Track (Boost) and Abort buttons, the screen's dot grid, brackets and scan lines. Null on the
// website, or where the install does not have them: the fights keep their
// own look then.

import data from '../../data/airwar.json'
import { gameImages, pictureUrl } from './gameimages'

const at = (name: string) => pictureUrl(`gfxInterception.${name}`)

/** A UFO's hologram by the image number the game gives its class. */
const UFOS: Record<number, string> = {
  80: 'alien_smallscout',
  81: 'alien_largescout',
  82: 'alien_abductor',
  83: 'alien_supplyship',
  84: 'alien_battleship',
  85: 'alien_ethereal',
}
const image = (type: number) =>
  (data.ships as { id: number; image?: number }[]).find((s) => s.id === type)?.image

/** A projectile picture: standing upright in the game's art, so turned along its flight. */
export interface Projectile {
  src: string
  width: number
  height: number
  upright: boolean
}

/** Each weapon's projectile, by the weapon's id (data/airwar.json). */
const PROJECTILES: Record<number, [name: string, width: number, height: number, upright: boolean]> =
  {
    1: ['phoenix', 22, 22, true], // Phoenix Cannon: tracers
    2: ['missile', 8, 30, true], // Stingray
    3: ['missile', 9, 34, true], // Avalanche
    4: ['laser_charge', 22, 22, false], // Laser Cannon
    5: ['plasma', 10, 40, true], // Plasma Cannon
    6: ['empProjectile', 20, 20, false], // EMP Cannon
    7: ['fusionlanceProjectile', 22, 22, false], // Fusion Lance
    8: ['plasma', 9, 36, true], // UFO Weapon I
    9: ['plasma', 11, 44, true], // UFO Weapon II
    10: ['fusionlanceProjectile', 22, 22, false], // UFO Fusion Lance
  }

export interface InterceptionArt {
  /** A ship's hologram; "turned": the Firestorm's art stands upright and is turned to fly. */
  ship: (type: number, hit?: boolean) => { src: string; turned: boolean } | null
  shot: string
  /** A weapon's projectile, else the glow (`shot`). */
  projectile: (weapon: number) => Projectile
  hitUfo: string | null
  hitJet: string | null
  grid: string | null
  scan: string | null
  bracketLeft: string | null
  bracketRight: string | null
  /** Aim, Dodge, Boost (the game's "Track": UFO Tracking) and Abort, as the game draws them. */
  button: (
    kind: 'aim' | 'dodge' | 'boost' | 'abort',
    state: 'ready' | 'active' | 'disabled',
  ) => string | null
  glow: string | null
}

/** The art, when the install has it (read again as the game's pictures come and go). */
export function interceptionArt(): InterceptionArt | null {
  if (gameImages.version < 0 || !gameImages.ready) return null
  const shot = at('empProjectile')
  const jet = at('interceptor0000')
  if (!shot || !jet) return null
  return {
    ship: (type, hit) => {
      const img = image(type)
      if (img === 68) return { src: jet, turned: false }
      if (img === 69) {
        const src = at(hit ? 'firestorm_red_small' : 'firestorm_cyan_small')
        return src ? { src, turned: true } : null
      }
      const ufo = img !== undefined ? UFOS[img] : undefined
      const src = ufo ? at(ufo) : null
      return src ? { src, turned: false } : null
    },
    shot,
    projectile: (weapon) => {
      const p = PROJECTILES[weapon]
      const src = p ? at(p[0]) : null
      return p && src
        ? { src, width: p[1], height: p[2], upright: p[3] }
        : { src: shot, width: 18, height: 18, upright: false }
    },
    hitUfo: at('cyan_explosion_small'),
    hitJet: at('explosion_sphere_small'),
    grid: at('grid_dots_small'),
    scan: at('InterlaceLines'),
    bracketLeft: at('background_left_bracket'),
    bracketRight: at('background_right_bracket'),
    button: (kind, state) => {
      if (kind === 'abort') return at('Abort')
      const name = { aim: 'aim', dodge: 'dodge', boost: 'track' }[kind]
      const ready = { aim: 'Aim', dodge: 'dodge', boost: 'Track' }[kind]
      return at(state === 'ready' ? ready : `${name}_${state}`)
    },
    glow: at('active_glow'),
  }
}
