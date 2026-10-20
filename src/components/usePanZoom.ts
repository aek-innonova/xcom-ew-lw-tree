// Pan and zoom for a board (the research tree, the Foundry): drag to pan, wheel
// or buttons to zoom, fit to the space. The board refits when its space changes
// (window, detail panel) until the player pans or zooms; after that it stays
// where they put it. A click that was not a drag is handed to `onClick`.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { Geometry } from './geometry'
import { NODE_H, NODE_W } from './geometry'

const MIN_K = 0.25
const MAX_K = 2.5
const MARGIN = 16

export function usePanZoom(opts: {
  svg: Ref<SVGSVGElement | null>
  geo: Ref<Geometry>
  /** The selected node, kept in view when the space changes. */
  selected: () => number | null
  onClick: (target: Element) => void
}) {
  const { svg, geo } = opts
  const view = ref({ x: 0, y: 0, k: 1 })
  const panning = ref(false)
  let autoFit = true

  function size() {
    const r = svg.value?.getBoundingClientRect()
    return { w: r?.width ?? 1, h: r?.height ?? 1 }
  }

  function fit() {
    autoFit = true
    const { w, h } = size()
    const g = geo.value
    const k = Math.min(
      MAX_K,
      Math.max(MIN_K, Math.min((w - 2 * MARGIN) / g.width, (h - 2 * MARGIN) / g.height)),
    )
    view.value = { k, x: (w - g.width * k) / 2, y: Math.max(MARGIN, (h - g.height * k) / 2) }
  }

  /** Whether a node is wholly in view (inside the margin) at the current view. */
  function inView(id: number): boolean {
    const box = geo.value.nodes.get(id)
    if (!box) return false
    const { w, h } = size()
    const { x, y, k } = view.value
    const left = x + box.x * k
    const top = y + box.y * k
    return (
      left >= MARGIN &&
      top >= MARGIN &&
      left + NODE_W * k <= w - MARGIN &&
      top + NODE_H * k <= h - MARGIN
    )
  }

  /** Keeps the board's edges at the view's: no empty space panned into view. */
  function clamp(v: { x: number; y: number; k: number }) {
    const { w, h } = size()
    const g = geo.value
    const along = (pos: number, span: number, room: number) =>
      span + 2 * MARGIN <= room
        ? (room - span) / 2
        : Math.min(MARGIN, Math.max(room - MARGIN - span, pos))
    return { k: v.k, x: along(v.x, g.width * v.k, w), y: along(v.y, g.height * v.k, h) }
  }

  /**
   * Brings a node into view, after the detail panel (if it is opening) has
   * taken its space: left as it is when the node is already in view, else
   * centred, as far as the board's edges allow.
   */
  async function centerOn(id: number) {
    const box = geo.value.nodes.get(id)
    if (!box) return
    await nextTick()
    if (inView(id)) return
    autoFit = false
    const { w, h } = size()
    const k = Math.max(view.value.k, 0.9)
    view.value = clamp({
      k,
      x: w / 2 - (box.x + NODE_W / 2) * k,
      y: h / 2 - (box.y + NODE_H / 2) * k,
    })
  }

  function zoomAt(px: number, py: number, factor: number) {
    autoFit = false
    const { x, y, k } = view.value
    const nk = Math.min(MAX_K, Math.max(MIN_K, k * factor))
    const f = nk / k
    view.value = { k: nk, x: px - (px - x) * f, y: py - (py - y) * f }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const r = svg.value!.getBoundingClientRect()
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015))
  }

  function zoomBy(factor: number) {
    const { w, h } = size()
    zoomAt(w / 2, h / 2, factor)
  }

  let drag: { id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null =
    null

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    drag = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      vx: view.value.x,
      vy: view.value.y,
      moved: false,
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return
    const dx = e.clientX - drag.sx
    const dy = e.clientY - drag.sy
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    if (!drag.moved) svg.value?.setPointerCapture(e.pointerId)
    drag.moved = true
    panning.value = true
    autoFit = false
    view.value = { ...view.value, x: drag.vx + dx, y: drag.vy + dy }
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return
    const wasDrag = drag.moved
    drag = null
    panning.value = false
    if (!wasDrag) opts.onClick(e.target as Element)
  }

  /** Pans just enough to bring a node fully into view, if it is not. */
  function ensureVisible(id: number) {
    const box = geo.value.nodes.get(id)
    if (!box) return
    const { w, h } = size()
    const { x, y, k } = view.value
    const left = x + box.x * k
    const top = y + box.y * k
    const right = left + NODE_W * k
    const bottom = top + NODE_H * k
    let dx = 0
    let dy = 0
    if (left < MARGIN) dx = MARGIN - left
    else if (right > w - MARGIN) dx = w - MARGIN - right
    if (top < MARGIN) dy = MARGIN - top
    else if (bottom > h - MARGIN) dy = h - MARGIN - bottom
    if (dx || dy) view.value = { k, x: x + dx, y: y + dy }
  }

  watch(opts.selected, async (id) => {
    if (id === null || autoFit) return
    await nextTick()
    ensureVisible(id)
  })

  let resizeObserver: ResizeObserver | undefined
  onMounted(() => {
    fit()
    if (typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(() => {
      const sel = opts.selected()
      if (autoFit) fit()
      else if (sel !== null) ensureVisible(sel)
    })
    if (svg.value) resizeObserver.observe(svg.value)
  })
  onBeforeUnmount(() => resizeObserver?.disconnect())

  const transform = computed(
    () => `translate(${view.value.x},${view.value.y}) scale(${view.value.k})`,
  )

  return {
    view,
    panning,
    transform,
    fit,
    centerOn,
    zoomBy,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
