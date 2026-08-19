# AiMORE2Fossify setup

AiMORE2Fossify is a customized Fossify Calendar for AiMOR digital calendars. It adds a wall-calendar mode, a weather widget, and a local web interface that can be opened from a phone or computer on the same LAN to manage calendars more easily. The web interface supports multiple calendars, ICS imports with incoming-only or two-way choices, calendar colors, event editing where permitted, and wall-display settings.

The project does not require root, an unlocked bootloader, firmware changes, Google Play Services, or a cloud account for the LAN interface.

## Enable Developer Options and ADB on an AiMOR calendar

These calendars run Android underneath the manufacturer's interface, but the normal Android Settings app may not be exposed. The following method reaches Android Settings without modifying the firmware.

### 1. Open the Android keyboard

Open any field that accepts text so the Android on-screen keyboard appears. Examples include a calendar name, event, Wi-Fi password, or other text field.

### 2. Use the comma key to reach keyboard settings

1. Locate the comma (`,`) key.
2. Press and hold the comma key.
3. Select the gear or Settings option from the small menu.

This opens Android keyboard settings rather than the AiMOR calendar settings.

### 3. Return to the main Android Settings screen

Use the Android Back button or the upper-left back arrow to leave the keyboard-specific settings. Continue backing out until the normal Android **Settings** app appears.

### 4. Open About device

Open **Settings → About device**. On some firmware it is under **Settings → System → About device**. Find **Build number**, **Build**, or **Software version**.

### 5. Enable Developer Options

Tap **Build number** repeatedly, normally seven times. Continue until Android reports **You are now a developer**.

### 6. Open Developer Options

Return to Android Settings and open **Settings → System → Developer options**, or **Settings → Developer options**. Enable the main Developer Options switch if one is present.

### 7. Enable ADB debugging

Enable **USB debugging**. Firmware may call it **Android debugging** or **ADB debugging**. Accept the confirmation dialog. **Wireless debugging** is optional.

### 8. Authorize the computer

When the computer first connects, accept **Allow USB debugging?** and select **Always allow from this computer** when appropriate.

The key path is:

> Open keyboard → hold comma → keyboard settings → back into Android Settings → enable Developer Options → enable USB debugging.

## Automated setup

Install Python 3 and ADB/platform-tools, connect the calendar by USB, and authorize the computer. Then provide a signed APK and run the wrapper for your operating system:

```sh
./scripts/setup-aimore.sh --apk /path/to/calendar-release.apk
```

On Windows PowerShell:

```powershell
.\scripts\setup-aimore.ps1 -Apk C:\path\to\calendar-release.apk
```

The setup tool discovers ADB from `PATH` or common Android SDK locations, waits for an authorized device, disables the factory `com.efercro.calendar` app and any old debug package, downloads the latest KISS launcher APK from its GitHub release when one is not supplied, installs KISS, sets KISS as Home, installs AiMORE2Fossify, grants the startup background-activity allowance needed by this firmware, and launches the calendar. Use `--kiss-apk` to provide a local KISS APK or `--no-kiss-download` to require one locally. Use `--serial` when more than one device is connected.

For a local development build, pass `--build-type debug`; a production/release APK must be signed before Android will install it. The tool never deletes calendar data or uninstalls the factory package; it disables it for the primary Android user.

The installed app checks the repository's latest GitHub Release once daily. If a newer APK is available, it posts a notification and asks for approval before downloading and installing it. **Settings → Check for updates** performs the same check immediately. Android may require allowing AiMORE2Fossify to install unknown apps. Because the device performs unauthenticated HTTPS requests, the update repository and release assets must be public; do not put private URLs, credentials, or calendar data in a release.

## LAN web interface

Once the app is running, open the device's displayed LAN address, normally `http://<calendar-ip>:8080`, from a phone or computer on the same network. The service is intentionally local-only and unauthenticated; do not expose port 8080 outside a trusted LAN. The weather card is intentionally limited to the native wall app; the LAN web interface keeps calendar management focused and places the required weather-source attribution in its Settings footnote.
