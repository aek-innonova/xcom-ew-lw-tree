// The game's own interception screen art (gfxInterception_SF.upk), for the
// air war's fights in the desktop app (features/air-war.md): the holographic
// jets and UFOs, the projectiles and explosions, the Aim, Dodge and Abort
// buttons, the screen's dot grid, brackets and scan lines. Null on the
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

export interface InterceptionArt {
  /** A ship's hologram; "turned": the Firestorm's art stands upright and is turned to fly. */
  ship: (type: number, hit?: boolean) => { src: string; turned: boolean } | null
  shot: string
  hitUfo: string | null
  hitJet: string | null
  grid: string | null
  scan: string | null
  bracketLeft: string | null
  bracketRight: string | null
  button: (kind: 'aim' | 'dodge' | 'abort', state: 'ready' | 'active' | 'disabled') => string | null
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
    hitUfo: at('cyan_explosion_small'),
    hitJet: at('explosion_sphere_small'),
    grid: at('grid_dots_small'),
    scan: at('InterlaceLines'),
    bracketLeft: at('background_left_bracket'),
    bracketRight: at('background_right_bracket'),
    button: (kind, state) => {
      if (kind === 'abort') return at('Abort')
      const base = kind === 'aim' ? 'Aim' : 'dodge'
      return at(state === 'ready' ? base : `${kind}_${state}`)
    },
    glow: at('active_glow'),
  }
}
