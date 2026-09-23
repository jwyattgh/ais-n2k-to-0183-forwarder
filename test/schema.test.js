const test = require('node:test')
const assert = require('node:assert')
const EventEmitter = require('events')

function fakeApp () {
  const app = new EventEmitter()
  app.config = {
    version: '2.19.1',
    settings: {
      pipedProviders: [
        { id: 'gps-0183', pipeElements: [{ options: { type: 'udp' } }] },
        { id: 'n2k-socket', pipeElements: [{ options: { type: 'canbus-canboatjs' } }] },
        { id: 'ydwg-n2k-udp', pipeElements: [{ options: { type: 'ydwg02-udp-canboatjs' } }] }
      ]
    }
  }
  app.debug = () => {}
  app.error = () => {}
  app.getDataDirPath = () => '/tmp'
  app.getSelfPath = () => undefined
  app.setPluginStatus = () => {}
  app.setPluginError = () => {}
  app.signalk = {
    retrieve: () => ({
      sources: {
        'ydwg-n2k-udp': {
          1: { n2k: { canName: 'c078c37ae76baa6d', modelId: 'AIS700', modelSerialCode: '1234' } },
          7: { n2k: { canName: 'aa' } },
          8: { }
        }
      }
    })
  }
  return app
}

test('settings form lists connections, gateway first, and known devices', () => {
  const plugin = require('..')(fakeApp())
  const stream = plugin.schema().properties.streams.items.properties
  assert.deepStrictEqual(stream.connection.enum, ['ydwg-n2k-udp', 'n2k-socket'])
  assert.strictEqual(stream.connection.default, 'ydwg-n2k-udp')
  assert.deepStrictEqual(stream.devices.items.enum, ['c078c37ae76baa6d', 'aa'])
  assert.match(stream.devices.items.enumNames[0], /AIS700/)
  assert.ok(stream.messageTypes.items.enum.length === 8)
  assert.strictEqual(stream.pgns, undefined, 'no raw PGN filter')
})

test('settings form copes with a server that has no connections yet', () => {
  const app = fakeApp()
  app.config.settings = {}
  app.signalk.retrieve = () => ({})
  const plugin = require('..')(app)
  const stream = plugin.schema().properties.streams.items.properties
  assert.strictEqual(stream.connection.enum, undefined)
  assert.strictEqual(stream.devices.items.enum, undefined)
})
