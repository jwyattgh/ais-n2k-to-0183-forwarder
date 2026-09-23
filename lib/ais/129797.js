/*
 * PGN 129797 AIS Binary Broadcast Message -> AIS message 8
 * (ITU-R M.1371 table 53, 56 bits plus up to 952 bits of application data).
 *
 * Bytes 8 onward hold the application data most-significant bit first;
 * the bit count in bytes 6-7 says how much of it is real.
 */
const c = require('./common')

module.exports = {
  pgn: 129797,
  title: 'Binary broadcast (AIS message 8)',
  encode (bytes, ctx) {
    if (bytes.length < 8) return undefined
    const r = new c.N2kReader(bytes)
    const mmsi = r.uint(8, 32)
    const transceiver = r.uint(41, 5)
    const route = c.routing(transceiver, mmsi, ctx)
    if (!route) return undefined

    const bitCount = r.uint(48, 16)
    const data = bytes.subarray(8)
    if (bitCount === 0 || bitCount > data.length * 8) return undefined
    const w = new c.AisWriter()
    w.uint(8, 6)
    w.uint(r.uint(6, 2), 2) // repeat indicator
    w.uint(mmsi, 30)
    w.uint(0, 2) // spare
    let bits = ''
    for (const b of data) bits += b.toString(2).padStart(8, '0')
    w.raw(bits.slice(0, bitCount))
    return c.sentence(w, route)
  }
}
