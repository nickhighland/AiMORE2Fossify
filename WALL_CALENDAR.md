# AiMORE2Fossify wall calendar

This checkout is a customized Fossify Calendar for AiMOR digital calendars with an embedded, local-only wall interface, a weather widget, and a LAN web interface for managing calendars from a phone or computer. See [AIMORE_SETUP.md](AIMORE_SETUP.md) for enabling ADB and running the cross-platform installer.

## Build and install

```sh
./gradlew clean :app:assembleFossDebug
adb -s <serial> install -r app/build/outputs/apk/foss/debug/calendar-25-foss-debug.apk
```

The development package is `org.fossify.calendar.debug`. A signed release uses `org.fossify.calendar`; configure a production keystore before distributing it. The setup tool can install a supplied signed release APK.

`app/build/outputs/apk/foss/debug/calendar-25-foss-debug.apk`

## Use

- Wall mode is the default launch surface and stays awake/fullscreen. Its web Settings menu supports exiting to the native calendar, the start-in-wall toggle, automatic/day/night themes, adaptive or fixed brightness, portrait/landscape/sensor orientation, and Today-or-Sunday week starts (Today is the default).
- The same UI is available from another device at `http://192.168.4.80:8080` while the calendar app process is running.
- Settings → Wall calendar contains the start-in-wall toggle, port, LAN address/copy action, and Return to wall view.
- The web UI supports month, month + day split, week, and agenda views; previous/next arrows move by month, day, or week as appropriate; event text is enlarged for wall readability; and Settings can switch Week and Agenda to an hourly time grid with configurable start/end hours. Week uses seven day columns, Agenda uses a single-day schedule, timed events are positioned within hourly blocks, and all-day events are kept above the grid. The UI also provides 15-second polling; local calendar visibility/color/name management; calendar color pickers; an option to hide the built-in Local calendar from the sidebar; calendar deletion with confirmation (including its events/tasks); and event create/edit/delete. Event bars use their calendar's color in every view.
- The LAN page includes a web-app manifest, standalone mobile metadata, a custom calendar icon, and a shell service worker for adding it to an Android or iOS phone homescreen. A true OS home-screen widget is platform-specific and is not the same as this installable web app.
- The native wall app shows the weather card in both portrait and landscape, pinned to the bottom of the right-hand column. The LAN web interface omits the weather card so phone/computer calendar management stays focused. If the calendar list grows beyond the available column height in the native app, it scrolls independently without moving or covering the weather card.
- Add `.ics` files as editable local copies or read-only snapshots. Add HTTP(S) `.ics` feeds as one-way incoming calendars; they refresh at least every 15 minutes through WorkManager and can be synced immediately with the ↻ button. Read-only calendars are protected from edits/deletes in both the web API and the native helper.
- The wall Settings menu accepts a ZIP code and manual location label for a weather card with current conditions, high/low, precipitation, humidity, U.S. AQI, sunrise/sunset, wind, and a three-day forecast. Weather is supplied by Open-Meteo and cached for 15 minutes. Required Open-Meteo and Copernicus CAMS ENSEMBLE attribution is shown as a Settings footnote rather than inside the card.
- Native Settings includes a manual update check. A WorkManager job checks the latest public GitHub Release once per day and asks for confirmation before installing a newer APK.

The web API uses Fossify’s existing Room `events.db`, `EventsDao`, `CalendarsDao`, and `EventsHelper`. No second database, cloud service, Play Services, OAuth, CDN, or external sync app is required. Existing Fossify recurrence expansion remains read-only in the first web CRUD slice; editing a repeated series is explicitly labeled in the UI.

The initial LAN endpoint is intentionally unauthenticated and local-only. It binds to all device interfaces on port 8080 and does not advertise or tunnel itself; add a PIN before exposing it beyond a trusted LAN.
