import { describe, expect, it } from 'vitest'
import { collectOfflineResources } from '../../../scripts/offlineManifest'

function bundle(hash = 'one') {
  const chunk = (name, module, imports = [], entry = false, css = []) => ({ type: 'chunk', fileName: name,
    isEntry: entry, modules: { ['D:/project/' + module]: {} }, imports,
    viteMetadata: { importedCss: new Set(css), importedAssets: new Set() } })
  return {
    [`entry-${hash}.js`]: chunk(`entry-${hash}.js`, 'src/main.jsx', ['common.js'], true, ['app.css']),
    [`cash-${hash}.js`]: chunk(`cash-${hash}.js`, 'src/features/orders/NewOrderPage.jsx', ['common.js']),
    [`orders-${hash}.js`]: chunk(`orders-${hash}.js`, 'src/features/orders/OrdersPage.jsx', [`cash-${hash}.js`]),
    [`edit-${hash}.js`]: chunk(`edit-${hash}.js`, 'src/features/orders/EditOrderPage.jsx', ['common.js']),
    [`operations-${hash}.js`]: chunk(`operations-${hash}.js`, 'src/features/operations/OperationsPage.jsx', [`sale-form-${hash}.js`]),
    [`sale-form-${hash}.js`]: chunk(`sale-form-${hash}.js`, 'src/features/operations/tabs/SaleTab.jsx', ['common.js']),
    'common.js': chunk('common.js', 'src/shared/ui/index.js'),
    'delivery.js': chunk('delivery.js', 'src/features/delivery/DeliveryPage.jsx'),
    'analytics.js': chunk('analytics.js', 'src/features/analytics/AnalyticsPage.jsx'),
    'app.css': { type: 'asset', fileName: 'app.css' },
  }
}
describe('production offline manifest', () => {
  it('includes shell, critical route dependencies and CSS without unrelated routes', () => {
    const resources = collectOfflineResources(bundle())
    expect(resources).toEqual(expect.arrayContaining(['./index.html', './entry-one.js', './cash-one.js', './orders-one.js', './operations-one.js', './sale-form-one.js', './common.js', './app.css']))
    expect(resources).toContain('./delivery.js')
    expect(resources).not.toContain('./analytics.js')
    expect(resources).toContain('./edit-one.js')
    expect(new Set(resources).size).toBe(resources.length)
  })
  it('resolves changed hashes from each build, including referenced assets and cycles', () => {
    const output = bundle('two')
    output['common.js'].imports = ['entry-two.js']
    output['common.js'].viteMetadata.importedAssets.add('font.woff2')
    output['font.woff2'] = { type: 'asset', fileName: 'font.woff2' }
    const resources = collectOfflineResources(output)
    expect(resources).toContain('./font.woff2'); expect(resources).toContain('./orders-two.js')
    expect(resources).not.toContain('./orders-one.js')
  })
  it('refuses a build with a missing critical route or dependency', () => {
    const output = bundle(); delete output['orders-one.js']
    expect(() => collectOfflineResources(output)).toThrow('critical offline route')
    const broken = bundle(); delete broken['common.js']
    expect(() => collectOfflineResources(broken)).toThrow('build dependency')
    const noSaleForm = bundle(); delete noSaleForm['sale-form-one.js']
    expect(() => collectOfflineResources(noSaleForm)).toThrow('build dependency')
  })
})
