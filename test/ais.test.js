/*
 * One test per AIS converter. Six use real messages recorded from the author's
 * AIS700 on 23 Sep 2026 (the gateway's raw frames); class A messages were
 * not seen in that recording, so those two are built from known values.
 * Every test unpacks the sentence's bits by the ITU-R M.1371 layout and
 * checks each field against the device's reading.
 */
const test = require('node:test')
const assert = require('node:assert')
const { FastPacketAssembler } = require('../lib/fast-packet')
const ais = require('../lib/ais')

const CTX = { ownMmsi: '368066270', includeOwn: true }

// --- helpers: unpack an AIS sentence ---------------------------------------
function bits (sentence) {
  const fields = sentence.split(',')
  const fill = Number(fields[6][0])
  const all = [...fields[5]].map(c => {
    let v = c.charCodeAt(0) - 48
    if (v > 40) v -= 8
    return v.toString(2).padStart(6, '0')
  }).join('')
  return all.slice(0, all.length - fill)
}
const u = (b, a, z) => parseInt(b.slice(a, z), 2)
const s = (b, a, z) => { const v = u(b, a, z); return v >= 2 ** (z - a - 1) ? v - 2 ** (z - a) : v }
const txt = (b, a, z) => {
  let out = ''
  for (let i = a; i < z; i += 6) {
    const v = u(b, i, i + 6)
    out += String.fromCharCode(v < 32 ? v + 64 : v)
  }
  return out.replace(/@+$/, '')
}
function assemble (frames) {
  const asm = new FastPacketAssembler([...ais.byPgn.keys()])
  let whole
  frames.forEach(f => { whole = asm.push(f) || whole })
  return whole
}
function encode (frames, ctx = CTX) {
  const whole = assemble(frames)
  const sentence = ais.byPgn.get(whole.pgn).encode(whole.bytes, ctx)
  assert.match(sentence, /^!AIVD[MO],1,1,,[AB],[^,]+,[0-5]\*[0-9A-F]{2}$/)
  return sentence
}

// --- helpers: build an NMEA 2000 message body ------------------------------
class N2kWriter {
  constructor (length) { this.bytes = Buffer.alloc(length, 0xff) }
  uint (offset, width, value) {
    for (let i = 0; i < width; i++) {
      const bit = offset + i
      if ((value / 2 ** i) & 1) this.bytes[bit >> 3] |= 1 << (bit & 7)
      else this.bytes[bit >> 3] &= ~(1 << (bit & 7))
    }
    return this
  }
  int (offset, width, value) { return this.uint(offset, width, value < 0 ? value + 2 ** width : value) }
  text (offset, chars, value) {
    for (let i = 0; i < chars; i++) this.bytes[(offset >> 3) + i] = i < value.length ? value.charCodeAt(i) : 0x40
    return this
  }
}

test('loads one converter per AIS message type', () => {
  assert.deepStrictEqual([...ais.byPgn.keys()], [129038, 129039, 129041, 129793, 129794, 129797, 129809, 129810])
  ais.converters.forEach(c => assert.strictEqual(typeof c.encode, 'function', c.title))
})

test('129038 class A position report -> message 1', () => {
  const w = new N2kWriter(27)
  w.uint(0, 6, 1).uint(6, 2, 0).uint(8, 32, 366123456)
    .int(40, 32, -741234567).int(72, 32, 112345678) // -74.1234567, 11.2345678
    .uint(104, 1, 1).uint(105, 1, 0).uint(106, 6, 33)
    .uint(112, 16, 12345) // 1.2345 rad = 70.73 deg
    .uint(128, 16, 514) // 5.14 m/s = 9.99 kn
    .uint(144, 19, 0x12345).uint(163, 5, 1) // channel B
    .uint(168, 16, 5000) // 0.5 rad = 28.65 deg
    .int(184, 16, 320) // 0.01 rad/s = 34.38 deg/min
    .uint(200, 4, 5).uint(204, 2, 1).uint(206, 2, 0).uint(208, 8, 0).uint(216, 8, 0)
  const sentence = ais.byPgn.get(129038).encode(w.bytes, CTX)
  assert.match(sentence, /^!AIVDM,1,1,,B,/)
  const b = bits(sentence)
  assert.strictEqual(b.length, 168)
  assert.strictEqual(u(b, 0, 6), 1)
  assert.strictEqual(u(b, 8, 38), 366123456)
  assert.strictEqual(u(b, 38, 42), 5, 'navigational status')
  assert.strictEqual(s(b, 42, 50), 28, 'rate of turn code 4.733 * sqrt(34.38)')
  assert.strictEqual(u(b, 50, 60), 100, 'speed 10.0 knots')
  assert.strictEqual(u(b, 60, 61), 1, 'accuracy')
  assert.strictEqual(s(b, 61, 89), -44474074, 'longitude in 1/10000 minute')
  assert.strictEqual(s(b, 89, 116), 6740741, 'latitude in 1/10000 minute')
  assert.strictEqual(u(b, 116, 128), 707, 'course 70.7 degrees')
  assert.strictEqual(u(b, 128, 137), 29, 'heading 29 degrees')
  assert.strictEqual(u(b, 137, 143), 33, 'time stamp')
  assert.strictEqual(u(b, 143, 145), 1, 'manoeuvre')
  assert.strictEqual(u(b, 148, 149), 0, 'RAIM')
  assert.strictEqual(u(b, 149, 168), 0x12345, 'communication state')
})

test('129038 not-available values use the AIS codes', () => {
  const w = new N2kWriter(27)
  w.uint(0, 6, 3).uint(6, 2, 0).uint(8, 32, 366123456).int(40, 32, 0x7fffffff).int(72, 32, 0x7fffffff).uint(163, 5, 0).int(184, 16, 0x7fff).uint(200, 4, 15)
  const b = bits(ais.byPgn.get(129038).encode(w.bytes, CTX))
  assert.strictEqual(u(b, 0, 6), 3)
  assert.strictEqual(s(b, 42, 50), -128, 'rate of turn')
  assert.strictEqual(u(b, 50, 60), 1023, 'speed')
  assert.strictEqual(s(b, 61, 89), 181 * 600000, 'longitude')
  assert.strictEqual(s(b, 89, 116), 91 * 600000, 'latitude')
  assert.strictEqual(u(b, 116, 128), 3600, 'course')
  assert.strictEqual(u(b, 128, 137), 511, 'heading')
  assert.strictEqual(u(b, 137, 143), 63, 'time stamp')
})

test('129039 class B position report -> message 18, own vessel as AIVDO', () => {
  const sentence = encode([
    '11:19:40.262 R 11F80F01 80 1B 12 DE 3E F0 15 95',
    '11:19:40.263 R 11F80F01 81 A0 F3 D7 3F 1C C5 0A',
    '11:19:40.264 R 11F80F01 82 A0 FF FF 0A 00 00 00',
    '11:19:40.264 R 11F80F01 83 20 FF FF 00 70 FE FF'
  ])
  assert.match(sentence, /^!AIVDO,1,1,,A,/)
  const b = bits(sentence)
  assert.strictEqual(b.length, 168)
  assert.strictEqual(u(b, 0, 6), 18)
  assert.strictEqual(u(b, 8, 38), 368066270)
  assert.strictEqual(u(b, 46, 56), 2, 'speed 0.1 m/s = 0.2 knots')
  assert.strictEqual(u(b, 56, 57), 0, 'accuracy low')
  assert.strictEqual(s(b, 57, 85), -40313970, 'longitude -67.1899499')
  assert.strictEqual(s(b, 85, 112), 10841399, 'latitude 18.0689983')
  assert.strictEqual(u(b, 112, 124), 3600, 'course not available')
  assert.strictEqual(u(b, 124, 133), 511, 'heading not available')
  assert.strictEqual(u(b, 133, 139), 40, 'time stamp')
  assert.deepStrictEqual(
    [u(b, 141, 142), u(b, 142, 143), u(b, 143, 144), u(b, 144, 145), u(b, 145, 146), u(b, 146, 147), u(b, 147, 148)],
    [0, 0, 1, 1, 1, 0, 0], 'SOTDMA unit, no display, DSC, whole band, message 22, autonomous, no RAIM')
  assert.strictEqual(u(b, 148, 168), 0, 'communication state')
})

test('own vessel goes out as AIVDM when asked', () => {
  const sentence = encode([
    '11:19:40.262 R 11F80F01 80 1B 12 DE 3E F0 15 95',
    '11:19:40.263 R 11F80F01 81 A0 F3 D7 3F 1C C5 0A',
    '11:19:40.264 R 11F80F01 82 A0 FF FF 0A 00 00 00',
    '11:19:40.264 R 11F80F01 83 20 FF FF 00 70 FE FF'
  ], { ...CTX, ownAsAivdm: true })
  assert.match(sentence, /^!AIVDM,1,1,,A,/)
})

test('129039 from another vessel is AIVDM on the received channel', () => {
  const sentence = encode([
    '11:19:42.233 R 11F80F01 C0 1B 12 DE 3E F0 15 A6',
    '11:19:42.234 R 11F80F01 C1 A0 F3 D7 1E 1C C5 0A',
    '11:19:42.235 R 11F80F01 C2 A0 FF FF 0A 00 00 00',
    '11:19:42.235 R 11F80F01 C3 08 FF FF 00 70 FE FF'
  ], { ownMmsi: '111111111', includeOwn: true })
  assert.match(sentence, /^!AIVDM,1,1,,B,/)
})

test('129041 aid to navigation -> message 21', () => {
  const sentence = encode([
    '11:19:39.866 R 11F81101 00 31 55 F5 3B 3A 3B 7D',
    '11:19:39.867 R 11F81101 01 86 F2 D7 88 A4 DC 0A',
    '11:19:39.868 R 11F81101 02 F4 FF FF FF FF FF FF',
    '11:19:39.868 R 11F81101 03 FF FF 18 EE 00 E0 17',
    '11:19:39.869 R 11F81101 04 01 33 20 20 20 20 20',
    '11:19:39.869 R 11F81101 05 20 20 20 20 20 20 20',
    '11:19:39.870 R 11F81101 06 20 20 20 20 20 20 20',
    '11:19:39.870 R 11F81101 07 20 20 FF FF FF FF FF'
  ])
  assert.match(sentence, /^!AIVDM,1,1,,A,/)
  const b = bits(sentence)
  assert.strictEqual(b.length, 272)
  assert.strictEqual(u(b, 0, 6), 21)
  assert.strictEqual(u(b, 6, 8), 1, 'first retransmission')
  assert.strictEqual(u(b, 8, 38), 993672181)
  assert.strictEqual(u(b, 38, 43), 24, 'floating port hand mark')
  assert.strictEqual(txt(b, 43, 163), '3', 'name')
  assert.strictEqual(s(b, 164, 192), -40318303, 'longitude -67.1971715')
  assert.strictEqual(s(b, 192, 219), 10933932, 'latitude 18.22322')
  assert.deepStrictEqual([u(b, 219, 228), u(b, 228, 237), u(b, 237, 243), u(b, 243, 249)], [0, 0, 0, 0], 'dimensions not available')
  assert.strictEqual(u(b, 249, 253), 7, 'surveyed')
  assert.strictEqual(u(b, 253, 259), 61, 'time stamp: manual input')
  assert.deepStrictEqual([u(b, 259, 260), u(b, 268, 269), u(b, 269, 270), u(b, 270, 271)], [0, 0, 0, 0])
})

test('129041 long name goes in the extension', () => {
  const w = new N2kWriter(26 + 2 + 26)
  w.uint(0, 6, 21).uint(6, 2, 0).uint(8, 32, 993000001).int(40, 32, 0).int(72, 32, 0)
    .uint(104, 1, 0).uint(105, 1, 0).uint(106, 6, 60)
    .uint(176, 5, 1).uint(181, 1, 0).uint(182, 1, 0).uint(183, 1, 0).uint(184, 1, 0).uint(185, 4, 7)
    .uint(192, 8, 0).uint(200, 5, 0)
  w.bytes[26] = 28; w.bytes[27] = 1
  w.bytes.write('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 28, 'latin1')
  const b = bits(ais.byPgn.get(129041).encode(w.bytes, CTX))
  assert.strictEqual(txt(b, 43, 163), 'ABCDEFGHIJKLMNOPQRST')
  assert.strictEqual(txt(b, 272, 272 + 36), 'UVWXYZ')
  assert.strictEqual(b.length % 8, 0, 'padded to a byte boundary')
})

test('129793 base station report -> message 4', () => {
  const sentence = encode([
    '11:19:42.249 R 1DFB0101 60 1B 04 5C DB 37 00 79',
    '11:19:42.249 R 1DFB0101 61 01 12 D8 E7 CB D1 0A',
    '11:19:42.251 R 1DFB0101 62 FF E0 1A E4 20 50 C0',
    '11:19:42.251 R 1DFB0101 63 00 EF 34 FF 00 FC FF'
  ])
  assert.match(sentence, /^!AIVDM,1,1,,A,/)
  const b = bits(sentence)
  assert.strictEqual(b.length, 168)
  assert.strictEqual(u(b, 0, 6), 4)
  assert.strictEqual(u(b, 8, 38), 3660636)
  assert.deepStrictEqual([u(b, 38, 52), u(b, 52, 56), u(b, 56, 61)], [2007, 2, 7], 'date')
  assert.deepStrictEqual([u(b, 61, 66), u(b, 66, 72), u(b, 72, 78)], [15, 19, 42], 'time')
  assert.strictEqual(u(b, 78, 79), 1, 'accuracy high')
  assert.strictEqual(s(b, 79, 107), -40194517, 'longitude -66.9908615')
  assert.strictEqual(s(b, 107, 134), 10891283, 'latitude 18.1521383')
  assert.strictEqual(u(b, 134, 138), 15, 'fix device 15: kept although NMEA 2000 calls it not available')
  assert.strictEqual(u(b, 148, 149), 1, 'RAIM in use')
  assert.strictEqual(u(b, 149, 168), 0xC050, 'communication state')
})

test('129794 class A static and voyage data -> message 5', () => {
  const w = new N2kWriter(75)
  w.uint(0, 6, 5).uint(6, 2, 0).uint(8, 32, 366123456).uint(40, 32, 9876543)
    .text(72, 7, 'WDA1234').text(128, 20, 'TEST VESSEL').uint(288, 8, 70)
    .uint(296, 16, 1000).uint(312, 16, 200).uint(328, 16, 80).uint(344, 16, 600) // 100 x 20 m, ref 8 m from stbd, 60 m from bow
    .uint(360, 16, Date.UTC(2026, 9, 5) / 86400000).uint(376, 32, (14 * 3600 + 30 * 60) * 10000)
    .uint(408, 16, 650) // 6.50 m
    .text(424, 20, 'CARTAGENA').uint(584, 2, 1).uint(586, 4, 1).uint(590, 1, 0).uint(591, 1, 0).uint(592, 5, 0).uint(597, 3, 0)
  const sentence = ais.byPgn.get(129794).encode(w.bytes, CTX)
  const b = bits(sentence)
  assert.strictEqual(b.length, 424)
  assert.strictEqual(u(b, 0, 6), 5)
  assert.strictEqual(u(b, 8, 38), 366123456)
  assert.strictEqual(u(b, 38, 40), 1, 'AIS version')
  assert.strictEqual(u(b, 40, 70), 9876543, 'IMO')
  assert.strictEqual(txt(b, 70, 112), 'WDA1234')
  assert.strictEqual(txt(b, 112, 232), 'TEST VESSEL')
  assert.strictEqual(u(b, 232, 240), 70, 'ship type')
  assert.deepStrictEqual([u(b, 240, 249), u(b, 249, 258), u(b, 258, 264), u(b, 264, 270)], [60, 40, 12, 8], 'to bow, stern, port, starboard')
  assert.strictEqual(u(b, 270, 274), 1, 'fix device GPS')
  assert.deepStrictEqual([u(b, 274, 278), u(b, 278, 283), u(b, 283, 288), u(b, 288, 294)], [10, 5, 14, 30], 'ETA')
  assert.strictEqual(u(b, 294, 302), 65, 'draught 6.5 m')
  assert.strictEqual(txt(b, 302, 422), 'CARTAGENA')
  assert.strictEqual(u(b, 422, 423), 0, 'DTE available')
})

test('129797 binary broadcast -> message 8', () => {
  const sentence = encode([
    '10:15:38.982 R 15FB0501 80 2A 08 62 FB 2A 14 01',
    '10:15:38.982 R 15FB0501 81 10 01 5B B8 28 F7 49',
    '10:15:38.983 R 15FB0501 82 23 0B F7 82 01 25 6C',
    '10:15:38.983 R 15FB0501 83 8D B7 D1 E5 C4 17 8A',
    '10:15:38.984 R 15FB0501 84 64 22 4F BE 2A 8B 1D',
    '10:15:38.984 R 15FB0501 85 98 64 67 FE A0 4B 29',
    '10:15:38.985 R 15FB0501 86 BB FF FF FF FF FF FF'
  ])
  assert.match(sentence, /^!AIVDM,1,1,,A,852csHQKf/)
  const b = bits(sentence)
  assert.strictEqual(b.length, 312)
  assert.strictEqual(u(b, 0, 6), 8)
  assert.strictEqual(u(b, 8, 38), 338361186)
  assert.strictEqual(u(b, 40, 50), 366, 'DAC')
  assert.strictEqual(u(b, 50, 56), 56, 'FI')
})

test('129809 class B static data part A -> message 24A', () => {
  const sentence = encode([
    '11:21:48.729 R 19FB1101 E0 1B 18 10 95 EA 15 49',
    '11:21:48.731 R 19FB1101 E1 54 53 20 41 4D 41 5A',
    '11:21:48.732 R 19FB1101 E2 49 4E 47 40 40 40 40',
    '11:21:48.733 R 19FB1101 E3 40 40 40 40 40 E0 FF'
  ])
  assert.match(sentence, /^!AIVDM,1,1,,A,/)
  const b = bits(sentence)
  assert.strictEqual(b.length, 160)
  assert.strictEqual(u(b, 0, 6), 24)
  assert.strictEqual(u(b, 8, 38), 367695120)
  assert.strictEqual(u(b, 38, 40), 0, 'part A')
  assert.strictEqual(txt(b, 40, 160), 'ITS AMAZING')
})

test('129810 class B static data part B -> message 24B', () => {
  const sentence = encode([
    '11:21:59.209 R 19FB1201 60 23 18 10 95 EA 15 24',
    '11:21:59.210 R 19FB1201 61 4E 56 43 44 2A 4A 23',
    '11:21:59.211 R 19FB1201 62 57 44 31 34 30 39 39',
    '11:21:59.211 R 19FB1201 63 8C 00 50 00 28 00 6E',
    '11:21:59.212 R 19FB1201 64 00 00 00 00 00 03 E0',
    '11:21:59.212 R 19FB1201 65 FF FF FF FF FF FF FF'
  ])
  assert.match(sentence, /^!AIVDM,1,1,,A,/)
  const b = bits(sentence)
  assert.strictEqual(b.length, 168)
  assert.strictEqual(u(b, 0, 6), 24)
  assert.strictEqual(u(b, 8, 38), 367695120)
  assert.strictEqual(u(b, 38, 40), 1, 'part B')
  assert.strictEqual(u(b, 40, 48), 36, 'sailing')
  assert.strictEqual(txt(b, 48, 66), 'NVC', 'vendor id')
  assert.strictEqual(txt(b, 90, 132), 'WD14099', 'call sign')
  assert.deepStrictEqual([u(b, 132, 141), u(b, 141, 150), u(b, 150, 156), u(b, 156, 162)], [11, 3, 4, 4], '14 x 8 m, ref 11 m from bow, 4 m from starboard')
})
