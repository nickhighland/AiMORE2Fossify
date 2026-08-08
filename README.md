# AiMORE2Fossify

I was given an AiMOR Digital Calendar.  It was a great concept with poor execution.  It was buggy, didn't sync all calendar entries, and functioned poorly overall. So I disabled the AiMOR pre-installed calendar and built this based of Fossify Calendar.  

AiMORE2Fossify is a customized Fossify Calendar build for AiMOR Android digital calendars. It boots into a full-screen wall calendar and adds:

- A local LAN web interface on port 8080 for managing the calendar from a phone or computer.
- Multiple calendars with colors, deletion, visibility controls, editable local calendars, read-only imports, and one-way ICS feeds.
- Automatic ICS refreshes at least every 15 minutes.
- Month, month + day, week, and agenda views, including a selectable startup view.
- Day/night/automatic display modes, adaptive brightness, orientation control, and Today-or-Sunday week starts.
- A landscape weather card powered by Open-Meteo, with manual ZIP code and location label settings.
- Weather hidden automatically in portrait mode and phone-sized web views.
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
app/build/outputs/apk/foss/debug/calendar-22-foss-debug.apk
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

The updater checks the repository's latest GitHub Release once per day. When a newer APK is found it posts a notification; opening it presents an install/ignore prompt. Native Settings also has **Check for updates** for an immediate check. The device must be able to access the repository and its release assets without credentials, so the repository must be public for unattended update checks.

## Use the wall calendar

When the app starts, it opens Wall Calendar mode. Open the displayed LAN address from another device, for example:

~~~text
http://192.168.4.80:8080
~~~

The web Settings menu controls startup mode, default view, orientation, brightness, week start, Local-calendar visibility, weather ZIP code, and weather label. The right-hand sidebar keeps the weather card pinned to the bottom in landscape; a long calendar list scrolls without covering or moving it.

ICS files can be imported as editable local copies or read-only snapshots. HTTP(S) ICS feeds are one-way incoming calendars and refresh at least every 15 minutes. Read-only calendars cannot be edited or deleted from the web interface.

The LAN interface is intentionally unauthenticated and local-only. Do not forward port 8080 outside a trusted network.

## Native Fossify calendar

Wall Calendar mode has an **Exit wall mode** action that returns to the native Fossify calendar. The native calendar retains Fossify's event editing, recurrence, reminders, widgets, and other standard calendar features.

## Project documents

- [AiMOR ADB and automated setup instructions](AIMORE_SETUP.md)
- [Wall-calendar feature and build notes](WALL_CALENDAR.md)
- [Cross-platform installer](scripts/setup_aimore.py)
