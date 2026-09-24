const test = require('node:test')
const assert = require('node:assert')
const dgram = require('dgram')
const os = require('os')
const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const { FromPgn } = require('@canboat/canboatjs')
const { Throttle, identify } = require('../lib/throttle')
const { FastPacketAssembler } = require('../lib/fast-packet')
const ais = require('../lib/ais')

const AIS700 = 'c078c37ae76baa6d'
const CLAIM_AT_1 = '13:00:32.000 R 18EEFF01 6D AA 6B E7 7A C3 78 C0'
// A class B position report (PGN 129039) from the author's own AIS700 (MMSI 368066270)
const POSITION_AT_1 = [
  '11:19:40.262 R 11F80F01 80 1B 12 DE 3E F0 15 95',
  '11:19:40.263 R 11F80F01 81 A0 F3 D7 3F 1C C5 0A',
  '11:19:40.264 R 11F80F01 82 A0 FF FF 0A 00 00 00',
  '11:19:40.264 R 11F80F01 83 20 FF FF 00 70 FE FF'
]
// Class B static data part A (PGN 129809, AIS message 24A) for a neighbour
// (MMSI 367695120), as received by the same device
const STATIC_AT_1 = [
  '11:21:48.729 R 19FB1101 E0 1B 18 10 95 EA 15 49',
  '11:21:48.731 R 19FB1101 E1 54 53 20 41 4D 41 5A',
  '11:21:48.732 R 19FB1101 E2 49 4E 47 40 40 40 40',
  '11:21:48.733 R 19FB1101 E3 40 40 40 40 40 E0 FF'
]

function encode (frames, ctx = { ownMmsi: '368066270', includeOwn: true }) {
  const asm = new FastPacketAssembler([...ais.byPgn.keys()])
  let whole
  frames.forEach(f => { whole = asm.push(f) || whole })
  return ais.byPgn.get(whole.pgn).encode(whole.bytes, ctx)
}

test('identify reads the message type and MMSI from a sentence', () => {
  const position = encode(POSITION_AT_1)
  assert.deepStrictEqual(identify(position), { type: 18, mmsi: 368066270 })
  const stat = encode(STATIC_AT_1)
  assert.deepStrictEqual(identify(stat), { type: 24, mmsi: 367695120 })
  assert.strictEqual(identify('!AIVDM,1,1,,A,,0*26'), undefined)
})

test('throttle passes one position per vessel per interval, and all static data', () => {
  const t = new Throttle(60)
  const position = encode(POSITION_AT_1)
  const stat = encode(STATIC_AT_1)
  assert.strictEqual(t.allow(position, 1000), true, 'first position goes')
  assert.strictEqual(t.allow(position, 2000), false, 'one second later: held')
  assert.strictEqual(t.allow(stat, 2000), true, 'static data always goes')
  assert.strictEqual(t.allow(stat, 2001), true)
  assert.strictEqual(t.allow(position, 60999), false, 'just under a minute: held')
  assert.strictEqual(t.allow(position, 61000), true, 'a minute later: goes')
  // A different vessel is counted separately: same sentence with another MMSI
  const other = position.replace(/^(!AIVD[MO],1,1,,[AB],.)....../, '$1000000')
  assert.strictEqual(t.allow(other, 61001), true)
  assert.strictEqual(new Throttle(0).allow(position, 1), true, '0 sends everything')
  assert.strictEqual(new Throttle(undefined).allow(position, 1), true, 'unset sends everything')
})

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

test('each destination applies its own rate limit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-'))
  const app = fakeApp(dir)
  const plugin = require('..')(app)
  const limited = await listener()
  const unlimited = await listener()
  const router = { routes: {}, get (p, h) { this.routes[p] = h } }
  plugin.registerWithRouter(router)
  try {
    plugin.start({
      streams: [{
        name: 'test', enabled: true, dryRun: false, connection: 'ydwg-n2k-udp',
        devices: [AIS700], convert0183: true, includeOwnVessel: true,
        destinations: [
          { host: '127.0.0.1', port: limited.port, protocol: 'udp', positionIntervalSeconds: 60 },
          { host: '127.0.0.1', port: unlimited.port, protocol: 'udp' }
        ]
      }]
    })
    app.emit('canboatjs:rawoutput', CLAIM_AT_1)
    feed(app, POSITION_AT_1)
    feed(app, POSITION_AT_1)
    feed(app, STATIC_AT_1)
    await settle()
    assert.strictEqual(limited.lines.length, 2, 'limited: one position plus the static data')
    assert.strictEqual(unlimited.lines.length, 3, 'unlimited: everything')

    const status = await new Promise(resolve => {
      router.routes['/status']({ params: {}, query: {} }, { json: resolve })
    })
    const [a, b] = status.streams[0].destinations
    assert.deepStrictEqual([a.sent, a.heldBack, a.positionIntervalSeconds], [2, 1, 60])
    assert.deepStrictEqual([b.sent, b.heldBack, b.positionIntervalSeconds], [3, 0, 0])
  } finally {
    plugin.stop()
    limited.socket.close()
    unlimited.socket.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
