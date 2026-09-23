/*
 * PGN 129794 AIS Class A Static and Voyage Related Data -> AIS message 5
 * (ITU-R M.1371 table 50, 424 bits).
 */
const c = require('./common')

module.exports = {
  pgn: 129794,
  title: 'Class A static and voyage data (AIS message 5)',
  encode (bytes, ctx) {
    if (bytes.length < 75) return undefined
    const r = new c.N2kReader(bytes)
    const mmsi = r.uint(8, 32)
    const transceiver = r.uint(592, 5)
    const route = c.routing(transceiver, mmsi, ctx)
    if (!route) return undefined

    const imo = r.uint(40, 32)
    const dims = c.dimensions(r.uint(296, 16), r.uint(312, 16), r.uint(328, 16), r.uint(344, 16))
    const eta = c.date(r.uint(360, 16))
    const etaTime = c.time(r.uint(376, 32))
    const draft = r.uint(408, 16)
    const w = new c.AisWriter()
    w.uint(5, 6)
    w.uint(r.uint(6, 2), 2) // repeat indicator
    w.uint(mmsi, 30)
    w.uint(r.uint(584, 2), 2) // AIS version
    w.uint(c.unavailable(imo, 32) ? 0 : imo, 30)
    w.text(r.text(72, 7), 7) // call sign
    w.text(r.text(128, 20), 20) // name
    const shipType = r.uint(288, 8)
    w.uint(c.unavailable(shipType, 8) ? 0 : shipType, 8)
    w.uint(dims.toBow, 9)
    w.uint(dims.toStern, 9)
    w.uint(dims.toPort, 6)
    w.uint(dims.toStarboard, 6)
    w.uint(r.uint(586, 4), 4) // type of position fixing device
    w.uint(eta.month, 4)
    w.uint(eta.day, 5)
    w.uint(etaTime.hour, 5)
    w.uint(etaTime.minute, 6)
    w.uint(c.unavailable(draft, 16) ? 0 : Math.min(255, Math.round(draft / 10)), 8) // 0.01 m -> 0.1 m
    w.text(r.text(424, 20), 20) // destination
    w.uint(r.uint(590, 1), 1) // DTE: 0 available, 1 not available
    w.uint(0, 1) // spare
    return c.sentence(w, route)
  }
}
