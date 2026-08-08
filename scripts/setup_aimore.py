#!/usr/bin/env python3
"""Install AiMORE2Fossify and KISS on an authorized AiMOR Android calendar."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Iterable
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
FACTORY_PACKAGES = ("com.efercro.calendar",)
DEBUG_PACKAGES = ("org.fossify.calendar.debug",)
KISS_PACKAGE = "fr.neamar.kiss"
RELEASE_PACKAGE = "org.fossify.calendar"
KISS_RELEASES_API = "https://api.github.com/repos/Neamar/KISS/releases/latest"


def fail(message: str) -> None:
    raise SystemExit(f"error: {message}")


def find_adb() -> str:
    candidates: list[Path] = []
    on_windows = os.name == "nt"
    executable = "adb.exe" if on_windows else "adb"
    found = shutil.which(executable) or shutil.which("adb")
    if found:
        return found

    for variable in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        value = os.environ.get(variable)
        if value:
            candidates.append(Path(value) / "platform-tools" / executable)

    home = Path.home()
    candidates.extend(
        [
            home / "Library/Android/sdk/platform-tools" / executable,
            home / "Android/Sdk/platform-tools" / executable,
            home / "AppData/Local/Android/Sdk/platform-tools" / executable,
        ]
    )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    fail("ADB was not found. Install Android platform-tools or add adb to PATH.")


def run(command: list[str], *, check: bool = True, quiet: bool = False) -> subprocess.CompletedProcess[str]:
    if not quiet:
        print("+", " ".join(command))
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and result.returncode != 0:
        print(result.stdout, end="")
        fail(f"command failed with exit code {result.returncode}")
    return result


def adb_call(adb: str, serial: str, args: Iterable[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run([adb, "-s", serial, *args], check=check)


def connected_serial(adb: str, requested: str | None) -> str:
    run([adb, "start-server"])
    result = run([adb, "devices"], quiet=True)
    devices = []
    for line in result.stdout.splitlines()[1:]:
        fields = line.split("\t")
        if len(fields) == 2 and fields[1] == "device":
            devices.append(fields[0])
    if requested:
        if requested not in devices:
            fail(f"ADB serial {requested!r} is not an authorized connected device")
        return requested
    if not devices:
        fail("no authorized ADB device found; connect the calendar and accept the USB debugging prompt")
    if len(devices) > 1:
        fail("more than one ADB device is connected; rerun with --serial")
    return devices[0]


def package_exists(adb: str, serial: str, package: str) -> bool:
    result = adb_call(adb, serial, ["shell", "pm", "path", package], check=False)
    return result.returncode == 0 and "package:" in result.stdout


def disable_package(adb: str, serial: str, package: str) -> None:
    if package_exists(adb, serial, package):
        adb_call(adb, serial, ["shell", "pm", "disable-user", "--user", "0", package])
        print(f"disabled {package} for Android user 0")


def allow_background_start(adb: str, serial: str, package: str) -> None:
    result = adb_call(adb, serial, ["shell", "cmd", "appops", "set", package, "SYSTEM_ALERT_WINDOW", "allow"], check=False)
    if result.returncode == 0:
        print(f"allowed {package} to start its wall activity during device startup")
    else:
        print("could not grant the Android background-start allowance; enable the app's Display over other apps permission if startup is blocked")


def allow_update_install(adb: str, serial: str, package: str) -> None:
    result = adb_call(adb, serial, ["shell", "cmd", "appops", "set", package, "REQUEST_INSTALL_PACKAGES", "allow"], check=False)
    if result.returncode == 0:
        print(f"allowed {package} to install downloaded updates")
    else:
        print("could not grant update-install permission; Android may ask for it before installing an update")


def find_apk(explicit: str | None, build_type: str) -> Path:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            fail(f"APK does not exist: {path}")
        return path

    output_dir = ROOT / f"app/build/outputs/apk/foss/{build_type}"
    candidates = sorted(
        output_dir.glob("calendar-*-foss-*.apk"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for candidate in candidates:
        if candidate.is_file() and "unsigned" not in candidate.name:
            return candidate
    fail("no signed APK found; pass --apk with a signed release APK or build with --build-type debug")


def build_apk(build_type: str) -> None:
    task = f":app:assembleFoss{build_type.title()}"
    gradle = ROOT / ("gradlew.bat" if os.name == "nt" else "gradlew")
    if not gradle.is_file():
        fail(f"Gradle wrapper not found at {gradle}")
    run([str(gradle), task, "--no-daemon"])


def download_kiss(destination: Path) -> Path:
    request = Request(KISS_RELEASES_API, headers={"Accept": "application/vnd.github+json", "User-Agent": "AiMORE2Fossify-setup"})
    try:
        with urlopen(request, timeout=30) as response:
            release = json.load(response)
    except Exception as error:
        fail(f"could not query the KISS GitHub release: {error}")
    apk_assets = [asset for asset in release.get("assets", []) if str(asset.get("name", "")).lower().endswith(".apk")]
    if not apk_assets:
        fail("the latest KISS GitHub release did not contain an APK; pass --kiss-apk")
    url = apk_assets[0]["browser_download_url"]
    print(f"downloading KISS from {url}")
    with urlopen(Request(url, headers={"User-Agent": "AiMORE2Fossify-setup"}), timeout=120) as response:
        destination.write_bytes(response.read())
    return destination


def install(adb: str, serial: str, apk: Path) -> None:
    adb_call(adb, serial, ["install", "-r", str(apk)])


def set_kiss_home(adb: str, serial: str) -> None:
    result = adb_call(
        adb,
        serial,
        ["shell", "cmd", "package", "query-activities", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME"],
        check=False,
    )
    component = next((line.strip() for line in result.stdout.splitlines() if line.strip().startswith(f"{KISS_PACKAGE}/")), None)
    if not component:
        print("KISS was installed, but its Home activity could not be resolved automatically.")
        return
    selected = adb_call(adb, serial, ["shell", "cmd", "package", "set-home-activity", "--user", "0", component], check=False)
    if selected.returncode == 0:
        print(f"set {component} as the Home app")
    else:
        print("KISS was installed; Android may ask you to choose it as the Home app on first launch.")


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", help="signed AiMORE2Fossify APK to install")
    parser.add_argument("--kiss-apk", help="local KISS launcher APK; otherwise download the latest GitHub release")
    parser.add_argument("--no-kiss-download", action="store_true", help="do not download KISS; --kiss-apk is required")
    parser.add_argument("--serial", help="ADB device serial when more than one device is connected")
    parser.add_argument("--build-type", choices=("debug", "release"), default="release", help="APK output to use when --build is supplied")
    parser.add_argument("--build", action="store_true", help="build the requested APK before installing")
    parser.add_argument("--skip-kiss", action="store_true", help="install only AiMORE2Fossify")
    return parser


def main() -> int:
    args = make_parser().parse_args()
    adb = find_adb()
    serial = connected_serial(adb, args.serial)
    print(f"using ADB device {serial}")

    if args.build:
        build_apk(args.build_type)
    app_apk = find_apk(args.apk, args.build_type)

    for package in (*FACTORY_PACKAGES, *DEBUG_PACKAGES):
        disable_package(adb, serial, package)

    with tempfile.TemporaryDirectory(prefix="aimore-kiss-") as temporary:
        if not args.skip_kiss:
            if args.kiss_apk:
                kiss_apk = Path(args.kiss_apk).expanduser().resolve()
                if not kiss_apk.is_file():
                    fail(f"KISS APK does not exist: {kiss_apk}")
            elif args.no_kiss_download:
                fail("--no-kiss-download requires --kiss-apk")
            else:
                kiss_apk = download_kiss(Path(temporary) / "kiss.apk")
            install(adb, serial, kiss_apk)
            set_kiss_home(adb, serial)
            print("KISS installed. Android may ask you to choose it as the Home app on first launch.")

        install(adb, serial, app_apk)
        package = "org.fossify.calendar.debug" if "debug" in app_apk.name.lower() else RELEASE_PACKAGE
        allow_background_start(adb, serial, package)
        allow_update_install(adb, serial, package)
        adb_call(adb, serial, ["shell", "monkey", "-p", package, "1"], check=False)
        print(f"installed {app_apk}")
        print("The wall interface is available at http://<calendar-ip>:8080 while the app is running.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
