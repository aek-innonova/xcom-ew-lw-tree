<script setup lang="ts">
// A soldier in 3D (features/game-soldiers.md): the meshes and textures read
// from the player's install (state/soldier.ts), drawn with WebGL, turned by
// dragging. Our own simple shader, not the game's: the armor's top and
// bottom colors go through its tint masks, the hair's color through its
// template; the lighting is plain.

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Color } from '@/model/material'
import type { Soldier, Texture } from '@/state/soldier'

const props = defineProps<{
  soldier: Soldier | null
  /** The armor's top and bottom colors (linear), or null for the armor's own. */
  top: Color | null
  bottom: Color | null
  /** The hair's color (linear), or null for the hair's own. */
  hair?: Color | null
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let gl: WebGL2RenderingContext | null = null
let program: WebGLProgram | null = null
let yaw = 0.35
let distance = 1
let frame = 0
interface Upload {
  vao: WebGLVertexArrayObject
  count: number
  type: number
  sections: { first: number; count: number; paint: number }[]
}
let uploads: { upload: Upload; meshIndex: number }[] = []
const texCache = new WeakMap<Texture, WebGLTexture>()

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vN; varying vec2 vUV;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vN = (uModel * vec4(aNrm, 0.0)).xyz; vUV = aUV; }`
const FS = `
precision mediump float;
uniform sampler2D uDif; uniform sampler2D uMask;
uniform int uKind; uniform bool uHasDif; uniform bool uHasMask;
uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uColor; uniform vec2 uMeans;
varying vec3 vN; varying vec2 vUV;
void main() {
  vec4 d = uHasDif ? texture2D(uDif, vUV) : vec4(0.55, 0.55, 0.55, 1.0);
  vec3 c = d.rgb;
  if (uKind == 0 && uHasMask) {
    vec4 m = texture2D(uMask, vUV);
    float l = dot(c, vec3(0.3, 0.59, 0.11));
    // The masked parts take the color, keeping the texture's detail: scaled
    // so each part's average is the color itself.
    // The top color has the say where both masks are (Titan, Ghost and
    // Archangel lay the second inside the first; Kevlar and Carapace keep
    // them apart, as Long War's picture of the colors shows).
    c = mix(c, uBottom * l / uMeans.y, m.b * (1.0 - m.a));
    c = mix(c, uTop * l / uMeans.x, m.a);
  }
  // Skin: the head's one generic texture, colored by the skin's own color where its mask says skin.
  if (uKind == 1) {
    float skin = uHasMask ? texture2D(uMask, vUV).b : 1.0;
    c = mix(c, c * uColor * 1.3, skin);
  }
  if (uKind == 2) { if (d.a < 0.35) discard; c = d.r * uColor * 1.5; }
  vec3 n = normalize(vN);
  float li = 0.38 + 0.68 * max(dot(n, normalize(vec3(0.45, 0.7, 0.6))), 0.0)
    + 0.22 * max(dot(n, normalize(vec3(-0.7, -0.2, 0.25))), 0.0);
  gl_FragColor = vec4(c * li, 1.0);
}`

const srgb = (c: Color | null): [number, number, number] | null =>
  c
    ? ([0, 1, 2].map((k) => Math.pow(Math.max(0, c[k]!), 1 / 2.2)) as [number, number, number])
    : null

/** The texture's average brightness under each tint mask (top, bottom), once per texture pair. */
const means = new WeakMap<Texture, [number, number]>()
function maskMeans(dif: Texture | null, mask: Texture | null): [number, number] {
  if (!dif || !mask) return [0.5, 0.5]
  const have = means.get(mask)
  if (have) return have
  let sa = 0
  let wa = 0
  let sb = 0
  let wb = 0
  for (let y = 0; y < mask.height; y += 2)
    for (let x = 0; x < mask.width; x += 2) {
      const mi = 4 * (y * mask.width + x)
      const di =
        4 *
        (Math.floor((y * dif.height) / mask.height) * dif.width +
          Math.floor((x * dif.width) / mask.width))
      const l = (0.3 * dif.rgba[di]! + 0.59 * dif.rgba[di + 1]! + 0.11 * dif.rgba[di + 2]!) / 255
      const a = mask.rgba[mi + 3]! / 255
      const b = (mask.rgba[mi + 2]! / 255) * (1 - a)
      sa += l * a
      wa += a
      sb += l * b
      wb += b
    }
  const out: [number, number] = [
    wa ? Math.max(0.05, sa / wa) : 0.5,
    wb ? Math.max(0.05, sb / wb) : 0.5,
  ]
  means.set(mask, out)
  return out
}

function compile() {
  const g = gl!
  const sh = (type: number, src: string) => {
    const s = g.createShader(type)!
    g.shaderSource(s, src)
    g.compileShader(s)
    if (!g.getShaderParameter(s, g.COMPILE_STATUS))
      throw new Error(g.getShaderInfoLog(s) ?? 'shader')
    return s
  }
  const p = g.createProgram()!
  g.attachShader(p, sh(g.VERTEX_SHADER, VS))
  g.attachShader(p, sh(g.FRAGMENT_SHADER, FS))
  g.bindAttribLocation(p, 0, 'aPos')
  g.bindAttribLocation(p, 1, 'aNrm')
  g.bindAttribLocation(p, 2, 'aUV')
  g.linkProgram(p)
  program = p
}

function glTexture(t: Texture | null): WebGLTexture | null {
  if (!t || !gl) return null
  const have = texCache.get(t)
  if (have) return have
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.width, t.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.rgba)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  texCache.set(t, tex)
  return tex
}

function upload() {
  const g = gl
  if (!g) return
  uploads = []
  props.soldier?.meshes.forEach((dm, meshIndex) => {
    const m = dm.mesh
    const vao = g.createVertexArray()!
    g.bindVertexArray(vao)
    const buf = (data: Float32Array, loc: number, size: number) => {
      const b = g.createBuffer()
      g.bindBuffer(g.ARRAY_BUFFER, b)
      g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW)
      g.enableVertexAttribArray(loc)
      g.vertexAttribPointer(loc, size, g.FLOAT, false, 0, 0)
    }
    buf(m.positions, 0, 3)
    buf(m.normals, 1, 3)
    buf(m.uvs, 2, 2)
    const ib = g.createBuffer()
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ib)
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, m.indices, g.STATIC_DRAW)
    g.bindVertexArray(null)
    uploads.push({
      meshIndex,
      upload: {
        vao,
        count: m.indices.length,
        type: m.indices instanceof Uint32Array ? g.UNSIGNED_INT : g.UNSIGNED_SHORT,
        sections: m.sections.map((s, i) => ({
          first: s.firstIndex,
          count: s.triangles * 3,
          paint: i,
        })),
      },
    })
  })
  draw()
}

// Column-major 4×4 matrices.
type M4 = Float32Array
const mul = (a: M4, b: M4): M4 => {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!
  return o
}
const perspective = (fov: number, aspect: number, near: number, far: number): M4 => {
  const f = 1 / Math.tan(fov / 2)
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ])
}

function draw() {
  const g = gl
  const c = canvas.value
  if (!g || !c || !program) return
  const w = (c.width = c.clientWidth * devicePixelRatio)
  const h = (c.height = c.clientHeight * devicePixelRatio)
  g.viewport(0, 0, w, h)
  g.clearColor(0.03, 0.07, 0.11, 1)
  g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT)
  g.enable(g.DEPTH_TEST)
  g.useProgram(program)
  // The game's space: z up, the soldier facing +y, 0 to 128 tall; turned by
  // yaw about z, seen from the front.
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const model = new Float32Array([cy, sy, 0, 0, -sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  // Game (x, y, z) to camera (x, z, -y... looking along −y): the camera sits in front.
  const toCam = new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, -64, -230 * distance, 1])
  const mvp = mul(perspective(0.6, w / h, 10, 2000), mul(toCam, model))
  const u = (n: string) => g.getUniformLocation(program!, n)
  g.uniformMatrix4fv(u('uMVP'), false, mvp)
  g.uniformMatrix4fv(u('uModel'), false, mul(toCam, model))
  g.uniform1i(u('uDif'), 0)
  g.uniform1i(u('uMask'), 1)
  for (const { upload: up, meshIndex } of uploads) {
    const dm = props.soldier!.meshes[meshIndex]!
    g.bindVertexArray(up.vao)
    for (const s of up.sections) {
      const paint = dm.paints[s.paint]
      if (!paint) continue
      const kind = { armor: 0, skin: 1, hair: 2, plain: 3 }[paint.kind]
      g.uniform1i(u('uKind'), kind)
      const dif = glTexture(paint.diffuse)
      const mask = glTexture(paint.mask)
      g.activeTexture(g.TEXTURE0)
      g.bindTexture(g.TEXTURE_2D, dif)
      g.activeTexture(g.TEXTURE1)
      g.bindTexture(g.TEXTURE_2D, mask)
      g.uniform1i(u('uHasDif'), dif ? 1 : 0)
      g.uniform1i(u('uHasMask'), mask ? 1 : 0)
      g.uniform3fv(u('uTop'), srgb(props.top) ?? srgb(paint.primary)!)
      g.uniform3fv(u('uBottom'), srgb(props.bottom) ?? srgb(paint.secondary)!)
      g.uniform3fv(
        u('uColor'),
        (paint.kind === 'hair' ? srgb(props.hair ?? null) : null) ?? srgb(paint.primary)!,
      )
      g.uniform2fv(u('uMeans'), maskMeans(paint.diffuse, paint.mask))
      g.drawElements(g.TRIANGLES, s.count, up.type, s.first * (up.type === g.UNSIGNED_INT ? 4 : 2))
    }
  }
  g.bindVertexArray(null)
}

function schedule() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(draw)
}

let dragging = false
let lastX = 0
function down(e: PointerEvent) {
  dragging = true
  lastX = e.clientX
  canvas.value?.setPointerCapture(e.pointerId)
}
function move(e: PointerEvent) {
  if (!dragging) return
  yaw += (e.clientX - lastX) * 0.01
  lastX = e.clientX
  schedule()
}
function wheel(e: WheelEvent) {
  distance = Math.min(2, Math.max(0.45, distance * (e.deltaY > 0 ? 1.1 : 0.9)))
  schedule()
}

onMounted(() => {
  gl = canvas.value?.getContext('webgl2', { antialias: true }) ?? null
  if (!gl) return
  compile()
  upload()
  addEventListener('resize', schedule)
})
onBeforeUnmount(() => removeEventListener('resize', schedule))
watch(() => props.soldier, upload)
watch(() => [props.top, props.bottom, props.hair], schedule)
</script>

<template>
  <canvas
    ref="canvas"
    class="soldier"
    aria-label="The soldier, turned by dragging"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="dragging = false"
    @wheel.prevent="wheel"
  />
</template>

<style scoped>
.soldier {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  touch-action: none;
}
</style>
