const test = require('node:test')
const assert = require('node:assert')
const dgram = require('dgram')
const os = require('os')
const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const { FromPgn } = require('@canboat/canboatjs')

// Same recorded frames as throttle.test.js: an address claim from the
// AIS700 at address 1, a class B position report (AIS message 18) and a
// class B static data part A (AIS message 24A).
const AIS700 = 'c078c37ae76baa6d'
const CLAIM_AT_1 = '13:00:32.000 R 18EEFF01 6D AA 6B E7 7A C3 78 C0'
const POSITION_AT_1 = [
  '11:19:40.262 R 11F80F01 80 1B 12 DE 3E F0 15 95',
  '11:19:40.263 R 11F80F01 81 A0 F3 D7 3F 1C C5 0A',
  '11:19:40.264 R 11F80F01 82 A0 FF FF 0A 00 00 00',
  '11:19:40.264 R 11F80F01 83 20 FF FF 00 70 FE FF'
]
const STATIC_AT_1 = [
  '11:21:48.729 R 19FB1101 E0 1B 18 10 95 EA 15 49',
  '11:21:48.731 R 19FB1101 E1 54 53 20 41 4D 41 5A',
  '11:21:48.732 R 19FB1101 E2 49 4E 47 40 40 40 40',
  '11:21:48.733 R 19FB1101 E3 40 40 40 40 40 E0 FF'
]
const POSITION_B = 'Class B position report (AIS message 18)'
const STATIC_24A = 'Class B static data part A, name (AIS message 24A)'

function fakeApp (dir) {
  const app = new EventEmitter()
  app.status = ''
  app.config = { version: '2.19.1' }
  app.debug = () => {}
  app.error = () => {}
  app.getDataDirPath = () => dir
  app.getSelfPath = () => '368066270'
  app.setPluginStatus = s => { app.status = s }
  app.setPluginError = s => { app.status = 'ERROR ' + s }
  app.signalk = { retrieve: () => ({ sources: {} }) }
  return app
}

function feed (app, frames) {
  const parser = new FromPgn()
  frames.forEach(line => {
    const msg = parser.parseYDGW02(line)
    app.emit('canboatjs:rawoutput', line)
    if (msg) app.emit('N2KAnalyzerOut', msg)
  })
}

function listener () {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4')
    const lines = []
    socket.on('message', m => lines.push(...m.toString().trim().split('\r\n')))
    socket.bind(0, '127.0.0.1', () => resolve({ socket, lines, port: socket.address().port }))
  })
}

const settle = () => new Promise(resolve => setTimeout(resolve, 100))

// Run one stream with the given settings merged in, feed it one position
// report and one static message, and return what reached the destination
// and the status line.
async function run (settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-'))
  const app = fakeApp(dir)
  const plugin = require('..')(app)
  const dest = await listener()
  const router = { routes: {}, get (p, h) { this.routes[p] = h } }
  plugin.registerWithRouter(router)
  try {
    plugin.start({
      streams: [{
        name: 'test',
        enabled: true,
        dryRun: false,
        connection: 'ydwg-n2k-udp',
        devices: [AIS700],
        destinations: [{ host: '127.0.0.1', port: dest.port, protocol: 'udp' }],
        ...settings
      }]
    })
    app.emit('canboatjs:rawoutput', CLAIM_AT_1)
    feed(app, POSITION_AT_1)
    feed(app, STATIC_AT_1)
    await settle()
    const report = await new Promise(resolve => {
      router.routes['/status']({ params: {}, query: {} }, { json: resolve })
    })
    return { lines: dest.lines, status: app.status, unconverted: report.streams[0].unconverted }
  } finally {
    plugin.stop()
    dest.socket.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('a stream with no message type setting sends every type', async () => {
  const { lines } = await run({})
  assert.strictEqual(lines.length, 2)
})

test('an old config with an empty list still sends every type', async () => {
  // What 0.1.2 to 0.1.4 saved when nothing was ticked
  const { lines } = await run({ advanced: { messageTypes: [] } })
  assert.strictEqual(lines.length, 2)
  const top = await run({ messageTypes: [] }) // 0.1.0 and 0.1.1
  assert.strictEqual(top.lines.length, 2)
})

test('an old config with some types ticked sends only those', async () => {
  const { lines } = await run({ advanced: { messageTypes: [POSITION_B] } })
  assert.strictEqual(lines.length, 1)
})

test('the new setting sends exactly the ticked types', async () => {
  const one = await run({ sendTypes: [STATIC_24A], advanced: { messageTypes: [] } })
  assert.strictEqual(one.lines.length, 1, 'the new setting wins over the old one')
  assert.deepStrictEqual(one.unconverted, {}, 'an unticked type is not reported as unconvertible')
})

test('nothing ticked sends nothing, and the status line says so', async () => {
  const { lines, status } = await run({ sendTypes: [] })
  assert.strictEqual(lines.length, 0)
  assert.match(status, /no message types ticked, nothing is sent/)
})
