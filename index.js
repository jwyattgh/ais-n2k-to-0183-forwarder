/*
 * ais-n2k-to-0183-forwarder: a Signal K plugin.
 *
 * Each stream: pick NMEA 2000 devices (by permanent CAN name) on one
 * connection, optionally convert their AIS messages to NMEA 0183, and
 * send to one or more host/port/protocol destinations.
 *
 * Filter:  only messages from the chosen devices pass; the plugin follows
 *          a device when its address changes.
 * Convert: lib/ais/ holds one converter per AIS message type, built from
 *          the raw NMEA 2000 bytes per ITU-R M.1371. Anything else is
 *          not converted (see below).
 * Forward: UDP or TCP, or a dry-run log file.
 *
 * Without conversion, every passing message is sent as one line of
 * canboat JSON. The raw bytes come from the connection's own raw-line
 * event, so the connection must be a Yacht Devices YDWG-02 RAW stream.
 */
const dgram = require('dgram')
const fs = require('fs')
const net = require('net')
const path = require('path')
const { FastPacketAssembler, parseLine } = require('./lib/fast-packet')
const ais = require('./lib/ais')

const ADDRESS_CLAIM = 60928
const LOOKUP_REFRESH_MS = 5000
const DRY_RUN_LOG_MAX_BYTES = 5 * 1024 * 1024
const MAX_PAYLOAD_PER_SENTENCE = 60

module.exports = function (app) {
  const plugin = {
    id: 'ais-n2k-to-0183-forwarder',
    name: 'AIS N2K to 0183 Forwarder',
    description:
      'Pick NMEA 2000 devices, convert their AIS to NMEA 0183, and forward to one or more hosts'
  }

  let streams = []
  let onMessage
  let onRawLine
  let statusTimer

  plugin.schema = () => {
    const devices = knownDevices()
    const deviceItems = { type: 'string', title: 'Device' }
    if (devices.length > 0) {
      deviceItems.enum = devices.map(d => d.canName)
      deviceItems.enumNames = devices.map(d => d.label)
    }
    const connectionItem = {
      type: 'string',
      title: 'Signal K connection to read (NMEA 2000, YDWG-02 RAW)'
    }
    const connections = knownConnections()
    if (connections.length > 0) {
      connectionItem.enum = connections
      connectionItem.default = connections[0]
    }
    return {
      type: 'object',
      properties: {
        streams: {
          type: 'array',
          title: 'Streams',
          items: {
            type: 'object',
            required: ['name', 'connection'],
            properties: {
              name: { type: 'string', title: 'Name' },
              enabled: { type: 'boolean', title: 'Enabled', default: true },
              dryRun: {
                type: 'boolean',
                title: 'Dry run (log only, send nothing)',
                default: true
              },
              connection: connectionItem,
              devices: {
                type: 'array',
                title: 'Devices',
                description:
                  'Only messages sent by these devices pass. Nothing is sent until each is identified.',
                items: deviceItems
              },
              convert0183: {
                type: 'boolean',
                title: 'Convert AIS to NMEA 0183',
                description:
                  'Without conversion, each message is sent as one line of canboat JSON.',
                default: true
              },
              messageTypes: {
                type: 'array',
                title: 'AIS message types to convert. Leave empty for all.',
                items: { type: 'string', enum: ais.converters.map(c => c.title) },
                uniqueItems: true
              },
              includeOwnVessel: {
                type: 'boolean',
                title: 'Include own vessel (sent as AIVDO)',
                default: true
              },
              destinations: {
                type: 'array',
                title: 'Destinations',
                items: {
                  type: 'object',
                  required: ['host', 'port'],
                  properties: {
                    host: { type: 'string', title: 'Host' },
                    port: { type: 'number', title: 'Port' },
                    protocol: {
                      type: 'string',
                      title: 'Protocol',
                      enum: ['udp', 'tcp'],
                      default: 'udp'
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  plugin.start = options => {
    streams = (options.streams || [])
      .filter(s => s.enabled !== false)
      .map(createStream)

    onMessage = msg => {
      streams.forEach(stream => handleParsed(stream, msg))
    }
    app.on('N2KAnalyzerOut', onMessage)

    // AIS is converted from the raw bytes, rebuilt from the gateway's lines.
    const assembler = new FastPacketAssembler([...ais.byPgn.keys()])
    onRawLine = line => {
      if (typeof line !== 'string') return
      const frame = parseLine(line)
      if (frame && frame.pgn === ADDRESS_CLAIM && frame.data.length === 8) {
        streams.forEach(stream => onAddressClaim(stream, String(frame.src), canNameOf(frame.data)))
        return
      }
      const whole = assembler.push(line)
      if (!whole) return
      streams.forEach(stream => handleRaw(stream, whole))
    }
    app.on('canboatjs:rawoutput', onRawLine)

    statusTimer = setInterval(reportStatus, 10000)
    reportStatus()
  }

  plugin.stop = () => {
    if (onMessage) {
      app.removeListener('N2KAnalyzerOut', onMessage)
      onMessage = undefined
    }
    if (onRawLine) {
      app.removeListener('canboatjs:rawoutput', onRawLine)
      onRawLine = undefined
    }
    clearInterval(statusTimer)
    streams.forEach(closeStream)
    streams = []
  }

  function createStream (config) {
    const stream = {
      config,
      wanted: config.devices || [],
      addresses: new Map(),
      checkedAt: 0,
      collisions: new Set(),
      sentences: 0,
      messages: 0,
      unconverted: {},
      converted: {},
      errors: 0,
      lastError: undefined,
      sequence: 0,
      destinations: []
    }
    const chosen = config.messageTypes && config.messageTypes.length > 0
      ? new Set(config.messageTypes)
      : undefined
    stream.converters = new Map(
      ais.converters.filter(c => !chosen || chosen.has(c.title)).map(c => [c.pgn, c])
    )
    if (config.dryRun !== false) {
      stream.logPath = path.join(app.getDataDirPath(), `${safeName(config.name)}-dryrun.log`)
    } else {
      stream.destinations = (config.destinations || []).map(d => openDestination(stream, d))
    }
    return stream
  }

  function closeStream (stream) {
    stream.destinations.forEach(d => {
      d.closed = true
      clearTimeout(d.retry)
      if (d.socket) d.socket.destroy ? d.socket.destroy() : d.socket.close()
    })
  }

  // Filter: is this message from one of the stream's chosen devices?
  function passes (stream, src) {
    refreshFromSignalK(stream)
    if (missingDevices(stream).length > 0) return false
    if (!stream.addresses.has(String(src))) return false
    // N2KAnalyzerOut does not say which connection a message came from.
    // If a chosen address is also in use on another connection, we cannot
    // tell them apart, so send nothing.
    if (stream.collisions.has(String(src))) return false
    return true
  }

  // Parsed messages: forwarded as JSON when not converting; otherwise only
  // counted, so the status line can show what the chosen devices send
  // that has no converter.
  function handleParsed (stream, msg) {
    if (!passes(stream, msg.src)) return
    stream.messages++
    if (!stream.config.convert0183) {
      send(stream, JSON.stringify(msg))
      return
    }
    if (!stream.converters.has(msg.pgn)) {
      stream.unconverted[msg.pgn] = (stream.unconverted[msg.pgn] || 0) + 1
    }
  }

  function handleRaw (stream, whole) {
    if (!stream.config.convert0183) return
    const converter = stream.converters.get(whole.pgn)
    if (!converter) return
    if (!passes(stream, whole.src)) return
    let sentence
    try {
      sentence = converter.encode(whole.bytes, {
        ownMmsi: app.getSelfPath('mmsi'),
        includeOwn: stream.config.includeOwnVessel !== false
      })
    } catch (err) {
      recordError(stream, err)
      return
    }
    if (!sentence) {
      stream.unconverted[whole.pgn] = (stream.unconverted[whole.pgn] || 0) + 1
      return
    }
    stream.converted[whole.pgn] = (stream.converted[whole.pgn] || 0) + 1
    splitSentence(sentence, stream).forEach(line => send(stream, line))
  }

  function send (stream, line) {
    stream.sentences++
    const data = line + '\r\n'
    if (stream.logPath) {
      appendDryRun(stream, data)
      return
    }
    stream.destinations.forEach(d => d.write(data))
  }

  function appendDryRun (stream, data) {
    try {
      const size = fs.existsSync(stream.logPath) ? fs.statSync(stream.logPath).size : 0
      if (size > DRY_RUN_LOG_MAX_BYTES) fs.renameSync(stream.logPath, stream.logPath + '.1')
      fs.appendFileSync(stream.logPath, `${new Date().toISOString()} ${data}`)
    } catch (err) {
      recordError(stream, err)
    }
  }

  function openDestination (stream, dest) {
    const protocol = dest.protocol || 'udp'
    const d = { host: dest.host, port: dest.port, protocol }
    if (protocol === 'udp') {
      d.socket = dgram.createSocket('udp4')
      d.socket.on('error', err => recordError(stream, err))
      d.write = data => d.socket.send(data, d.port, d.host, err => err && recordError(stream, err))
      return d
    }
    const connect = () => {
      d.connected = false
      d.socket = net.connect(d.port, d.host, () => { d.connected = true })
      d.socket.on('error', err => recordError(stream, err))
      d.socket.on('close', () => {
        d.connected = false
        if (!d.closed) d.retry = setTimeout(connect, 5000)
      })
    }
    d.write = data => d.connected && d.socket.write(data)
    connect()
    return d
  }

  // A device announces its permanent CAN name whenever it takes an address
  // (power-up, address change) or is asked. Follow it immediately.
  function onAddressClaim (stream, addr, canName) {
    if (stream.wanted.includes(canName)) {
      for (const [a, c] of stream.addresses) {
        if (c === canName && a !== addr) stream.addresses.delete(a)
      }
      stream.addresses.set(addr, canName)
    } else if (stream.addresses.has(addr)) {
      // Another device now holds this address: stop until ours is found again.
      stream.addresses.delete(addr)
    }
  }

  // A device's permanent name is the eight bytes of its address
  // announcement read as one little-endian number, written in hex, which is
  // how Signal K names devices in its source list.
  function canNameOf (bytes) {
    return bytes.readBigUInt64LE(0).toString(16)
  }

  function missingDevices (stream) {
    if (stream.wanted.length === 0) return ['(no devices chosen)']
    const found = new Set(stream.addresses.values())
    return stream.wanted.filter(c => !found.has(c))
  }

  // Signal K's device list gives the starting point (devices that announced
  // before this plugin started) and shows addresses used on other connections.
  function refreshFromSignalK (stream) {
    const now = Date.now()
    if (now - stream.checkedAt < LOOKUP_REFRESH_MS) return
    stream.checkedAt = now
    const sources = allSources()
    const own = sources[stream.config.connection] || {}
    const missing = new Set(missingDevices(stream))
    Object.keys(own).forEach(addr => {
      const canName = own[addr] && own[addr].n2k && own[addr].n2k.canName
      if (canName && missing.has(canName) && !stream.addresses.has(addr)) {
        stream.addresses.set(addr, canName)
      }
    })
    const collisions = new Set()
    Object.keys(sources).forEach(connection => {
      if (connection === stream.config.connection) return
      Object.keys(sources[connection] || {}).forEach(addr => {
        const dev = sources[connection][addr]
        if (stream.addresses.has(addr) && dev && dev.n2k) collisions.add(addr)
      })
    })
    stream.collisions = collisions
  }

  function allSources () {
    try {
      return app.signalk.retrieve().sources || {}
    } catch (err) {
      return {}
    }
  }

  // The NMEA 2000 connections the server is configured with, YDWG-02 RAW
  // ones first since only those carry the raw lines this plugin reads.
  function knownConnections () {
    const providers = (app.config && app.config.settings && app.config.settings.pipedProviders) || []
    const n2k = providers.filter(p => {
      const el = p.pipeElements && p.pipeElements[0]
      const type = el && el.options && el.options.type
      return typeof type === 'string' && type.includes('canboatjs')
    })
    const raw = n2k.filter(p => p.pipeElements[0].options.type.startsWith('ydwg02'))
    return [...raw, ...n2k.filter(p => !raw.includes(p))].map(p => p.id)
  }

  function knownDevices () {
    const devices = []
    const sources = allSources()
    Object.keys(sources).forEach(connection => {
      Object.keys(sources[connection] || {}).forEach(addr => {
        const n2k = sources[connection][addr] && sources[connection][addr].n2k
        if (!n2k || !n2k.canName) return
        const model = n2k.modelVersion || n2k.modelId || n2k.manufacturerCode || 'device'
        const serial = n2k.modelSerialCode ? ` s/n ${n2k.modelSerialCode}` : ''
        devices.push({ canName: n2k.canName, label: `${model}${serial} (${connection})` })
      })
    })
    return devices
  }

  // NMEA 0183 limits a sentence to 82 characters; long AIS payloads are
  // split into numbered fragments sharing a sequential message id.
  function splitSentence (sentence, stream) {
    const body = sentence.slice(1, sentence.lastIndexOf('*'))
    const parts = body.split(',')
    const payload = parts[5]
    if (payload.length <= MAX_PAYLOAD_PER_SENTENCE) return [sentence]
    const fill = parts[6]
    const chunks = []
    for (let i = 0; i < payload.length; i += MAX_PAYLOAD_PER_SENTENCE) {
      chunks.push(payload.slice(i, i + MAX_PAYLOAD_PER_SENTENCE))
    }
    const id = stream.sequence
    stream.sequence = (stream.sequence + 1) % 10
    return chunks.map((chunk, i) => {
      const last = i === chunks.length - 1
      return withChecksum(
        [parts[0], chunks.length, i + 1, id, parts[4], chunk, last ? fill : 0].join(',')
      )
    })
  }

  function withChecksum (body) {
    let sum = 0
    for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i)
    return `!${body}*${sum.toString(16).toUpperCase().padStart(2, '0')}`
  }

  function recordError (stream, err) {
    stream.errors++
    stream.lastError = err.message
  }

  function reportStatus () {
    if (streams.length === 0) {
      app.setPluginStatus('No streams enabled')
      return
    }
    const parts = streams.map(stream => {
      const c = stream.config
      refreshFromSignalK(stream)
      const missing = missingDevices(stream)
      if (missing.length > 0) return `${c.name}: waiting to identify ${missing.join(', ')}`
      if (stream.collisions.size > 0) {
        return `${c.name}: STOPPED, address ${[...stream.collisions].join(', ')} also used on another connection`
      }
      const at = [...stream.addresses].map(([a, n]) => `${n}@${a}`).join(', ')
      const mode = stream.logPath ? 'dry run' : `to ${(c.destinations || []).map(d => `${d.host}:${d.port}`).join(', ')}`
      // Message types from the chosen devices that never produced a sentence
      const skipped = Object.keys(stream.unconverted)
        .filter(p => !stream.converted[p])
        .map(p => `${p}×${stream.unconverted[p]}`)
      return `${c.name}: ${stream.sentences} lines ${mode} from ${at}` +
        (skipped.length ? `; not converted: ${skipped.join(' ')}` : '') +
        (stream.errors ? `; ${stream.errors} errors (last: ${stream.lastError})` : '')
    })
    app.setPluginStatus(parts.join(' | '))
  }

  return plugin
}

function safeName (name) {
  return String(name || 'stream').replace(/[^a-zA-Z0-9_-]+/g, '-')
}
