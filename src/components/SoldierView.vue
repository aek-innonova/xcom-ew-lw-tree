<script setup lang="ts">
// A soldier in 3D (features/game-soldiers.md): the meshes and textures read
// from the player's install (state/soldier.ts), drawn with WebGL, turned by
// dragging. Our own simple shader, not the game's: the armor's top and
// bottom colors go through its tint masks, the hair's color through its
// template; the lighting is plain. It breathes in the barracks idle while on
// screen, unless the system asks for less motion or there is no GPU (drawn in
// software, 30 frames a second cost a machine about 2.6 cores).

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
  /** Positions, normals and tangents: replaced as the soldier moves. */
  moving: [WebGLBuffer, WebGLBuffer, WebGLBuffer]
  /** Every buffer, to let go of when another soldier comes. */
  buffers: WebGLBuffer[]
}
let uploads: { upload: Upload; meshIndex: number }[] = []
const texCache = new WeakMap<Texture, WebGLTexture>()

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV; attribute vec4 aTan;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vN; varying vec2 vUV; varying vec4 vT;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vN = (uModel * vec4(aNrm, 0.0)).xyz;
  vT = vec4((uModel * vec4(aTan.xyz, 0.0)).xyz, aTan.w);
  vUV = aUV;
}`
const FS = `
precision mediump float;
uniform sampler2D uDif; uniform sampler2D uMask; uniform sampler2D uNrm; uniform bool uHasNrm;
uniform int uKind; uniform bool uHasDif; uniform bool uHasMask;
uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uColor; uniform vec2 uMeans;
uniform vec3 uGlow; uniform bool uHasGlow;
varying vec3 vN; varying vec2 vUV; varying vec4 vT;
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
    // them apart).
    c = mix(c, uBottom * l / uMeans.y, m.b * (1.0 - m.a));
    c = mix(c, uTop * l / uMeans.x, m.a);
  }
  // Skin: the head's one generic texture, colored by the skin's own color where its mask says skin.
  if (uKind == 1) {
    float skin = uHasMask ? texture2D(uMask, vUV).b : 1.0;
    c = mix(c, c * uColor * 1.3, skin);
  }
  if (uKind == 2) { if (d.a < 0.35) discard; c = d.r * uColor * 1.5; }
  // The eye shade layer: not drawn (the skin texture paints the eyes).
  if (uKind == 4) discard;
  vec3 n = normalize(vN);
  if (uHasNrm) {
    // The normal map, in the surface's own frame (tangent, bitangent, normal).
    vec3 t = normalize(vT.xyz - n * dot(n, vT.xyz));
    vec3 b = cross(n, t) * vT.w;
    vec3 m = texture2D(uNrm, vUV).rgb * 2.0 - 1.0;
    n = normalize(t * m.x + b * m.y + n * max(m.z, 0.2));
  }
  float li = 0.38 + 0.68 * max(dot(n, normalize(vec3(0.45, 0.7, 0.6))), 0.0)
    + 0.22 * max(dot(n, normalize(vec3(-0.7, -0.2, 0.25))), 0.0);
  // A highlight where the specular map says the surface shines (armor: its red channel).
  float shine = (uKind == 0 && uHasMask) ? texture2D(uMask, vUV).r : (uKind == 1 ? 0.15 : 0.05);
  vec3 h = normalize(normalize(vec3(0.45, 0.7, 0.6)) + vec3(0.0, 0.0, 1.0));
  float spec = shine * pow(max(dot(n, h), 0.0), 28.0) * 0.9;
  // Lights on the armor glow where the specular map's green says, unlit: in the
  // material's glow color, else the texture's own.
  float g = (uKind == 0 && uHasMask) ? texture2D(uMask, vUV).g : 0.0;
  vec3 glow = g * (uHasGlow ? uGlow * 0.5 : d.rgb * 1.5);
  gl_FragColor = vec4(c * li + vec3(spec) + glow, 1.0);
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
  g.bindAttribLocation(p, 3, 'aTan')
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
  for (const { upload: up } of uploads) {
    g.deleteVertexArray(up.vao)
    up.buffers.forEach((b) => g.deleteBuffer(b))
  }
  uploads = []
  props.soldier?.meshes.forEach((dm, meshIndex) => {
    const m = dm.mesh
    const buffers: WebGLBuffer[] = []
    const vao = g.createVertexArray()!
    g.bindVertexArray(vao)
    const buf = (data: Float32Array, loc: number, size: number, usage: number = g.STATIC_DRAW) => {
      const b = g.createBuffer()
      buffers.push(b)
      g.bindBuffer(g.ARRAY_BUFFER, b)
      g.bufferData(g.ARRAY_BUFFER, data, usage)
      g.enableVertexAttribArray(loc)
      g.vertexAttribPointer(loc, size, g.FLOAT, false, 0, 0)
      return b
    }
    const moving: Upload['moving'] = [
      buf(m.positions, 0, 3, g.DYNAMIC_DRAW),
      buf(m.normals, 1, 3, g.DYNAMIC_DRAW),
      buf(m.tangents, 3, 4, g.DYNAMIC_DRAW),
    ]
    buf(m.uvs, 2, 2)
    const ib = g.createBuffer()
    buffers.push(ib)
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
        moving,
        buffers,
      },
    })
  })
  started = performance.now()
  draw()
  animate()
}

// The idle: about 30 times a second, only while the soldier is on screen.
let started = 0
let shown = true
let lastStep = 0
let ticking = 0
const still = matchMedia('(prefers-reduced-motion: reduce)')
let software = false
function animate() {
  cancelAnimationFrame(ticking)
  if (!props.soldier?.at || !shown || still.matches || software) return
  ticking = requestAnimationFrame(step)
}
function step(now: number) {
  const g = gl
  const at = props.soldier?.at
  if (!g || !at || !shown) return
  if (now - lastStep >= 33) {
    lastStep = now
    const meshes = at((now - started) / 1000)
    for (const { upload: up, meshIndex } of uploads) {
      const m = meshes[meshIndex]
      if (!m) continue
      const data = [m.positions, m.normals, m.tangents]
      up.moving.forEach((b, k) => {
        g.bindBuffer(g.ARRAY_BUFFER, b)
        g.bufferSubData(g.ARRAY_BUFFER, 0, data[k]!)
      })
    }
    draw()
  }
  ticking = requestAnimationFrame(step)
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
  // Zoomed in, the view rises from the middle of the body to the face.
  const closer = Math.min(1, Math.max(0, (1 - distance) / (1 - 0.45)))
  const look = 64 + closer * 46
  const toCam = new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, -look, -230 * distance, 1])
  const mvp = mul(perspective(0.6, w / h, 10, 2000), mul(toCam, model))
  const u = (n: string) => g.getUniformLocation(program!, n)
  g.uniformMatrix4fv(u('uMVP'), false, mvp)
  g.uniformMatrix4fv(u('uModel'), false, mul(toCam, model))
  g.uniform1i(u('uDif'), 0)
  g.uniform1i(u('uMask'), 1)
  g.uniform1i(u('uNrm'), 2)
  for (const { upload: up, meshIndex } of uploads) {
    const dm = props.soldier!.meshes[meshIndex]!
    g.bindVertexArray(up.vao)
    for (const s of up.sections) {
      const paint = dm.paints[s.paint]
      if (!paint) continue
      const kind = { armor: 0, skin: 1, hair: 2, plain: 3, lashes: 4 }[paint.kind]
      g.uniform1i(u('uKind'), kind)
      // All three made before any is bound: making one binds it to the active unit.
      const dif = glTexture(paint.diffuse)
      const mask = glTexture(paint.mask)
      const nrm = glTexture(paint.normal)
      g.activeTexture(g.TEXTURE0)
      g.bindTexture(g.TEXTURE_2D, dif)
      g.activeTexture(g.TEXTURE1)
      g.bindTexture(g.TEXTURE_2D, mask)
      g.activeTexture(g.TEXTURE2)
      g.bindTexture(g.TEXTURE_2D, nrm)
      g.uniform1i(u('uHasNrm'), nrm ? 1 : 0)
      g.uniform1i(u('uHasDif'), dif ? 1 : 0)
      g.uniform1i(u('uHasMask'), mask ? 1 : 0)
      g.uniform3fv(u('uTop'), srgb(props.top) ?? srgb(paint.primary)!)
      g.uniform3fv(u('uBottom'), srgb(props.bottom) ?? srgb(paint.secondary)!)
      g.uniform3fv(
        u('uColor'),
        (paint.kind === 'hair' ? srgb(props.hair ?? null) : null) ?? srgb(paint.primary)!,
      )
      g.uniform2fv(u('uMeans'), maskMeans(paint.diffuse, paint.mask))
      g.uniform1i(u('uHasGlow'), paint.glow ? 1 : 0)
      g.uniform3fv(u('uGlow'), srgb(paint.glow ?? null) ?? [0, 0, 0])
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
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
  software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|warp/i.test(renderer)
  compile()
  upload()
  addEventListener('resize', schedule)
  seen = new IntersectionObserver(([e]) => {
    shown = e?.isIntersecting ?? true
    animate()
  })
  if (canvas.value) seen.observe(canvas.value)
  still.addEventListener('change', animate)
})
let seen: IntersectionObserver | null = null
onBeforeUnmount(() => {
  removeEventListener('resize', schedule)
  still.removeEventListener('change', animate)
  seen?.disconnect()
  cancelAnimationFrame(ticking)
})
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
