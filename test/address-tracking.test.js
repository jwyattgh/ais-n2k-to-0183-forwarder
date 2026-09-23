const test = require('node:test')
const assert = require('node:assert')
const os = require('os')
const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const { FromPgn } = require('@canboat/canboatjs')

const AIS700 = 'c078c37ae76baa6d'
// Real AIS700 announcement captured on the author's boat, at address 01, and the same at 07
const CLAIM_AT_1 = '13:00:32.000 R 18EEFF01 6D AA 6B E7 7A C3 78 C0'
const CLAIM_AT_7 = '13:00:33.000 R 18EEFF07 6D AA 6B E7 7A C3 78 C0'
// A different device announcing address 01
const OTHER_AT_1 = '13:00:34.000 R 18EEFF01 11 22 33 44 55 66 77 C0'

// A class B position report (PGN 129039) from the author's own AIS700, as the
// gateway's four raw frames, sent from address 01
const POSITION_AT_1 = [
  '11:19:40.262 R 11F80F01 80 1B 12 DE 3E F0 15 95',
  '11:19:40.263 R 11F80F01 81 A0 F3 D7 3F 1C C5 0A',
  '11:19:40.264 R 11F80F01 82 A0 FF FF 0A 00 00 00',
  '11:19:40.264 R 11F80F01 83 20 FF FF 00 70 FE FF'
]

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

// Feed the position report as it arrives from the gateway: raw lines and
// the parsed message, from the given source address
function position (app, src) {
  const at = POSITION_AT_1.map(l => l.replace('11F80F01', '11F80F' + src.toString(16).padStart(2, '0')))
  const parser = new FromPgn()
  at.forEach(line => {
    const msg = parser.parseYDGW02(line)
    app.emit('canboatjs:rawoutput', line)
    if (msg) app.emit('N2KAnalyzerOut', msg)
  })
}

test('follows the AIS700 when its address changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-'))
  const app = fakeApp(dir)
  const plugin = require('..')(app)
  try {
    plugin.start({
      streams: [{
        name: 'test', enabled: true, dryRun: true, connection: 'ydwg-n2k-udp',
        devices: [AIS700], pgns: [], convert0183: true, includeOwnVessel: true,
        destinations: [{ host: '127.0.0.1', port: 9, protocol: 'udp' }]
      }]
    })
    const log = path.join(dir, 'test-dryrun.log')
    const lines = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []

    position(app, 1)
    assert.strictEqual(lines().length, 0, 'nothing sent before the device is identified')

    app.emit('canboatjs:rawoutput', CLAIM_AT_1)
    position(app, 1)
    assert.strictEqual(lines().length, 1, 'sends once identified at 01')
    assert.match(lines()[0], /^\S+ !AIVDO,1,1,,A,/, 'own vessel goes out as AIVDO')

    app.emit('canboatjs:rawoutput', CLAIM_AT_7)
    position(app, 1)
    assert.strictEqual(lines().length, 1, 'old address 01 no longer sent')
    position(app, 7)
    assert.strictEqual(lines().length, 2, 'new address 07 sent')

    app.emit('canboatjs:rawoutput', OTHER_AT_1.replace('18EEFF01', '18EEFF07'))
    position(app, 7)
    assert.strictEqual(lines().length, 2, 'another device took 07: stop')
    position(app, 1)
    assert.strictEqual(lines().length, 2, 'nothing from 01 either')

    app.emit('canboatjs:rawoutput', CLAIM_AT_1)
    position(app, 1)
    assert.strictEqual(lines().length, 3, 'AIS700 reappears at 01: sending again')
    assert.match(app.status, /test:/)
  } finally { plugin.stop() }
})

test('own vessel can be left out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-'))
  const app = fakeApp(dir)
  const plugin = require('..')(app)
  try {
    plugin.start({
      streams: [{
        name: 'test', enabled: true, dryRun: true, connection: 'ydwg-n2k-udp',
        devices: [AIS700], pgns: [], convert0183: true, includeOwnVessel: false
      }]
    })
    app.emit('canboatjs:rawoutput', CLAIM_AT_1)
    position(app, 1)
    assert.ok(!fs.existsSync(path.join(dir, 'test-dryrun.log')), 'own position not sent')
  } finally { plugin.stop() }
})
