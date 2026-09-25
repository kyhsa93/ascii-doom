/**
 * Boot check for the deployment path.
 *
 * Deliberately the smallest thing that exercises every piece the real game
 * will stand on: the submoduled engine resolves, the presenter measures a real
 * font, a framebuffer fills, `resolve` picks glyphs from luminance, and a
 * request-animation-frame loop keeps drawing. Getting that far on GitHub Pages
 * is the expensive unknown here -- the renderer is the part I can test in Node.
 */
import type { Framebuffer } from '../vendor/ascii-engine/src/core/framebuffer.ts'
import { RAMPS } from '../vendor/ascii-engine/src/core/ramp.ts'
import { PreSurface } from '../vendor/ascii-engine/src/web/pre.ts'

const screen = document.getElementById('screen')!
const hint = document.getElementById('hint')!
const surface = new PreSurface(screen)

let framesThisSecond = 0
let totalFrames = 0
let last = performance.now()
let fps = 0

function draw(now: number): void {
  totalFrames++
  surface.measure()
  const fb: Framebuffer = surface.framebuffer()
  // The fourth argument matters and is easy to miss: `clear` fills the glyph
  // channel, `resolve` only touches cells still holding 0, and the default is
  // 32. Clearing to 32 means every cell is already decided and the ramp never
  // runs -- measured, a full screen of colour came out as zero glyphs.
  //
  // The engine's own demos want that: a rasterized triangle leaves 0 where it
  // drew, so the background stays blank. A first-person view is the opposite
  // case, because the picture covers the whole grid. Luminance 0 lands on the
  // ramp's first character, which is a space, so an empty part of the frame
  // still reads as empty.
  fb.clear(0, 0, 0, 0)

  const t = now / 1000
  const { width, height } = fb
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // A moving interference pattern: enough to show that colour, glyph and
      // geometry all arrive, and obviously not a game.
      const u = (x / width) * 2 - 1
      const v = (y / height) * 2 - 1
      const d = Math.hypot(u * 1.8, v)
      const wave = Math.sin(d * 9 - t * 2.2) * 0.5 + 0.5
      const shade = Math.max(0, wave * (1 - d * 0.6))
      const i = (y * width + x) * 3
      fb.color[i] = shade
      fb.color[i + 1] = shade * 0.62
      fb.color[i + 2] = shade * 0.3
    }
  }

  fb.resolve(RAMPS.short)
  surface.present(fb)

  framesThisSecond++
  if (now - last > 500) {
    fps = (framesThisSecond * 1000) / (now - last)
    framesThisSecond = 0
    last = now
    hint.textContent =
      `${fb.width}x${fb.height} cells · cell aspect ${surface.cellAspect.toFixed(3)} · ${fps.toFixed(0)} fps` +
      ' · engine boots, renderer next'
  }

  // A probe for the browser check, and for anyone wondering whether the page
  // is alive or merely painted once.
  ;(window as unknown as { __doom: Record<string, unknown> }).__doom = {
    cols: fb.width,
    rows: fb.height,
    cellAspect: surface.cellAspect,
    frames: totalFrames,
    fps,
  }

  requestAnimationFrame(draw)
}

requestAnimationFrame(draw)
