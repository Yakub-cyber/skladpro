const CRITICAL_MODULES = ['src/features/orders/NewOrderPage.jsx', 'src/features/orders/OrdersPage.jsx', 'src/features/orders/EditOrderPage.jsx', 'src/features/delivery/DeliveryPage.jsx', 'src/features/operations/OperationsPage.jsx']

// Resolve final names and dependencies from Rollup; keep hashed names out of source.
export function collectOfflineResources(bundle) {
  const resources = new Set(['./', './index.html', './favicon.svg', './manifest.webmanifest'])
  const visited = new Set()
  function visit(file) {
    if (visited.has(file)) return
    const output = bundle[file]
    if (!output) throw new Error('Missing offline build dependency: ' + file)
    visited.add(file); resources.add('./' + file)
    if (output.type !== 'chunk') return
    for (const dependency of output.imports) visit(dependency)
    for (const file of [...(output.viteMetadata?.importedCss || []), ...(output.viteMetadata?.importedAssets || [])]) visit(file)
  }
  const chunks = Object.values(bundle).filter((output) => output.type === 'chunk')
  for (const entry of chunks.filter((chunk) => chunk.isEntry)) visit(entry.fileName)
  for (const module of CRITICAL_MODULES) {
    const owners = chunks.filter((chunk) => Object.keys(chunk.modules).some((id) => id.replaceAll('\\', '/').endsWith('/' + module)))
    if (!owners.length) throw new Error('Missing critical offline route: ' + module)
    for (const chunk of owners) visit(chunk.fileName)
  }
  return [...resources].sort()
}
