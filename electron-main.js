/* 云端（Vercel）无 Electron 环境，直接安全退出，避免 Serverless 打包/运行时崩溃 */
if (process.env.VERCEL || !process.versions.electron) {
  module.exports = {};
  return;
}
/* ============================================================
 * 极简业务工作台 · Electron 主进程（打包成 Windows EXE 用）
 * 职责：
 *   1. 启动内置的本地代理 server.js（网易云/B站跨域中转）
 *   2. 打开一个只加载该地址的窗口，体验等同 App
 * 依赖：npm i electron electron-builder 后，npm run dist:win 产出安装包
 * ============================================================ */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const isDev = !!process.env.WB_DEV;

let win = null;
let serverProc = null;

function startServer() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: Object.assign({}, process.env, { NO_OPEN: '1', PORT: '8848' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    serverProc = child;
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/WB_ADDR=(http:\/\/localhost:\d+)/);
      if (m) resolve(m[1]);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { if (code && code !== 0) console.error('server exit', code); });
    // 兜底：3 秒内没解析到地址就直接用默认端口
    setTimeout(() => resolve('http://localhost:8848'), 3000);
  });
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 960, minHeight: 640,
    backgroundColor: '#fafafa',
    icon: path.join(ROOT, 'icon.svg'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: true }
  });
  win.loadURL(url);
  if (isDev) win.webContents.openDevTools();
  win.on('closed', () => { win = null; });
  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  const url = await startServer();
  createWindow(url);
});

app.on('window-all-closed', () => {
  if (serverProc) try { serverProc.kill(); } catch (e) {}
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { if (serverProc) try { serverProc.kill(); } catch (e) {} });
