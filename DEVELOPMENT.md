# Development notes

Practical notes for working on Earmark locally — especially the WSL + USB-device
setup the author uses. For the offline transcription engine see
[OFFLINE_SETUP.md](OFFLINE_SETUP.md); for architecture see `CLAUDE.md`.

## Daily startup

```bash
# Terminal 1 — start Metro (with expo-dev-client installed this targets the
# dev build / Earmark app by default)
cd ~/projects/go-podcast-assistant
npx expo start --localhost        # USB mode
# or: npx expo start --lan        # same-WiFi mode
# add --go to temporarily use Expo Go

# Terminal 2 (USB mode) — set up forwarding + launch the app
bash scripts/usb-expo-go.sh       # for Expo Go
# for the dev build (Earmark): open the app on the phone, choose http://localhost:8081
```

---

## USB connection troubleshooting (WSL)

> Setup on this machine: **only Windows sees the USB device**, so the adb server
> must run on Windows. WSL uses mirrored networking (shares localhost with
> Windows), so adb inside WSL must always be a *client*:
> `ADB_SERVER_SOCKET=tcp:localhost:5037`.
> **Running an adb server on both sides fights over port 5037 — the root of most
> problems.**

### Step 1 — reset adb on both sides (fixes 80% of issues)

```powershell
# Windows PowerShell:
wsl -d Ubuntu-22.04 -- bash -lc "pkill -9 adb"   # kill any stray server in WSL
adb kill-server
adb start-server
adb devices -l
```

### Step 2 — act on what `adb devices` reports

| Output | Meaning | Fix |
|---|---|---|
| `XXXX device` | ✅ all good | carry on |
| **empty list** | Windows didn't detect the debug interface | ① check phone *Developer options → USB debugging* is on; ② try another cable (some are charge-only); ③ `Get-PnpDevice -PresentOnly \| Where-Object { $_.FriendlyName -match 'ADB\|vivo\|Android' }` to see whether Windows enumerated an `ADB Interface` — if not, it's a driver/cable/port issue |
| `XXXX unauthorized` | phone hasn't trusted this PC (common after an adb reset rotates the key) | tap *Allow USB debugging?* on the phone → **Always allow** → OK. No prompt? *Developer options → Revoke USB debugging authorizations* → replug → it will prompt |
| `XXXX offline` | connection wedged | replug USB; if not, go back to Step 1 |
| `could not read ok from ADB Server` / `failed to start daemon` / `Address already in use` | **port 5037 contention** (both sides want to be server) | go back to Step 1; make sure no bare `adb` process runs in WSL |

### Step 3 — verify WSL sees the device via the Windows server

```bash
# In WSL (the prefix is required — a bare `adb` starts its own server and
# collides on the port!):
ADB_SERVER_SOCKET=tcp:localhost:5037 adb devices
```

A `device` status means the link is up. Make it permanent:

```bash
echo 'export ADB_SERVER_SOCKET=tcp:localhost:5037' >> ~/.bashrc
```

### Step 4 — set up USB port forwarding and launch

```bash
export ADB_SERVER_SOCKET=tcp:localhost:5037
adb reverse tcp:8081 tcp:8081
adb reverse --list        # should show: UsbFfs tcp:8081 tcp:8081 (UsbFfs = over USB)
bash scripts/usb-expo-go.sh
```

- **Expo Go:** `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent`
- **dev build (Earmark):** open Earmark on the phone, pick `http://localhost:8081` in the dev menu

### Gotchas

| Symptom | Cause / fix |
|---|---|
| `expo start` then `a` → `Android SDK path not found` / `android.package not found` | normal — WSL has no Android SDK. Don't press `a`; launch the app with the adb commands above |
| stuck at "Bundling 99%" after scanning | it used the tunnel (ngrok, slow in CN). Use `--localhost` (USB) or `--lan` (same WiFi) |
| LAN mode: phone can't reach the PC | Windows firewall. Admin PowerShell: `New-NetFirewallRule -DisplayName "Expo Metro 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow` and for mirrored mode: `Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow` |
| Expo Go crashes/red-screens on launch | dependency versions don't match Expo Go's built-in native code: `npx expo install --fix`, then restart Metro with `--clear` |
| app behaves wrong after changing native deps | JS hot reload can't apply native changes — rebuild and reinstall the APK |

---

## Build & distribute

```bash
npx eas-cli login
npx eas-cli build --profile development --platform android   # dev build APK
# when done: adb install -r <downloaded.apk>   (install with the Windows adb)
```

Remember to bump `expo.version` and `expo.android.versionCode` in `app.json`
before a release build that users will install over an existing one.

## Logging & diagnostics

The app has a self-contained logging system (`src/utils/logger.ts`) built to
survive the failure modes that make field bugs hard to diagnose — especially
hard crashes / ANRs and ROMs (e.g. vivo) that suppress `logcat`.

**Using it**
- `log.debug/info/warn/error(tag, message, extra?)` — `extra` may be an `Error`
  (its stack is captured) or any object (JSON-serialised into the detail line).
- `log.setContext({ screen, audioFileId, … })` / `log.clearContext()` — ambient
  fields attached to every subsequent entry (shown in the viewer + log file).
- `log.breadcrumb('…')` — a one-off marker; the latest is saved into the session
  record so it shows up in the next launch's crash report.
- `initLogger()` is called once at startup from `App.tsx` (before DB/audio init).

**What it captures**
- **Abnormal-exit detection.** Each run writes a session record
  (`logger-session.json`). On the next launch the logger reports whether the
  previous session ended abnormally: a JS crash (`crashed`), or a death while in
  the **foreground** (`appState === 'active'` ⇒ likely ANR / native crash / OS
  kill — exactly the lock-screen freeze). A background death is treated as
  normal. This is the signal we previously had no way to see.
- **Global JS error handler** — uncaught/fatal errors are logged (with stack)
  and flagged in the session record before the app dies.
- **Main-thread freeze watchdog** — a 2 s heartbeat; if the gap blows past
  `FREEZE_WARN_MS` (5 s) it logs how long the JS thread was blocked. (This alone
  would have surfaced the ~38 s unlock freeze.)
- **Structured context** on every entry, plus lifecycle breadcrumbs (app →
  active/background).

**Getting the logs off the device**
- **In-app Log Viewer** (Settings) — filter by level, share, clear.
- **Live stream to laptop** — the 📻 toggle in the Log Viewer POSTs every new
  line to `log-server.js` as it happens, so it survives a crash and bypasses
  ROM logcat suppression. Run on the laptop:
  ```bash
  node log-server.js
  adb reverse tcp:8765 tcp:8765   # Windows adb (USB device is Windows-visible)
  ```
- **Persisted file** — `app.log` in the app document dir (rotates to `app.log.1`
  past 512 KB). Pull with adb or read it after a crash; survives the in-memory
  buffer being lost.

## Notes for users in mainland China

- Use the **on-device** transcription engine (no key, no network).
- Set the model download source to **国内镜像 (hf-mirror)** in Settings.
- For optional AI notes, **DeepSeek** is the most accessible provider.
