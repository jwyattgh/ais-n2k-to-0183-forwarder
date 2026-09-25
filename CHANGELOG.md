# Changelog

## 0.1.4

- A source Signal K makes up on its own can no longer stop a stream.
  Signal K 2.27 files the alarms it raises under a source called
  "notificationApi", typed NMEA 2000 and keyed by the address of the
  device that sent the alarm. The plugin took that for a second
  connection with the AIS receiver's address on it and stopped with
  "address 1 also used on another connection", so nothing was uploaded
  after a Cerbo GX firmware update to Venus OS 3.80. Only the server's
  configured NMEA 2000 connections are compared now.

## 0.1.3

- Per-destination rate limit: "Seconds between position reports from the
  same vessel", default 60 for new destinations. Static data always passes.
  Destinations saved by earlier versions have no limit until you set one.
- The status endpoint and status line show, per destination, lines sent and
  messages held back by the limit.

## 0.1.2

- New advanced setting "Send own vessel as AIVDM instead of AIVDO", on by
  default. AISHub does not display `!AIVDO`, and MarineTraffic locates a
  vessel-mounted station from the vessel's own report, so without this your
  own vessel never appears on those sites. Turn it off when feeding a plotter.

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
