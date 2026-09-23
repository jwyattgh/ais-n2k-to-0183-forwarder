/*
 * PGN 129039 AIS Class B Position Report -> AIS message 18
 * (ITU-R M.1371 table 67, 168 bits).
 */
const c = require('./common')

module.exports = {
  pgn: 129039,
  title: 'Class B position report (AIS message 18)',
  encode (bytes, ctx) {
    if (bytes.length < 26) return undefined
    const r = new c.N2kReader(bytes)
    const mmsi = r.uint(8, 32)
    const transceiver = r.uint(163, 5)
    const route = c.routing(transceiver, mmsi, ctx)
    if (!route) return undefined

    const w = new c.AisWriter()
    w.uint(18, 6)
    w.uint(r.uint(6, 2), 2) // repeat indicator
    w.uint(mmsi, 30)
    w.uint(r.uint(184, 8), 8) // reserved for regional applications
    w.uint(c.speed(r.uint(128, 16)), 10)
    w.uint(r.uint(104, 1), 1) // position accuracy
    w.int(c.position(r.int(40, 32), 181), 28) // longitude
    w.int(c.position(r.int(72, 32), 91), 27) // latitude
    w.uint(c.course(r.uint(112, 16)), 12)
    w.uint(c.heading(r.uint(168, 16)), 9)
    w.uint(r.uint(106, 6), 6) // time stamp
    w.uint(r.uint(192, 2), 2) // reserved for regional applications
    w.uint(r.uint(194, 1), 1) // class B unit: 0 SOTDMA, 1 carrier sense
    w.uint(r.uint(195, 1), 1) // has display
    w.uint(r.uint(196, 1), 1) // has DSC
    w.uint(r.uint(197, 1), 1) // whole marine band
    w.uint(r.uint(198, 1), 1) // can handle message 22
    w.uint(r.uint(199, 1), 1) // assigned mode
    w.uint(r.uint(105, 1), 1) // RAIM
    w.uint(r.uint(200, 1), 1) // communication state selector: 0 SOTDMA, 1 ITDMA
    w.uint(r.uint(144, 19), 19) // communication state
    return c.sentence(w, route)
  }
}
