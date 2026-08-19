# AiMORE2Fossify

I was given an AiMOR Digital Calendar.  It was a great concept with poor execution.  It was buggy, didn't sync all calendar entries, and functioned poorly overall. So I disabled the AiMOR pre-installed calendar and built this based of Fossify Calendar.  

AiMORE2Fossify is a customized Fossify Calendar build for AiMOR Android digital calendars. It boots into a full-screen wall calendar and adds:

- A local LAN web interface on port 8080 for managing the calendar from a phone or computer.
+ Multiple calendars with colors, deletion, visibility controls, incoming-only or two-way calendar choices, and outgoing-event protection.
- Automatic ICS refreshes at least every 15 minutes.
- Month, month + day, week, and agenda views, including a selectable startup view.
- Previous/next arrows move by month, week, or day according to the active view; event text is sized for wall readability.
- Week and Agenda can switch to an hourly time-grid layout from Settings, with configurable start and end hours; timed events are positioned by their actual time and all-day events remain in a separate strip.
- Day/night/automatic display modes, adaptive brightness, orientation control, and Today-or-Sunday week starts.
- A weather card powered by Open-Meteo in the native wall app in both portrait and landscape, with manual ZIP code and location label settings.
- Weather is hidden from the LAN web interface so phone/computer calendar management stays focused; attribution is available as a Settings footnote.
- KISS launcher integration and automatic wall-calendar startup after reboot.
- Daily GitHub Releases update checks with a manual check in native Settings and an approval prompt before installation.

This repository is the AiMOR device project, not the upstream Fossify Calendar application. Upstream Fossify code and assets are retained as the base; the AiMOR-specific setup and behavior are documented here.

## Start here

Read [AIMORE_SETUP.md](AIMORE_SETUP.md) for:

1. The keyboard-settings workaround for exposing Android Settings.
2. Enabling Developer Options and USB/Wireless debugging.
3. Running the Windows, macOS, or Linux setup tool.
4. Disabling the factory AiMOR calendar.
5. Installing KISS and AiMORE2Fossify.

The setup tool does not root the device, unlock the bootloader, modify firmware, uninstall the factory package, or require Google Play Services.

## Build

Install Android SDK/platform-tools and use the included Gradle wrapper:

~~~sh
./gradlew :app:assembleFossDebug
~~~

The debug APK is created at:

~~~text
app/build/outputs/apk/foss/debug/calendar-29-foss-debug.apk
~~~

For a release build:

~~~sh
./gradlew :app:assembleFossRelease
~~~

Gradle produces an unsigned release APK unless a production signing key is configured. Sign the release APK before installing it on a device or distributing it.

## Install automatically

After ADB is enabled and the calendar is connected and authorized:

~~~sh
./scripts/setup-aimore.sh --apk /path/to/signed-calendar-release.apk
~~~

Windows PowerShell:

~~~powershell
.\scripts\setup-aimore.ps1 -Apk C:\path\to\signed-calendar-release.apk
~~~

The installer discovers ADB, disables the factory com.efercro.calendar package and any old debug build, downloads and installs KISS, sets KISS as the Home app, installs AiMORE2Fossify, grants the startup permission required by this firmware, and launches the calendar. Use --serial with multiple devices, --kiss-apk for a local KISS APK, or --skip-kiss to omit launcher installation.

The updater checks the repository's latest GitHub Release once per day. When a newer APK is found it posts a notification; opening it presents an install/ignore prompt. Native Settings and the wall-view Settings dialog both have **Check for updates** for an immediate check; an update found from the LAN page opens the approval prompt on the calendar. The device must be able to access the repository and its release assets without credentials, so the repository must be public for unattended update checks.

## Use the wall calendar

When the app starts, it opens Wall Calendar mode. Open the displayed LAN address from another device, for example:

~~~text
http://192.168.4.80:8080
~~~

The web Settings menu controls startup mode, default view, orientation, brightness, week start, Local-calendar visibility, weather ZIP code, weather label, and the Week/Agenda layout. Selecting Hourly time grid exposes start/end hour controls; Week shows seven timed columns and Agenda shows a single-day timed schedule. The native wall app keeps the weather card pinned to the bottom of the right-hand column in either orientation; a long calendar list scrolls without covering or moving it. The LAN web interface omits the weather card and keeps its source attribution in the Settings footnote.

ICS sources can be added as two-way (incoming + outgoing edits), one-way (incoming only), or read-only snapshots. The New event button is shown only when at least one visible calendar allows outgoing changes. HTTP(S) feeds refresh at least every 15 minutes. Read-only calendars cannot be edited or deleted from the web interface.

The LAN interface is intentionally unauthenticated and local-only. Do not forward port 8080 outside a trusted network.

## Native Fossify calendar

Wall Calendar mode has an **Exit wall mode** action that returns to the native Fossify calendar. The native calendar retains Fossify's event editing, recurrence, reminders, widgets, and other standard calendar features.

## Project documents

- [AiMOR ADB and automated setup instructions](AIMORE_SETUP.md)
- [Wall-calendar feature and build notes](WALL_CALENDAR.md)
- [Cross-platform installer](scripts/setup_aimore.py)
