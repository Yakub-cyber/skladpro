import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RouteImportBoundary from './RouteImportBoundary'

afterEach(() => vi.unstubAllGlobals())
describe('critical route import recovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: /assets/OrdersPage-abcd.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
    'Unable to preload CSS for /assets/cash-abcd.css',
  ])('recognizes a recoverable module loading failure: %s', (message) => {
    expect(RouteImportBoundary.isImportError(new TypeError(message))).toBe(true)
  })
  it('shows controlled loading failure and leaves application errors to the outer boundary', () => {
    const boundary = new RouteImportBoundary({ children: <span>Result loaded</span> })
    expect(renderToStaticMarkup(boundary.render())).toContain('Result loaded')
    boundary.state = RouteImportBoundary.getDerivedStateFromError(new TypeError('Failed to fetch dynamically imported module'))
    const markup = renderToStaticMarkup(boundary.render())
    expect(markup).toContain('role="alert"'); expect(markup).toContain('Повторить загрузку')
    expect(markup).not.toContain('Что-то пошло не так')
    const error = new TypeError('Cannot read properties of undefined')
    boundary.state = RouteImportBoundary.getDerivedStateFromError(error)
    expect(() => boundary.render()).toThrow(error)
  })
  it('retry reloads the same result URL without invoking a business action', () => {
    const reload = vi.fn(), href = 'https://test.invalid/#/orders?id=saved-sale'
    vi.stubGlobal('window', { location: { href, reload } })
    const boundary = new RouteImportBoundary({ children: null })
    boundary.retry()
    expect(reload).toHaveBeenCalledOnce(); expect(window.location.href).toBe(href)
  })
})
