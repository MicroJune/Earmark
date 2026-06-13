# Earmark

To better learn English via podcasts — capture words/phrases you hear, with translation, pronunciation and spaced-repetition review. (Expo slug: `postcast-assistant`)

## 日常开发启动

```bash
# 终端 1:启动 Metro(装了 expo-dev-client 后默认对应 dev build / Earmark App)
cd ~/projects/go-podcast-assistant
npx expo start --localhost        # USB 模式
# 或 npx expo start --lan         # 同一 WiFi 模式(镜像网络已配好)
# 临时用 Expo Go 时加 --go

# 终端 2(USB 模式):架转发 + 拉起 App
bash scripts/usb-expo-go.sh       # Expo Go 用这个
# dev build(Earmark)则直接在手机上打开 App,选 http://localhost:8081
```

---

## USB 连接排查手册(按顺序检查)

> 本机架构:**USB 设备只有 Windows 看得到**,所以 adb server 必须跑在 Windows;
> WSL 是镜像网络(mirrored networking),与 Windows 共享 localhost,
> WSL 里的 adb 永远只做客户端:`ADB_SERVER_SOCKET=tcp:localhost:5037`。
> **两边同时起 adb server 就会抢 5037 端口,这是大多数问题的根源。**

### 第 1 步:重置两边的 adb(治好 80% 的问题)

```powershell
# Windows PowerShell:
wsl -d Ubuntu-22.04 -- bash -lc "pkill -9 adb"   # 杀掉 WSL 里偷跑的 server
adb kill-server
adb start-server
adb devices -l
```

### 第 2 步:按 `adb devices` 的输出对症下药

| 输出 | 含义 | 解决 |
|---|---|---|
| `XXXX device` | ✅ 一切正常 | 没问题,继续干活 |
| **空列表** | Windows 没识别到调试接口 | ① 检查手机「开发者选项 → USB 调试」已开;② 换一根数据线(有些线只能充电);③ `Get-PnpDevice -PresentOnly \| Where-Object { $_.FriendlyName -match 'ADB\|vivo\|Android' }` 看 Windows 是否枚举到 `ADB Interface`,没有则是驱动/线/接口问题 |
| `XXXX unauthorized` | 手机没信任这台电脑(重置 adb 后密钥变新,常见) | 看手机屏幕弹出的「允许 USB 调试吗?」→ 勾选**始终允许** → 确定。**没弹窗**就:手机「开发者选项 → 撤销 USB 调试授权」→ 拔插 USB 线 → 必弹 |
| `XXXX offline` | 连接挂死 | 拔插 USB 线;不行就回到第 1 步 |
| `could not read ok from ADB Server` / `failed to start daemon` / `Address already in use` | **5037 端口被抢**(两边都想当 server) | 回到第 1 步;确认 WSL 里没有裸跑 `adb` 的进程 |

### 第 3 步:验证 WSL 能通过 Windows 的 server 看到设备

```bash
# WSL 里(注意必须带前缀,裸跑 adb 会自己起 server 撞端口!):
ADB_SERVER_SOCKET=tcp:localhost:5037 adb devices
```

能看到 `device` 状态即链路全通。建议把这行写进 `~/.bashrc` 一劳永逸:

```bash
echo 'export ADB_SERVER_SOCKET=tcp:localhost:5037' >> ~/.bashrc
```

### 第 4 步:架 USB 端口转发并启动

```bash
# WSL(或直接跑 scripts/usb-expo-go.sh,它包含了这些步骤):
export ADB_SERVER_SOCKET=tcp:localhost:5037
adb reverse tcp:8081 tcp:8081
adb reverse --list        # 应显示:UsbFfs tcp:8081 tcp:8081(UsbFfs = 走 USB)
bash scripts/usb-expo-go.sh
```

- **Expo Go**:`adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent`
- **dev build(Earmark)**:手机上直接打开 Earmark,开发菜单里选 `http://localhost:8081`

### 已踩过的坑速查

| 症状 | 原因 / 解法 |
|---|---|
| `expo start` 按 `a` 报 `Android SDK path not found` / `android.package not found` | 正常——WSL 没装 Android SDK。不要按 `a`,用上面的 adb 命令直接拉起 App |
| 扫码后卡 "Bundling 99%" | 走了 tunnel(ngrok 国内慢)。改用 `--localhost`(USB)或 `--lan`(同一 WiFi) |
| LAN 模式手机连不上电脑 | Windows 防火墙。管理员 PowerShell:`New-NetFirewallRule -DisplayName "Expo Metro 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow` 以及镜像模式专用:`Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow` |
| Expo Go 一进就崩/红屏 | 多半是依赖版本和 Expo Go 内置原生代码不匹配:`npx expo install --fix` 后重启 Metro(`--clear`) |
| 改了原生依赖后 App 行为不对 | JS 热重载救不了原生变更——需要重新 EAS 构建 APK 安装 |

---

## 构建 & 分发

```bash
npx eas-cli login
npx eas-cli build --profile development --platform android   # dev build APK
# 构建完:adb install -r <下载的.apk>(用 Windows 的 adb 装)
```

中国用户使用要点:转写用 On-device 引擎(零 key 零网络);模型下载源选「国内镜像 (hf-mirror)」;AI 笔记可选 DeepSeek。详见 CLAUDE.md。
