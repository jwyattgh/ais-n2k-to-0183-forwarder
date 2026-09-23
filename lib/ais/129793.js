/*
 * PGN 129793 AIS UTC and Date Report -> AIS message 4 (base station
 * report) or 11 (UTC/date response); ITU-R M.1371 table 49, 168 bits.
 */
const c = require('./common')

module.exports = {
  pgn: 129793,
  title: 'Base station report (AIS message 4, 11)',
  encode (bytes, ctx) {
    if (bytes.length < 24) return undefined
    const r = new c.N2kReader(bytes)
    const mmsi = r.uint(8, 32)
    const transceiver = r.uint(163, 5)
    const route = c.routing(transceiver, mmsi, ctx)
    if (!route) return undefined

    const id = r.uint(0, 6)
    const d = c.date(r.uint(168, 16))
    const t = c.time(r.uint(112, 32))
    const w = new c.AisWriter()
    w.uint(id === 11 ? 11 : 4, 6)
    w.uint(r.uint(6, 2), 2) // repeat indicator
    w.uint(mmsi, 30)
    w.uint(d.year, 14)
    w.uint(d.month, 4)
    w.uint(d.day, 5)
    w.uint(t.hour, 5)
    w.uint(t.minute, 6)
    w.uint(t.second, 6)
    w.uint(r.uint(104, 1), 1) // position accuracy
    w.int(c.position(r.int(40, 32), 181), 28) // longitude
    w.int(c.position(r.int(72, 32), 91), 27) // latitude
    w.uint(r.uint(188, 4), 4) // type of position fixing device
    w.uint(0, 10) // spare
    w.uint(r.uint(105, 1), 1) // RAIM
    w.uint(r.uint(144, 19), 19) // communication state
    return c.sentence(w, route)
  }
}
