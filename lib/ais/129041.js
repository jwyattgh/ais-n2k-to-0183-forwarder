/*
 * PGN 129041 AIS Aids to Navigation Report -> AIS message 21
 * (ITU-R M.1371 table 74, 272 bits plus a name extension of up to 14
 * characters, padded to a byte boundary).
 */
const c = require('./common')

module.exports = {
  pgn: 129041,
  title: 'Aid to navigation report (AIS message 21)',
  encode (bytes, ctx) {
    if (bytes.length < 26) return undefined
    const r = new c.N2kReader(bytes)
    const mmsi = r.uint(8, 32)
    const transceiver = r.uint(200, 5)
    const route = c.routing(transceiver, mmsi, ctx)
    if (!route) return undefined

    const name = r.textVar(208)
    const dims = c.dimensions(r.uint(112, 16), r.uint(128, 16), r.uint(144, 16), r.uint(160, 16))
    const w = new c.AisWriter()
    w.uint(21, 6)
    w.uint(r.uint(6, 2), 2) // repeat indicator
    w.uint(mmsi, 30)
    w.uint(r.uint(176, 5), 5) // type of aid to navigation
    w.text(name.slice(0, 20), 20)
    w.uint(r.uint(104, 1), 1) // position accuracy
    w.int(c.position(r.int(40, 32), 181), 28) // longitude
    w.int(c.position(r.int(72, 32), 91), 27) // latitude
    w.uint(dims.toBow, 9)
    w.uint(dims.toStern, 9)
    w.uint(dims.toPort, 6)
    w.uint(dims.toStarboard, 6)
    w.uint(r.uint(185, 4), 4) // type of position fixing device
    w.uint(r.uint(106, 6), 6) // time stamp
    w.uint(r.uint(181, 1), 1) // off-position indicator
    w.uint(r.uint(192, 8), 8) // AtoN status
    w.uint(r.uint(105, 1), 1) // RAIM
    w.uint(r.uint(182, 1), 1) // virtual AtoN
    w.uint(r.uint(183, 1), 1) // assigned mode
    w.uint(0, 1) // spare
    const extension = name.slice(20, 34)
    if (extension.length > 0) {
      w.text(extension, extension.length)
      w.padToByte()
    }
    return c.sentence(w, route)
  }
}
