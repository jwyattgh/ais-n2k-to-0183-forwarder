/*
 * PGN 129809 AIS Class B Static Data, part A -> AIS message 24 part A
 * (ITU-R M.1371 table 76, 160 bits).
 */
const c = require('./common')

module.exports = {
  pgn: 129809,
  title: 'Class B static data part A, name (AIS message 24A)',
  encode (bytes, ctx) {
    if (bytes.length < 26) return undefined
    const r = new c.N2kReader(bytes)
    const mmsi = r.uint(8, 32)
    const transceiver = r.uint(200, 5)
    const route = c.routing(transceiver, mmsi, ctx)
    if (!route) return undefined

    const w = new c.AisWriter()
    w.uint(24, 6)
    w.uint(r.uint(6, 2), 2) // repeat indicator
    w.uint(mmsi, 30)
    w.uint(0, 2) // part number A
    w.text(r.text(40, 20), 20) // name
    return c.sentence(w, route)
  }
}
