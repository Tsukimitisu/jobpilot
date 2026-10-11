import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const worker = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8')
const manifest = JSON.parse(await readFile(new URL('../dist/manifest.webmanifest', import.meta.url), 'utf8'))
const routes = []
const events = new Map()
let precache = []
let skipCount = 0
const workbox = {
  precacheAndRoute(entries, options) { precache = entries; assert.equal(options.ignoreURLParametersMatching.length, 0) },
  cleanupOutdatedCaches() {},
  registerRoute(route) { routes.push(route) },
  createHandlerBoundToURL(url) { assert.equal(url, 'index.html'); return url },
  NavigationRoute: class { constructor(handler, options) { this.handler = handler; this.options = options } },
}
const define = (_dependencies, callback) => callback(workbox)
vm.runInNewContext(worker, { define, self: { define, addEventListener: (event, callback) => events.set(event, callback), skipWaiting: () => skipCount++ } })
assert.equal(skipCount, 0, 'update must not activate automatically')
assert.equal(routes.length, 1, 'no runtime cache routes permitted')
for (const entry of precache) {
  assert.match(entry.url, /^(?:assets\/[\w.-]+\.(?:js|css)|index\.html|manifest\.webmanifest|favicon\.svg|icon-(?:192|512)\.png|apple-touch-icon\.png)$/)
  assert.ok(!entry.url.includes('?') && !entry.url.includes('supabase'), 'only public build assets')
}
const allowed = routes[0].options.allowlist
for (const path of ['/rest/v1/owner_profiles', '/storage/v1/object/resumes/test.pdf', '/auth/v1/user', '/profile?token=private', '/resumes/file.pdf']) assert.ok(!allowed.some(regex => regex.test(path)), `must not intercept ${path}`)
for (const path of ['/dashboard', '/profile', '/resumes', '/login']) assert.ok(allowed.some(regex => regex.test(path)))
assert.equal(manifest.name, 'JobPilot')
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.start_url, '/dashboard')
assert.equal(manifest.theme_color, '#246344')
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const png = await readFile(new URL(`../dist/${file}`, import.meta.url))
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), size)
  assert.equal(png.readUInt32BE(20), size)
}
events.get('message')({ data: { type: 'SKIP_WAITING' } })
assert.equal(skipCount, 1, 'activation requires an explicit update message')
console.log(`PWA build verified: ${new Set(precache.map(entry => entry.url)).size} public precache assets, navigation-only fallback, no API/runtime caching, explicit update activation, valid PNG sizes.`)
