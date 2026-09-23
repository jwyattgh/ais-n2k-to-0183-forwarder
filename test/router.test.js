const test = require('node:test')
const assert = require('node:assert')
const EventEmitter = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

function fakeApp (dataDir) {
  const app = new EventEmitter()
  app.config = { version: '2.19.1', settings: {} }
  app.debug = () => {}
  app.error = () => {}
  app.getDataDirPath = () => dataDir
  app.getSelfPath = () => undefined
  app.setPluginStatus = () => {}
  app.setPluginError = () => {}
  app.signalk = { retrieve: () => ({}) }
  return app
}

function fakeRouter () {
  const routes = {}
  return { routes, get: (p, h) => { routes[p] = h } }
}

function call (handler, params, query) {
  return new Promise(resolve => {
    const res = {
      code: 200,
      status (c) { this.code = c; return this },
      type () { return this },
      json (body) { resolve({ code: this.code, body }) },
      send (body) { resolve({ code: this.code, body }) }
    }
    handler({ params, query }, res)
  })
}

test('status and log endpoints report the running streams', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-router-'))
  const app = fakeApp(dataDir)
  const plugin = require('..')(app)
  const router = fakeRouter()
  plugin.registerWithRouter(router)
  assert.deepStrictEqual(Object.keys(router.routes).sort(), ['/log/:name', '/status'])

  plugin.start({
    streams: [{ name: 'test', dryRun: true, connection: 'n2k', devices: ['c078c37ae76baa6d'] }]
  })
  try {
    const status = await call(router.routes['/status'], {}, {})
    assert.strictEqual(status.code, 200)
    assert.match(status.body.status, /^test: waiting to identify c078c37ae76baa6d/)
    assert.strictEqual(status.body.streams.length, 1)
    assert.strictEqual(status.body.streams[0].dryRun, true)
    assert.deepStrictEqual(status.body.streams[0].waitingFor, ['c078c37ae76baa6d'])

    // No log yet: empty body, not an error.
    let log = await call(router.routes['/log/:name'], { name: 'test' }, {})
    assert.strictEqual(log.code, 200)
    assert.strictEqual(log.body, '')

    fs.writeFileSync(status.body.streams[0].logPath, 'a\nb\nc\n')
    log = await call(router.routes['/log/:name'], { name: 'test' }, { lines: '2' })
    assert.strictEqual(log.body, 'b\nc\n')

    const missing = await call(router.routes['/log/:name'], { name: 'nope' }, {})
    assert.strictEqual(missing.code, 404)
  } finally {
    plugin.stop()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
