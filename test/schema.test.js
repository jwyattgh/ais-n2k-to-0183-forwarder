const test = require('node:test')
const assert = require('node:assert')
const EventEmitter = require('events')

function fakeApp () {
  const app = new EventEmitter()
  app.config = {
    version: '2.19.1',
    settings: {
      // The shape Signal K 2.x writes to settings.json: the driver is in
      // options.subOptions.type. The last entry is the older flat shape.
      pipedProviders: [
        { id: 'gps-0183', pipeElements: [{ type: 'providers/simple', options: { type: 'NMEA0183', subOptions: { type: 'udp', port: 1457 } } }] },
        { id: 'n2k-socket', pipeElements: [{ type: 'providers/simple', options: { type: 'NMEA2000', subOptions: { type: 'canbus-canboatjs', interface: 'can0' } } }] },
        { id: 'ydwg-n2k-udp', pipeElements: [{ type: 'providers/simple', options: { type: 'NMEA2000', subOptions: { type: 'ydwg02-udp-canboatjs', port: 1458 } } }] },
        { id: 'flat-n2k', pipeElements: [{ options: { type: 'canbus-canboatjs' } }] }
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
          7: { n2k: { canName: 'c0f08261e7701bfb', modelId: 'i70s' } }, // a display, not AIS
          75: { n2k: { canName: 'c078c38de7701d02', modelId: 'Ray73 AIS' } },
          8: { }
        }
      }
    })
  }
  return app
}

test('settings form lists NMEA 2000 connections and AIS devices', () => {
  const plugin = require('..')(fakeApp())
  const stream = plugin.schema().properties.streams.items.properties
  assert.deepStrictEqual(stream.connection.enum, ['n2k-socket', 'ydwg-n2k-udp', 'flat-n2k'], 'in settings order')
  assert.strictEqual(stream.connection.default, 'n2k-socket')
  assert.deepStrictEqual(stream.devices.items.enum, ['c078c37ae76baa6d', 'c078c38de7701d02'], 'AIS devices only')
  assert.match(stream.devices.items.enumNames[0], /AIS700/)
  assert.ok(stream.advanced.properties.messageTypes.items.enum.length === 8)
  assert.deepStrictEqual(stream['ui:order'], undefined)
  const ui = plugin.uiSchema().streams.items
  assert.strictEqual(ui.devices['ui:widget'], 'checkboxes')
  assert.strictEqual(ui.advanced.messageTypes['ui:widget'], 'checkboxes')
  assert.deepStrictEqual(ui['ui:order'].slice(0, 4), ['name', 'enabled', 'connection', 'devices'])
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
