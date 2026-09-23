/*
 * PGN 129810 AIS Class B Static Data, part B -> AIS message 24 part B
 * (ITU-R M.1371 table 77, 168 bits).
 *
 * The 42-bit vendor block (vendor id 18 bits, unit model 4 bits, serial
 * 20 bits) travels on NMEA 2000 as seven six-bit characters, so it is
 * copied through character for character.
 *
 * An auxiliary craft (MMSI starting 98) carries its mother ship's MMSI in
 * place of the dimensions.
 */
const c = require('./common')

module.exports = {
  pgn: 129810,
  title: 'Class B static data part B, call sign and dimensions (AIS message 24B)',
  encode (bytes, ctx) {
    if (bytes.length < 33) return undefined
    const r = new c.N2kReader(bytes)
    const mmsi = r.uint(8, 32)
    const transceiver = r.uint(264, 5)
    const route = c.routing(transceiver, mmsi, ctx)
    if (!route) return undefined

    const shipType = r.uint(40, 8)
    const dims = c.dimensions(r.uint(160, 16), r.uint(176, 16), r.uint(192, 16), r.uint(208, 16))
    const mothership = r.uint(224, 32)
    const w = new c.AisWriter()
    w.uint(24, 6)
    w.uint(r.uint(6, 2), 2) // repeat indicator
    w.uint(mmsi, 30)
    w.uint(1, 2) // part number B
    w.uint(c.unavailable(shipType, 8) ? 0 : shipType, 8)
    w.text(r.text(48, 7), 7) // vendor id, unit model code, serial number
    w.text(r.text(104, 7), 7) // call sign
    if (String(mmsi).startsWith('98')) {
      w.uint(c.unavailable(mothership, 32) ? 0 : mothership, 30)
    } else {
      w.uint(dims.toBow, 9)
      w.uint(dims.toStern, 9)
      w.uint(dims.toPort, 6)
      w.uint(dims.toStarboard, 6)
    }
    w.uint(0, 6) // spare
    return c.sentence(w, route)
  }
}
