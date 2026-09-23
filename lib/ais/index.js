/*
 * One converter per AIS message type, one file each, named after the
 * NMEA 2000 PGN it reads. Drop a new file in this folder to add one.
 *
 * Each exports { pgn, title, encode(bytes, ctx) } where bytes is the
 * complete NMEA 2000 message body and ctx is { ownMmsi, includeOwn }.
 * encode returns one NMEA 0183 sentence, or undefined to send nothing.
 */
const fs = require('fs')
const path = require('path')

const converters = fs.readdirSync(__dirname)
  .filter(f => /^\d+\.js$/.test(f))
  .map(f => require(path.join(__dirname, f)))
  .sort((a, b) => a.pgn - b.pgn)

const byPgn = new Map(converters.map(c => [c.pgn, c]))

module.exports = { converters, byPgn }
