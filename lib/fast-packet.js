/*
 * Rebuild NMEA 2000 fast-packet messages from YDWG-02 RAW lines, for the
 * few PGNs whose data the parser does not keep.
 *
 * Line:  hh:mm:ss.ddd R 15FB0501 80 2A 08 62 FB 2A 14 01
 * First frame: sequence/frame byte, total length, then 6 data bytes.
 * Later frames: sequence/frame byte, then 7 data bytes.
 */

function parseLine (line) {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 4 || parts[1] !== 'R') return undefined
  const id = parseInt(parts[2], 16)
  if (Number.isNaN(id)) return undefined
  const src = id & 0xff
  const ps = (id >> 8) & 0xff
  const pf = (id >> 16) & 0xff
  const dp = (id >> 24) & 0x01
  const pgn = (dp << 16) | (pf << 8) | (pf >= 240 ? ps : 0)
  const data = Buffer.from(parts.slice(3).map(h => parseInt(h, 16)))
  return { src, pgn, data }
}

class FastPacketAssembler {
  constructor (pgns) {
    this.pgns = new Set(pgns)
    this.pending = new Map()
  }

  // Returns { src, pgn, bytes } when a message is complete, else undefined
  push (line) {
    const frame = parseLine(line)
    if (!frame || !this.pgns.has(frame.pgn) || frame.data.length < 1) return undefined
    const key = `${frame.src}:${frame.pgn}`
    const seq = frame.data[0] >> 5
    const index = frame.data[0] & 0x1f
    if (index === 0) {
      if (frame.data.length < 2) return undefined
      const msg = { seq, length: frame.data[1], next: 1, bytes: [...frame.data.subarray(2)] }
      this.pending.set(key, msg)
      return this.finish(key, msg, frame)
    }
    const msg = this.pending.get(key)
    if (!msg || msg.seq !== seq || msg.next !== index) {
      this.pending.delete(key)
      return undefined
    }
    msg.next++
    msg.bytes.push(...frame.data.subarray(1))
    return this.finish(key, msg, frame)
  }

  finish (key, msg, frame) {
    if (msg.bytes.length < msg.length) return undefined
    this.pending.delete(key)
    return { src: frame.src, pgn: frame.pgn, bytes: Buffer.from(msg.bytes.slice(0, msg.length)) }
  }
}

module.exports = { FastPacketAssembler, parseLine }
