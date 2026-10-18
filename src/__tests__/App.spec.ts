import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import App from '../App.vue'

describe('App', () => {
  it('shows the whole tree with stock costs and no files loaded', () => {
    const wrapper = mount(App)
    expect(wrapper.find('h1').text()).toContain('Long War')
    expect(wrapper.findAll('[data-tech]')).toHaveLength(75)
    expect(wrapper.text()).toContain('never uploaded')
  })

  it('opens the detail panel when a tech is selected', async () => {
    const wrapper = mount(App)
    const node = wrapper.find('[data-tech="24"]')
    await node.trigger('keydown', { key: 'Enter' })
    const panel = wrapper.find('aside')
    expect(panel.text()).toContain('Plasma Weapons')
    expect(panel.text()).toContain('Requires all of')
    expect(panel.text()).toContain('Alien Weaponry')
  })
})
