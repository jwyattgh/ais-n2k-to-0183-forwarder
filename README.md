# ais-n2k-to-0183-forwarder

[![test](https://github.com/jwyattgh/ais-n2k-to-0183-forwarder/actions/workflows/test.yml/badge.svg)](https://github.com/jwyattgh/ais-n2k-to-0183-forwarder/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/@sv-orion/ais-n2k-to-0183-forwarder)](https://www.npmjs.com/package/@sv-orion/ais-n2k-to-0183-forwarder)

A Signal K plugin that sends the AIS your NMEA 2000 receiver hears to
services that want NMEA 0183, such as MarineTraffic and AISHub.

## Why

We were sending NMEA 0183 AIS to MarineTraffic and AISHub with a general
forwarder, and also pulling AISHub's data into Signal K. There was no way
to be sure the AISHub data was not leaking back to AISHub through that
forwarder. This plugin closes that gap. It reads the NMEA 2000 bus directly,
keeps only messages from the AIS device you pick, converts them to NMEA
0183 (which MarineTraffic and AISHub require), and forwards them to any
number of hosts, ports and protocols. Nothing that came from anywhere else
can get through.

## What you need

- Signal K server 2.x.
- An NMEA 2000 connection in Signal K.
- An AIS receiver or transceiver on that NMEA 2000 bus.

## Setup

1. Signal K admin page → Appstore → search `ais-n2k` → Install → restart.
2. Server → Plugin Config → AIS N2K to 0183 Forwarder → add a stream:
   - **Connection**: the NMEA 2000 connection.
   - **Devices**: tick your AIS device. Only AIS devices are listed.
   - **Destinations**: host, port and UDP or TCP for each service.
3. Leave **Dry run** on and enable the plugin. Open
   `http://<server>/plugins/ais-n2k-to-0183-forwarder/log/<stream name>`
   and confirm sentences are arriving.
4. Turn **Dry run** off. Sentences now go to the destinations.

Add more streams if different services should get different devices or
message types.

## What goes out

| From NMEA 2000 | As AIS message |
|---|---|
| 129038 Class A position report | 1, 2, 3 |
| 129039 Class B position report | 18 |
| 129041 Aid to navigation report | 21 |
| 129793 UTC and date report | 4, 11 |
| 129794 Class A static and voyage data | 5 |
| 129797 Binary broadcast | 8 |
| 129809 Class B static data part A | 24A |
| 129810 Class B static data part B | 24B |

Your own vessel's messages go out as `!AIVDO`, everything else as `!AIVDM`.
Each message is converted straight from the NMEA 2000 bytes, not from
Signal K's data model, so nothing is rounded or lost.

## Other settings

| Setting | Meaning |
|---|---|
| AIS message types | Limit which message types are sent. Empty means all. |
| Include own vessel | Off leaves out your own vessel's messages. |
| Convert AIS to NMEA 0183 | Off sends canboat JSON instead, for debugging. |

## Terms

The plugin sends only what the devices you pick received. Check the terms
of the services you feed; some prohibit forwarding data that did not come
from your own receiver.

## Licence

Apache-2.0
