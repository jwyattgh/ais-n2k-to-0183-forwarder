# Changelog

## 0.1.0

First release.

- Filter NMEA 2000 messages by device, following a device across bus
  address changes.
- Convert AIS messages 1, 2, 3, 4, 5, 8, 11, 18, 21, 24A and 24B to
  NMEA 0183 from the raw bytes.
- Forward over UDP or TCP to any number of hosts, or log in dry-run mode.
- No runtime dependencies.
