# Changelog

## 0.1.1

- Fix: the connection dropdown was empty on a real Signal K server because
  the connection type is stored one level deeper than assumed.
- The device list now offers only AIS devices (NMEA 2000 device class 60,
  function 195).
- Any canboatjs NMEA 2000 connection works, not only a Yacht Devices
  gateway; docs corrected.
- New web endpoints under `/plugins/ais-n2k-to-0183-forwarder/`: `status`
  (JSON counters) and `log/<stream name>` (tail of the dry-run log).
- Settings page tidied: devices and message types are checkboxes, the
  rarely used switches sit under "Advanced", shorter labels.
- README rewritten to say what is needed and how to set it up.

## 0.1.0

First release.

- Filter NMEA 2000 messages by device, following a device across bus
  address changes.
- Convert AIS messages 1, 2, 3, 4, 5, 8, 11, 18, 21, 24A and 24B to
  NMEA 0183 from the raw bytes.
- Forward over UDP or TCP to any number of hosts, or log in dry-run mode.
- No runtime dependencies.
