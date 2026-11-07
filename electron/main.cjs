const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');

let mainWindow = null;
let staticServer = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function startLocalStaticServer(distDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      let reqUrl = decodeURIComponent((req.url || '/').split('?')[0]);
      if (reqUrl === '/' || reqUrl === '') reqUrl = '/index.html';

      const filePath = path.normalize(path.join(distDir, reqUrl));
      const relative = path.relative(distDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          if (path.extname(reqUrl)) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
          }
          fs.readFile(path.join(distDir, 'index.html'), (readErr, data) => {
            if (readErr) {
              res.statusCode = 404;
              res.end('Not Found');
              return;
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(data);
          });
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
    server.on('error', reject);
  });
}

function resolveIcon() {
  const fileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  if (app.isPackaged) return path.join(process.resourcesPath, fileName);
  return path.join(__dirname, '..', 'build', fileName);
}

function uniqueDownloadPath(dir, filename) {
  const target = path.join(dir, filename);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  for (let i = 1; i < 100; i += 1) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return target;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'step2urdf',
    icon: resolveIcon(),
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.session.on('will-download', (_event, item) => {
    const savePath = uniqueDownloadPath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    const distPath = path.join(__dirname, '../dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      console.error('[step2urdf] dist/index.html 不存在，请先执行 pnpm build:desktop');
      app.quit();
      return;
    }
    const { server, port } = await startLocalStaticServer(distPath);
    staticServer = server;
    await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (staticServer) {
      staticServer.close();
      staticServer = null;
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('top.step2urdf.desktop');
    return createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    if (staticServer) {
      staticServer.close();
      staticServer = null;
    }
  });
}
