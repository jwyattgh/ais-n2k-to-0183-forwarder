/*
 * PGN 129038 AIS Class A Position Report -> AIS message 1, 2 or 3
 * (ITU-R M.1371 table 47, 168 bits).
 */
const c = require('./common')

module.exports = {
  pgn: 129038,
  title: 'Class A position report (AIS message 1, 2, 3)',
  encode (bytes, ctx) {
    if (bytes.length < 27) return undefined
    const r = new c.N2kReader(bytes)
    const mmsi = r.uint(8, 32)
    const transceiver = r.uint(163, 5)
    const route = c.routing(transceiver, mmsi, ctx)
    if (!route) return undefined

    const id = r.uint(0, 6)
    const w = new c.AisWriter()
    w.uint(id >= 1 && id <= 3 ? id : 1, 6)
    w.uint(r.uint(6, 2), 2) // repeat indicator
    w.uint(mmsi, 30)
    w.uint(r.uint(200, 4), 4) // navigational status
    w.int(c.rateOfTurn(r.int(184, 16)), 8)
    w.uint(c.speed(r.uint(128, 16)), 10)
    w.uint(r.uint(104, 1), 1) // position accuracy
    w.int(c.position(r.int(40, 32), 181), 28) // longitude
    w.int(c.position(r.int(72, 32), 91), 27) // latitude
    w.uint(c.course(r.uint(112, 16)), 12)
    w.uint(c.heading(r.uint(168, 16)), 9)
    w.uint(r.uint(106, 6), 6) // time stamp
    w.uint(r.uint(204, 2), 2) // special manoeuvre indicator
    w.uint(0, 3) // spare
    w.uint(r.uint(105, 1), 1) // RAIM
    w.uint(r.uint(144, 19), 19) // communication state
    return c.sentence(w, route)
  }
}
