/**
 * The noises, synthesised rather than carried.
 *
 * Measured before deciding: the eighteen sounds a game like this needs are 356
 * KiB inside a real file and 246 KiB gzipped, because eight-bit PCM is close to
 * incompressible. The whole page is seventy-five. Carrying them would make the
 * download four times what the game is, to say things that are a burst of
 * filtered noise and a falling tone -- so these are built out of an oscillator
 * and a noise buffer instead, which costs a few hundred bytes of code.
 *
 * That is a different decision from the art, and deliberately so. A creature's
 * shape cannot be synthesised: it is the thing itself, and what it looks like is
 * most of what it is. A shotgun is a transient with a bright attack and a fast
 * decay, and an approximation of that reads as a shotgun.
 *
 * Nothing here knows about the game. It is asked for a named noise and makes
 * it; what happens in the world is the caller's business, which keeps this
 * testable and keeps the frame loop free of envelope arithmetic.
 */

/** The noises the game can ask for. */
export type Noise =
  | 'sidearm'
  | 'scattergun'
  | 'launcher'
  | 'blast'
  | 'hurt'
  | 'die'
  | 'creatureHurt'
  | 'creatureDie'
  | 'door'
  | 'switch'
  | 'pickup'
  | 'weaponUp'
  | 'teleport'
  | 'noAmmo'

interface Shape {
  /** Seconds the whole thing lasts. */
  readonly length: number
  /** How much of it is noise rather than tone, 0 to 1. */
  readonly grit: number
  /** Tone at the start and at the end, in hertz. */
  readonly from: number
  readonly to: number
  /** Peak loudness, 0 to 1, before the master level. */
  readonly level: number
  /** Low-pass corner, which is most of what makes one burst differ from another. */
  readonly cutoff: number
}

/**
 * What each one is made of.
 *
 * Chosen by ear against the originals rather than derived: a pistol is a short
 * bright tick, a shotgun is longer and darker, a rocket going off is long, dark
 * and almost all noise. The tones fall rather than rise because nearly every
 * percussive sound in the world does.
 */
const SHAPES: Record<Noise, Shape> = {
  sidearm: { length: 0.12, grit: 0.7, from: 420, to: 140, level: 0.5, cutoff: 3200 },
  scattergun: { length: 0.3, grit: 0.85, from: 300, to: 70, level: 0.7, cutoff: 2200 },
  launcher: { length: 0.36, grit: 0.6, from: 260, to: 60, level: 0.7, cutoff: 1600 },
  blast: { length: 0.7, grit: 0.95, from: 180, to: 40, level: 0.9, cutoff: 900 },
  hurt: { length: 0.22, grit: 0.4, from: 300, to: 180, level: 0.55, cutoff: 1800 },
  die: { length: 0.9, grit: 0.5, from: 260, to: 70, level: 0.8, cutoff: 1400 },
  creatureHurt: { length: 0.18, grit: 0.55, from: 500, to: 300, level: 0.35, cutoff: 2600 },
  creatureDie: { length: 0.6, grit: 0.6, from: 380, to: 90, level: 0.5, cutoff: 1500 },
  door: { length: 0.5, grit: 0.35, from: 120, to: 90, level: 0.35, cutoff: 800 },
  switch: { length: 0.1, grit: 0.25, from: 900, to: 700, level: 0.4, cutoff: 4000 },
  pickup: { length: 0.14, grit: 0.05, from: 700, to: 1200, level: 0.35, cutoff: 6000 },
  weaponUp: { length: 0.25, grit: 0.1, from: 400, to: 900, level: 0.45, cutoff: 6000 },
  teleport: { length: 0.45, grit: 0.3, from: 180, to: 1400, level: 0.45, cutoff: 5000 },

  noAmmo: { length: 0.07, grit: 0.3, from: 200, to: 160, level: 0.25, cutoff: 1500 },
}

/** Everything the game can ask for, for a check to walk. */
export function noises(): Noise[] {
  return Object.keys(SHAPES) as Noise[]
}

/** What a shape is made of, so a check can ask without a browser. */
export function shapeOf(noise: Noise): Shape {
  return SHAPES[noise]
}

/**
 * Somewhere to make noises.
 *
 * An interface rather than the context itself, because the page owns when audio
 * is allowed to start -- a browser refuses to make a sound until somebody has
 * pressed something -- and because a check wants to count what was asked for
 * without a speaker in the room.
 */
export interface Speaker {
  play(noise: Noise, loudness?: number): void
}

/** A speaker that does nothing, for before the first key and for checks. */
export const SILENCE: Speaker = { play: () => undefined }

/**
 * A speaker backed by the Web Audio API.
 *
 * The noise buffer is made once and shared: it is a second of random numbers,
 * and making a fresh one per shot is the difference between a game that runs
 * and a game that stutters when a room of creatures opens fire.
 */
export function speakerFor(context: AudioContext, master = 0.25): Speaker {
  const seconds = 1
  const grain = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate)
  const grains = grain.getChannelData(0)
  for (let i = 0; i < grains.length; i++) grains[i] = Math.random() * 2 - 1

  return {
    play(noise, loudness = 1) {
      const shape = SHAPES[noise]
      const now = context.currentTime
      const end = now + shape.length

      const out = context.createGain()
      out.gain.setValueAtTime(shape.level * loudness * master, now)
      // Exponential, because a linear fade sounds like a fade and this should
      // sound like something stopping.
      out.gain.exponentialRampToValueAtTime(0.0001, end)

      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(shape.cutoff, now)
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, shape.cutoff / 6), end)
      filter.connect(out).connect(context.destination)

      if (shape.grit > 0) {
        const hiss = context.createBufferSource()
        hiss.buffer = grain
        hiss.loop = true
        // Start somewhere random in the buffer, or every shot is the same shot.
        hiss.playbackRate.value = 1
        const level = context.createGain()
        level.gain.value = shape.grit
        hiss.connect(level).connect(filter)
        hiss.start(now, Math.random() * (seconds - shape.length))
        hiss.stop(end)
      }

      if (shape.grit < 1) {
        const tone = context.createOscillator()
        tone.type = 'square'
        tone.frequency.setValueAtTime(shape.from, now)
        tone.frequency.exponentialRampToValueAtTime(Math.max(20, shape.to), end)
        const level = context.createGain()
        level.gain.value = 1 - shape.grit
        tone.connect(level).connect(filter)
        tone.start(now)
        tone.stop(end)
      }
    },
  }
}
