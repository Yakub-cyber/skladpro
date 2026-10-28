import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSeed } from '../store/seed'
import SaleTab from '../../features/operations/tabs/SaleTab'
import NewOrderPage from '../../features/orders/NewOrderPage'

const h = vi.hoisted(() => ({ state: null }))
vi.mock('@/shared/store/useStore', () => {
  const useStore = selector => selector ? selector(h.state) : h.state
  useStore.getState = () => h.state
  return { useStore }
})
beforeEach(() => {
  vi.stubGlobal('React', React)
  h.state = { ...makeSeed(), warehouses: [{ id: 'A', name: 'Warehouse A' }, { id: 'B', name: 'Warehouse B' }, { id: 'old', name: 'Archived warehouse', active: false }] }
})
afterEach(() => vi.unstubAllGlobals())
describe('sale forms expose an explicit warehouse', () => {
  it.each([['SaleTab', SaleTab], ['NewOrderPage', NewOrderPage]])('%s offers A/B and an empty selection, excluding archived warehouses', (_name, Form) => {
    const markup = renderToStaticMarkup(<MemoryRouter><Form /></MemoryRouter>)
    expect(markup).toContain('aria-label="Склад продажи"')
    expect(markup).toContain('value="" selected=""')
    expect(markup).toContain('Warehouse A'); expect(markup).toContain('Warehouse B')
    expect(markup).not.toContain('Archived warehouse')
  })
})
