# Earmark 部署指南（EAS Build & Update）

本项目用 **EAS（Expo Application Services）** 打包和分发。所有命令都在 **WSL 终端**里运行。

## 0. 准备工作（只做一次）

```bash
# 安装 EAS CLI（全局），之后可直接用 eas 命令
npm install -g eas-cli
# 或者每次临时用：npx eas-cli@latest <command>

eas login        # 登录 Expo 账号
eas whoami       # 确认已登录
```

关键配置（已就绪，无需改动）：

| 项 | 值 | 位置 |
|---|---|---|
| projectId | `2c7c59bf-a9de-4410-bca6-bc4fc6363488` | app.json → extra.eas |
| update url | `https://u.expo.dev/2c7c59bf-...` | app.json → updates.url |
| 版本号 | `version` 1.1.0 / Android `versionCode` 2 | app.json |
| runtimeVersion | `policy: appVersion` | app.json |
| appVersionSource | `remote`（版本号由 EAS 服务器管理） | eas.json |

---

## 1. 两种部署方式，先分清楚

| | `eas build` | `eas update` |
|---|---|---|
| 产物 | 全新二进制（APK/AAB） | OTA 增量包（JS + 资源） |
| 何时用 | 改了**原生代码**、新增/升级**原生依赖**、改了 app.json 原生配置、**升级版本号** | 只改了 **JS / TS / 图片等资源** |
| 用户如何获得 | 重新安装 / 商店更新 | 已安装的 App 启动时自动拉取 |
| 速度 | 慢（云端构建，几分钟～十几分钟） | 快（秒级发布） |

> ⚠️ **本项目有原生模块**（whisper.rn、react-native-audio-api 等），所以**不能用 Expo Go**，必须先 `eas build` 出 dev/preview 包，OTA 更新只能下发**纯 JS 改动**。

> ⚠️ **runtimeVersion = appVersion**：OTA 更新只会下发给「app version 完全一致」的已装包。一旦把 `version` 从 1.1.0 升到 1.2.0，旧包就收不到针对 1.2.0 的 update —— 升版本号必须重新 `eas build`。

---

## 2. 三个 Profile（对应 eas.json）

| Profile | 渠道 channel | 用途 | Android 产物 |
|---|---|---|---|
| `development` | development | 带 dev client 的调试包，配合 `expo start` | APK，internal |
| `preview` | preview | 内测分发（自己/测试者直接装） | APK，internal |
| `production` | production | 正式发布（上架），`autoIncrement` 自动加版本号 | AAB（默认，适合商店） |

---

## 3. Build（出二进制）

```bash
# 开发调试包（dev client，可热重载、连 Metro）
eas build --profile development --platform android

# 内测包（直接能装的 APK）
eas build --profile preview --platform android

# 正式包（AAB，用于上架；versionCode 会自动 +1）
eas build --profile production --platform android
```

构建完成后 EAS 会给一个下载/二维码链接。常用补充参数：

```bash
--platform ios        # 或 all（需 Apple 账号 / 凭证）
--local               # 在本机构建（需配置好原生环境，一般不用）
--no-wait             # 提交后不阻塞，去网页看进度
```

查看历史：`eas build:list`

---

## 4. Update（OTA 热更新，仅限 JS/资源改动）

把当前 JS 代码发到对应渠道，已安装且 app version 匹配的用户下次启动即更新：

```bash
# 发到 preview 渠道（内测）
eas update --channel preview -m "fix suggest-undo + library batch ops"

# 发到 production 渠道（线上用户）
eas update --channel production -m "修复 XXX"

# 发到 development 渠道
eas update --channel development -m "..."
```

- `-m` 是本次更新说明（必填习惯）。
- 也可用 `--branch <name>`，但本项目按 channel 管理更省心。
- 查看历史：`eas update:list`

> OTA 不会改原生层。如果这次改动包含原生依赖/配置变化，**先 `eas build` 再发版**，否则会因 runtime 不兼容而被拒绝下发或运行崩溃。

---

## 5. 典型流程

**日常改 JS（最常见）**
```bash
eas update --channel preview -m "..."   # 内测验证
eas update --channel production -m "..." # 验证 OK 后推线上
```

**改了原生 / 升版本号**
1. 在 `app.json` 升 `version`（如 1.1.0 → 1.2.0）。
2. `eas build --profile production --platform android`（versionCode 自动 +1）。
3. 下载 AAB 上架 / 分发新包。
4. 之后针对 1.2.0 的 JS 改动再走 `eas update --channel production`。

**首次给测试者**
```bash
eas build --profile preview --platform android
# 把链接/二维码发给对方，直接装 APK
```

---

## 6. 排错速查

| 现象 | 原因 / 处理 |
|---|---|
| `eas: command not found` | 没装 CLI，用 `npx eas-cli@latest ...` 或 `npm i -g eas-cli` |
| update 推了但用户收不到 | app version 不匹配（runtimeVersion=appVersion），或这次是原生改动需重新 build |
| 构建失败提示凭证 | 跑 `eas credentials` 配置签名；首次会引导自动生成 |
| 想看进度 | 网页 expo.dev 项目页，或 `eas build:list` / `eas update:list` |

---

相关文档：本地离线引擎与 dev build 见 [OFFLINE_SETUP.md](OFFLINE_SETUP.md)。
