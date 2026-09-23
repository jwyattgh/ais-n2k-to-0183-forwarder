/*
 * Shared pieces for the AIS converters: read NMEA 2000 fields from raw
 * bytes, write AIS bit fields per ITU-R M.1371, and wrap the result in an
 * NMEA 0183 VDM/VDO sentence.
 *
 * NMEA 2000 packs fields least-significant bit first; AIS packs them
 * most-significant bit first. The two classes below hide that.
 */

// Reads fields out of an NMEA 2000 message body.
class N2kReader {
  constructor (bytes) {
    this.bytes = bytes
  }

  uint (offset, width) {
    let value = 0
    for (let i = 0; i < width; i++) {
      const bit = offset + i
      const byte = this.bytes[bit >> 3]
      if (byte === undefined) return undefined
      if (byte & (1 << (bit & 7))) value += 2 ** i
    }
    return value
  }

  int (offset, width) {
    const v = this.uint(offset, width)
    if (v === undefined) return undefined
    return v >= 2 ** (width - 1) ? v - 2 ** width : v
  }

  // Fixed-length text, padded by the sender with '@', spaces, 0x00 or 0xFF
  text (offset, chars) {
    let s = ''
    for (let i = 0; i < chars; i++) {
      const c = this.bytes[(offset >> 3) + i]
      if (c === undefined || c === 0 || c === 0xff) break
      s += String.fromCharCode(c)
    }
    return s.replace(/[@ ]+$/, '')
  }

  // Variable-length text: length byte (including this header), encoding
  // byte (1 = ASCII, 0 = UTF-16 little endian), then the characters.
  textVar (offset) {
    const start = offset >> 3
    const length = this.bytes[start]
    const encoding = this.bytes[start + 1]
    if (length === undefined || encoding === undefined || length < 2) return ''
    const body = this.bytes.subarray(start + 2, start + length)
    const s = encoding === 0 ? body.toString('utf16le') : body.toString('latin1')
    return s.replace(/[\0\xff]+$/, '').replace(/[@ ]+$/, '')
  }
}

// Not-available markers used by NMEA 2000 (all ones; all ones minus one
// means out of range).
function unavailable (value, width) {
  return value === undefined || value >= 2 ** width - 2
}

function unavailableSigned (value, width) {
  return value === undefined || value >= 2 ** (width - 1) - 2
}

// Writes AIS bit fields most-significant bit first.
class AisWriter {
  constructor () {
    this.bits = ''
  }

  uint (value, width) {
    const v = Math.max(0, Math.min(Math.round(value), 2 ** width - 1))
    this.bits += v.toString(2).padStart(width, '0')
  }

  int (value, width) {
    let v = Math.round(value)
    v = Math.max(-(2 ** (width - 1)), Math.min(v, 2 ** (width - 1) - 1))
    if (v < 0) v += 2 ** width
    this.bits += v.toString(2).padStart(width, '0')
  }

  // Six-bit ASCII text, '@' padded to the field width
  text (s, chars) {
    for (let i = 0; i < chars; i++) this.uint(sixBit(s[i]), 6)
  }

  raw (bitString) {
    this.bits += bitString
  }

  // Zero-pad to a byte boundary (message 21 name extension)
  padToByte () {
    this.bits += '0'.repeat((8 - (this.bits.length % 8)) % 8)
  }

  // Six-bit armouring used by !AIVDM payloads
  payload () {
    const fill = (6 - (this.bits.length % 6)) % 6
    const bits = this.bits + '0'.repeat(fill)
    let out = ''
    for (let i = 0; i < bits.length; i += 6) {
      let v = parseInt(bits.slice(i, i + 6), 2) + 48
      if (v > 87) v += 8
      out += String.fromCharCode(v)
    }
    return { payload: out, fill }
  }
}

// ITU-R M.1371 six-bit ASCII: '@'..'_' are 0..31, ' '..'?' are 32..63
function sixBit (ch) {
  if (ch === undefined) return 0
  let c = ch.charCodeAt(0)
  if (c >= 97 && c <= 122) c -= 32
  if (c >= 64 && c < 96) return c - 64
  if (c >= 32 && c < 64) return c
  return 0
}

// One complete sentence. Long payloads are split by the caller.
function sentence (writer, { channel, own }) {
  const { payload, fill } = writer.payload()
  const body = `AIVD${own ? 'O' : 'M'},1,1,,${channel},${payload},${fill}`
  let sum = 0
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i)
  return `!${body}*${sum.toString(16).toUpperCase().padStart(2, '0')}`
}

// "AIS transceiver information": 0/2 channel A, 1/3 channel B, 4 own vessel
function channelOf (transceiver) {
  return transceiver === 1 || transceiver === 3 ? 'B' : 'A'
}

// Returns { channel, own } or undefined when the message should be dropped
function routing (transceiver, mmsi, ctx) {
  const own = transceiver === 4 || (ctx.ownMmsi !== undefined && String(mmsi) === String(ctx.ownMmsi))
  if (own && ctx.includeOwn === false) return undefined
  return { channel: channelOf(transceiver), own }
}

const DEG = 180 / Math.PI

// Longitude or latitude: NMEA 2000 1e-7 degree -> AIS 1/10000 minute
function position (raw, notAvailableDeg) {
  if (unavailableSigned(raw, 32)) return notAvailableDeg * 600000
  return Math.round(raw * 0.06)
}

// Course: 1e-4 radian -> 0.1 degree, 3600 = not available
function course (raw) {
  if (unavailable(raw, 16)) return 3600
  return Math.min(3600, Math.round(raw * 1e-4 * DEG * 10))
}

// Speed: 0.01 m/s -> 0.1 knot, 1022 = 102.2 knots or more, 1023 = not available
function speed (raw) {
  if (unavailable(raw, 16)) return 1023
  return Math.min(1022, Math.round(raw * 360 / 1852))
}

// Heading: 1e-4 radian -> whole degree, 511 = not available
function heading (raw) {
  if (unavailable(raw, 16)) return 511
  return Math.round(raw * 1e-4 * DEG) % 360
}

// Rate of turn: 3.125e-5 rad/s -> AIS code 4.733 * sqrt(deg/min),
// +-127 = more than 5 deg/s, -128 = not available
function rateOfTurn (raw) {
  if (unavailableSigned(raw, 16)) return -128
  const degPerMin = raw * 3.125e-5 * DEG * 60
  const code = Math.round(4.733 * Math.sqrt(Math.abs(degPerMin)))
  return Math.sign(degPerMin) * Math.min(127, code)
}

// Ship dimensions: 0.1 m fields -> whole metres relative to the position
// reference point; 0 = not available
function dimensions (length, beam, fromStarboard, fromBow) {
  const m = v => (unavailable(v, 16) ? undefined : v / 10)
  const l = m(length); const b = m(beam); const s = m(fromStarboard); const f = m(fromBow)
  const bow = f === undefined ? 0 : Math.round(f)
  const stern = l === undefined || f === undefined ? 0 : Math.round(l - f)
  const starboard = s === undefined ? 0 : Math.round(s)
  const port = b === undefined || s === undefined ? 0 : Math.round(b - s)
  return {
    toBow: Math.min(511, bow),
    toStern: Math.min(511, stern),
    toPort: Math.min(63, port),
    toStarboard: Math.min(63, starboard)
  }
}

// Days since 1970-01-01 -> { year, month, day }; 0xFFFF = not available
function date (raw) {
  if (unavailable(raw, 16)) return { year: 0, month: 0, day: 0 }
  const d = new Date(raw * 86400000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

// 1e-4 seconds since midnight -> { hour, minute, second }; not available = 24/60/60
function time (raw) {
  if (unavailable(raw, 32)) return { hour: 24, minute: 60, second: 60 }
  const s = Math.floor(raw / 10000)
  return { hour: Math.floor(s / 3600), minute: Math.floor((s % 3600) / 60), second: s % 60 }
}

module.exports = {
  N2kReader,
  AisWriter,
  sentence,
  routing,
  unavailable,
  unavailableSigned,
  position,
  course,
  speed,
  heading,
  rateOfTurn,
  dimensions,
  date,
  time,
  sixBit
}
