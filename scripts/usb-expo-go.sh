#!/bin/bash
# Launch Expo Go on a USB-connected Android phone from WSL.
#
# WHY THIS EXISTS:
#  - The USB device is only visible to the *Windows* adb server.
#  - This WSL machine uses mirrored networking, so it reaches the Windows adb
#    server at localhost:5037 — but it must NOT start its own adb server, or
#    the two collide on port 5037 ("could not read ok from ADB Server").
#  - Pressing `a` in `expo start` fails here because Expo's Android launcher
#    wants the full Android SDK (ANDROID_HOME) + an android.package; Expo Go
#    needs neither. So we drive adb directly.
#
# USAGE:
#  1. Plug in the phone (USB debugging on); on Windows run `adb devices` once
#     and accept the authorization prompt.
#  2. In one WSL terminal:  npx expo start --localhost
#  3. In another WSL terminal:  bash scripts/usb-expo-go.sh
#
# Re-run this script anytime to (re)open Expo Go on the device.

export ADB_SERVER_SOCKET=tcp:localhost:5037
PORT="${1:-8081}"
URL="exp://127.0.0.1:${PORT}"

echo "Devices:"
adb devices

echo "Forwarding tcp:${PORT} over USB..."
adb reverse "tcp:${PORT}" "tcp:${PORT}" || {
  echo "adb reverse failed. On Windows run: adb kill-server; adb start-server; adb devices"
  exit 1
}

echo "Opening Expo Go at ${URL} ..."
adb shell am start -a android.intent.action.VIEW -d "${URL}" host.exp.exponent

echo "Done. Make sure 'npx expo start --localhost' is running in another terminal."
