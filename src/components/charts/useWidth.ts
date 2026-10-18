// The rendered width of an element, kept up to date, so a chart can draw at its
// real pixel size (text stays the size it is set to, at any width).

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useWidth(el: Ref<HTMLElement | null>, fallback: number): Ref<number> {
  const width = ref(fallback)
  let ro: ResizeObserver | undefined
  onMounted(() => {
    if (!el.value) return
    width.value = el.value.clientWidth || fallback
    if (typeof ResizeObserver === 'undefined') return
    ro = new ResizeObserver(() => {
      if (el.value?.clientWidth) width.value = el.value.clientWidth
    })
    ro.observe(el.value)
  })
  onBeforeUnmount(() => ro?.disconnect())
  return width
}
