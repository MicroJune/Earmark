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

## Build & distribute (EAS)

All commands run in the **WSL terminal**. EAS CLI isn't installed globally, so
either prefix with `npx eas-cli@latest …` or install once with
`npm install -g eas-cli`. Sign in with `eas login` (`eas whoami` to verify).

### Two mechanisms — don't mix them up

| | `eas build` | `eas update` |
|---|---|---|
| Produces | a fresh binary (APK / AAB) | an OTA bundle (JS + assets) |
| Use when | native code / native deps / `app.json` native config changed, **or** the version was bumped | only JS / TS / image assets changed |
| Reaches users | reinstall / store update | already-installed apps fetch it on next launch |
| Speed | minutes (cloud build) | seconds |

> ⚠️ This app has **native modules** (whisper.rn, react-native-audio-api), so it
> cannot run in Expo Go — you must `eas build` a dev/preview binary first, and OTA
> updates can only carry pure-JS changes.
>
> ⚠️ `runtimeVersion.policy = appVersion`: an OTA update only reaches installed
> builds whose app version matches exactly. Once you bump `expo.version`
> (e.g. 1.1.0 → 1.2.0) the old builds won't receive updates targeting 1.2.0 —
> bumping the version **requires a new `eas build`**.

### Profiles (see `eas.json`)

| Profile | channel | Purpose | Android artifact |
|---|---|---|---|
| `development` | development | dev-client debug build, used with `expo start` | APK, internal |
| `preview` | preview | internal testing (install directly) | APK, internal |
| `production` | production | release / store (`autoIncrement` bumps versionCode) | AAB |

### Build (binary)

```bash
eas build --profile development --platform android   # dev-client APK
eas build --profile preview     --platform android   # installable test APK
eas build --profile production   --platform android   # release AAB (versionCode auto +1)
# when done with an APK: adb install -r <downloaded.apk>   (install with the Windows adb)
```

History: `eas build:list`.

### Update (OTA — JS/assets only)

Pushes current JS to a channel; matching installed apps update on next launch:

```bash
eas update --channel preview     -m "fix suggest-undo + library batch ops"
eas update --channel production   -m "..."     # after preview looks good
```

History: `eas update:list`. If a change touches native deps/config, **build first**
— OTA can't carry native changes.

### Releasing a new version

1. Bump `expo.version` (and `expo.android.versionCode`) in `app.json`.
2. `eas build --profile production --platform android`.
3. Distribute / upload the new AAB.
4. Later JS-only fixes for that version go out via `eas update --channel production`.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `eas: command not found` | CLI not installed — use `npx eas-cli@latest …` or `npm i -g eas-cli` |
| update pushed but users don't get it | app version mismatch (`runtimeVersion=appVersion`), or it was a native change needing a rebuild |
| build fails on credentials | run `eas credentials` to configure signing (first run can auto-generate) |
| want to watch progress | expo.dev project page, or `eas build:list` / `eas update:list` |

## Notes for users in mainland China

- Use the **on-device** transcription engine (no key, no network).
- Set the model download source to **国内镜像 (hf-mirror)** in Settings.
- For optional AI notes, **DeepSeek** is the most accessible provider.
