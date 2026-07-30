# 极简业务工作台 · 多端部署与云端同步指南

一个黑白极简的本地业务工作台：计划·日程、客户管理（外贸/假毛）、账单、锻炼体重、网易云音乐、哔哩哔哩、文件笔记、小工具、专注模式，外加 **AI 全局检索** 与 **云端多设备同步**。

本指南说明如何：① 日常使用；② 配置云端同步；③ 打包 Windows EXE；④ 打包安卓 APK。

> 🌟 **推荐方案（零基础、手机端音乐/B站 全可用）**：把 `server.js` 部署到云端（**Render** 最省事），你会得到一个网址；手机 / 电脑 / PWA / APK 全部访问它，音乐、哔哩哔哩、数据同步**同源直接可用**，前端无需任何改动。
> 详细「一步步图文步骤」见 👉 **[《云端部署指南.md》](./云端部署指南.md)**（专为零基础写成）。

---

## 一、文件结构

```
极简业务工作台.html   主程序（单文件，可直接用浏览器打开）
server.js             本地代理（解决网易云/B站跨域，零依赖）
sync-config.js        ⭐ 云端同步配置（填你的 Supabase 密钥）
supabase.sql          Supabase 建表脚本
manifest.webmanifest  PWA 清单
sw.js                 Service Worker（离线/PWA 安装）
icon.svg              应用图标
启动工作台.bat         Windows 一键启动（双击即用）
electron-main.js      Electron 主进程（打包 EXE 用）
package.json          构建脚本（Electron / Capacitor）
capacitor.config.json 安卓打包配置
index.html            移动端入口（Capacitor 用）
```

---

## 二、日常使用（不改代码）

1. 双击 **启动工作台.bat**（自动找 Node、启动代理、打开 `http://localhost:8848`）。
2. 之后固定用这个地址使用；数据存在本机浏览器。
3. 想改样式：打开 HTML，顶部 `<style>` 里的 `--ink`（主色）、`--bg`（背景）等变量即可换肤；底部 `<script>` 按模块分区注释，复制模块结构即可加功能。

> 直接双击 `极简业务工作台.html` 也能用，但网易云/B站会因跨域不可用（页面顶部有红框提示）。

---

## 三、配置云端同步（手机↔电脑 数据互通）

同步基于 **Supabase（免费云数据库）**，无需自己维护服务器。

### 1. 建项目
打开 https://supabase.com → 注册 → New Project（记住密码，区域任选）。

### 2. 建表 + 权限
左侧 **SQL Editor** → New query → 粘贴本目录 `supabase.sql` 全部内容 → **Run**。
（建了一张 `wb_snapshot` 表，并开启「只读写自己那一行」的行级安全。）

### 3. 关闭邮箱验证（个人使用更省心）
左侧 **Authentication → Providers → Email** → 关闭 **Confirm email**。
这样首次登录即自动注册，不用去邮箱点链接。

### 4. 复制密钥
左侧 **Project Settings → API**：
- `Project URL` → 填入 `sync-config.js` 的 `SUPABASE_URL`
- `anon public` 那串 JWT → 填入 `SUPABASE_ANON_KEY`

```js
window.SYNC_CONFIG = {
  SUPABASE_URL:      'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGci...',
  PROXY_URL: ''      // 云端同源部署时无需填写（见《云端部署指南.md》）；仅当网页与代理分属不同域名时才填
};
```

### 5. 使用
重启「启动工作台.bat」→ 设置页「☁️ 云端同步」→ 输入邮箱+密码（**手机和电脑用同一个账号**）。
- 每次改动自动后台上传；
- 换设备时点「↓ 立即下载」拉取最新；
- 也支持切回前台自动同步、每 30 秒轮询。

> 冲突策略：最后保存者胜出（个人单账号足够）。删除某端数据后，在另一端点「↑ 立即上传」会把它覆盖成删除后的状态。

---

## 四、打包 Windows EXE（电脑端 App）

需要 Node.js（已自带）。联网执行一次安装依赖，之后可离线打包。

```bash
npm install            # 安装 electron / electron-builder（约 1 次，需联网）
npm run dist:win       # 产出 dist/极简业务工作台-1.0.0-setup.exe
```

- 双击 `setup.exe` 安装，桌面自动建快捷方式。
- EXE 内部已内置 `server.js` 代理，**无需再开 bat**，网易云/B站直接可用。
- 想改 EXE 图标：准备 `icon.ico`，在 `package.json` 的 `build.win.icon` 指向它后重新打包。

---

## 五、打包安卓 APK（手机端 App）

用 **Capacitor** 把同一套网页包成原生安卓 App。需要：Node.js + **Android Studio + Android SDK**（构建 APK 必须，无法在纯网页环境完成）。

```bash
npm install                              # 含 @capacitor/* 依赖
npx cap add android                      # 生成 android/ 原生工程（首次）
npx cap sync                             # 把网页资源同步进 android 工程
npx cap build android                    # 用本机 Android SDK 编译出 APK
# 或：npx cap open android  → 在 Android Studio 里点 ▶ Run / Build APK
```

- 装到手机：把 `android/app/build/outputs/apk/release/app-release.apk` 传到手机安装（需开启「未知来源」）。
- 字节级同步：APK 内用同一个 Supabase 账号登录，数据自动与电脑互通。
- **音乐 / B站 在手机端（同源部署即全可用）**：推荐把 `server.js` 部署到云端（Render / Vercel），并让 APK 的 `capacitor.config.json` 中 `server.url` 指向该云端域名。此时 APK 打开即加载云端网页，**音乐/B站/同步全部同源可用**，无需填 `PROXY_URL`。若你把网页与代理分别部署到不同域名，再把代理地址填进 `sync-config.js` 的 `PROXY_URL` 即可。详见《云端部署指南.md》。

> iOS 用户：同样的网页可走 **PWA**——用 Safari 打开工作台地址 → 分享 →「添加到主屏幕」，
> 图标即 App；或在支持的平台用 `npx cap add ios` 打包 IPA（需 macOS + Xcode）。

---

## 六、数据互通使用小结

| 场景 | 做法 |
|---|---|
| 电脑 ↔ 手机 同步 | 两端登录同一 Supabase 账号，改动自动上传 |
| 换设备拉最新 | 设置页点「↓ 立即下载」 |
| 本地兜底 | 仍存本机浏览器；可「导出备份」JSON 作二次保险 |
| 图片/文件 | 压缩后随快照同步（建议图片适量，避免单账号体积过大）|

---

## 七、常见问题

- **同步状态显示「未配置」**：没填 `sync-config.js` 的密钥，或填的还是 `YOUR_...` 占位符。
- **登录提示需确认邮箱**：后台 Authentication → Email 关闭 Confirm email，或先去邮箱点链接。
- **APK 打包报缺 Android SDK**：装 Android Studio，SDK Manager 装 Android 14 (API 34) 及 Build-Tools。
- **EXE 打包慢/失败**：首次 `npm install` 需联网下载 Electron 二进制（~80MB），请耐心等待或重试。
- **音乐/B站在手机不可用**：按《云端部署指南.md》把 `server.js` 部署到云端，并让手机访问同一网址即可；APK 还需在 `capacitor.config.json` 填 `server.url` 指向云端。
