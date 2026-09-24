/*
 * Rate limit for one destination: at most one position report per vessel
 * every N seconds. Everything else (static data, names, voyage data,
 * binary broadcasts) always passes.
 *
 * A class B transponder repeats its position every 3 to 30 seconds, and an
 * own-vessel transponder can put it on the bus every second. Services such
 * as MarineTraffic and AISHub keep one position per vessel per minute, so
 * sending more only costs bandwidth.
 */

// AIS message types that carry a position (ITU-R M.1371 table 46).
const POSITION_TYPES = new Set([1, 2, 3, 4, 9, 11, 18, 19, 21, 27])

// Read the message type and MMSI from an AIS sentence's payload: six bits
// per character, type in the first 6 bits, MMSI in bits 8-37.
function identify (sentence) {
  const fields = String(sentence).split(',')
  const payload = fields[5]
  if (!payload || payload.length < 7) return undefined
  const six = c => { const v = c.charCodeAt(0) - 48; return v > 40 ? v - 8 : v }
  const type = six(payload[0])
  let value = 0
  for (let i = 1; i <= 6; i++) value = value * 64 + six(payload[i])
  const mmsi = Math.floor(value / 16) % 2 ** 30
  return { type, mmsi }
}

class Throttle {
  // seconds: 0 (or unset) sends everything
  constructor (seconds) {
    this.interval = Math.max(0, Number(seconds) || 0) * 1000
    this.lastSent = new Map()
  }

  // Say whether this sentence should go out now, and remember it if so.
  allow (sentence, now = Date.now()) {
    if (this.interval === 0) return true
    const id = identify(sentence)
    if (!id || !POSITION_TYPES.has(id.type)) return true
    const last = this.lastSent.get(id.mmsi)
    if (last !== undefined && now - last < this.interval) return false
    this.lastSent.set(id.mmsi, now)
    if (this.lastSent.size > 5000) this.forget(now)
    return true
  }

  // Drop vessels not heard for a while, so the table cannot grow forever.
  forget (now) {
    for (const [mmsi, at] of this.lastSent) {
      if (now - at > this.interval * 10) this.lastSent.delete(mmsi)
    }
  }
}

module.exports = { Throttle, identify, POSITION_TYPES }
