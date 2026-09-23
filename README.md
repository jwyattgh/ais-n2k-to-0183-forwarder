# ais-n2k-to-0183-forwarder

[![test](https://github.com/jwyattgh/ais-n2k-to-0183-forwarder/actions/workflows/test.yml/badge.svg)](https://github.com/jwyattgh/ais-n2k-to-0183-forwarder/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/ais-n2k-to-0183-forwarder)](https://www.npmjs.com/package/ais-n2k-to-0183-forwarder)

A [Signal K](https://signalk.org) plugin that takes AIS from chosen NMEA 2000
devices, converts it to NMEA 0183 (`!AIVDM` / `!AIVDO`) and forwards it to
one or more hosts, such as MarineTraffic or AISHub.

It exists for boats whose AIS receiver is on NMEA 2000 while the services
they feed want NMEA 0183. Per named stream, it does three things:

1. **Filter.** Only messages from the devices you pick pass. Devices are
   chosen by their permanent NMEA 2000 name, so the plugin keeps following a
   device when its bus address changes. Nothing is sent from an address until
   the plugin knows which device is there.
2. **Convert.** Each AIS message type has its own converter, built straight
   from the raw NMEA 2000 bytes per ITU-R M.1371. Nothing goes through Signal
   K's data model, so nothing is rounded, truncated or lost on the way.
3. **Forward.** UDP or TCP to any number of hosts, or a dry-run log file.

## Requirements

- Signal K server 2.x on Node 18 or later.
- The NMEA 2000 connection in Signal K must be a **Yacht Devices YDWG-02
  RAW** stream (TCP or UDP). The plugin reads the gateway's raw lines, which
  other connection types do not expose.

## Install

From the Signal K admin page, Appstore, search for
`ais-n2k-to-0183-forwarder` and install. Restart the server when asked, then
enable and configure the plugin under Server → Plugin Config.

## Settings

Each stream is a separate job with its own devices and destinations.

| Setting | Meaning |
|---|---|
| Name | Labels the status line and the dry-run log. |
| Enabled | Switch the stream on or off. |
| Dry run | On by default. What would be sent goes to `<data dir>/<name>-dryrun.log` (rotated at 5 MB) and nothing leaves the boat. |
| Connection | Which Signal K connection to read. YDWG-02 RAW connections are listed first. |
| Devices | Pick from the devices Signal K has seen, by model, serial number and connection. |
| AIS message types | Which message types to convert. Empty means all. |
| Convert AIS to NMEA 0183 | On by default. Off sends one line of canboat JSON per message instead, for debugging. |
| Include own vessel | On by default. Own-vessel messages go out as `!AIVDO`. |
| Destinations | Host, port and UDP or TCP. Add as many as needed. |

The plugin's status line shows, per stream, how many sentences went out,
which bus address each chosen device is at (or that it is still waiting for
one), and any message types from those devices it could not convert.

## Message types converted

| NMEA 2000 | AIS message |
|---|---|
| 129038 Class A position report | 1, 2, 3 |
| 129039 Class B position report | 18 |
| 129041 Aid to navigation report | 21 |
| 129793 UTC and date report | 4, 11 |
| 129794 Class A static and voyage data | 5 |
| 129797 Binary broadcast | 8 |
| 129809 Class B static data part A | 24A |
| 129810 Class B static data part B | 24B |

Own-vessel messages go out as `!AIVDO`; everything else as `!AIVDM` on the
channel it was received on. Messages longer than one sentence are split into
numbered fragments.

## How the conversion works

NMEA 2000 packs fields least-significant bit first and marks "not available"
with all-ones; AIS packs most-significant bit first and has its own
not-available codes per field (heading 511, course 3600, and so on). Each
converter in `lib/ais/` reads the NMEA 2000 fields at their bit offsets,
applies the unit change (for example, position from 1e-7 degrees to
1/10000 minute) and writes the AIS bit layout. `lib/ais/common.js` holds the
readers, writers and shared field conversions; `lib/fast-packet.js`
reassembles multi-frame messages from the gateway's raw lines.

To add a message type, add a file named after its PGN to `lib/ais/`
exporting `{ pgn, title, encode(bytes, ctx) }`, and a test in
`test/ais.test.js`. The file is picked up automatically.

## Tests

```
npm test
```

Six converters are tested against real messages recorded from a Raymarine
AIS700 (the gateway's raw frames); the two class A converters against
constructed messages. Every test unpacks the resulting sentence by the AIS
bit layout and checks each field. Device following is tested with recorded
address announcements.

## Privacy and terms

The plugin sends exactly the AIS your own receiver hears, and only from the
devices you pick. Check the terms of any service you feed; some prohibit
forwarding data that did not come from your own receiver.

## Licence

Apache-2.0
