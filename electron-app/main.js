const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session, ipcMain, Notification, net } = require('electron');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');

const APP_URL = 'http://10.40.10.125:8001';
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_NAME = 'IT Support';
const SESSION_PARTITION = 'persist:it-support';
const AUTH_STORE_KEY = 'authState';
const AUTH_STORAGE_KEYS = ['user', 'token'];
const OUR_SITES = [
    { label: 'GTI Central Portal', url: 'http://10.40.10.105/' },
    { label: 'IT Central Portal', url: 'http://10.40.10.125/itweb/' }
];

const store = new Store({
    name: 'desktop-state',
    defaults: {
        windowBounds: { width: 1200, height: 800 },
        authState: {}
    }
});

let mainWindow;
let tray = null;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', showMainWindow);
}

function getTrayIcon() {
    const iconPath = path.join(__dirname, 'it_support.png');
    if (fs.existsSync(iconPath)) {
        return nativeImage.createFromPath(iconPath);
    }
    return nativeImage.createFromPath(process.execPath);
}

function getAppSession() {
    return session.fromPartition(SESSION_PARTITION);
}

function showMainWindow() {
    if (!mainWindow) {
        createWindow();
        return;
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
}

function hideToTray() {
    if (mainWindow) {
        mainWindow.hide();
    }
}

function exitApp() {
    isQuitting = true;
    app.quit();
}

function createTray() {
    if (tray) return;

    tray = new Tray(getTrayIcon());
    tray.setToolTip(`${APP_NAME} is running`);
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: 'Open IT Support',
            click: showMainWindow
        },
        {
            label: 'Hide to Tray',
            click: hideToTray
        },
        {
            type: 'separator'
        },
        {
            label: 'Exit IT Support',
            click: exitApp
        }
    ]));

    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
}

function createAppMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => mainWindow?.reload()
                },
                {
                    label: 'Hide to Tray',
                    accelerator: process.platform === 'darwin' ? 'Cmd+W' : 'Ctrl+W',
                    click: hideToTray
                },
                {
                    type: 'separator'
                },
                {
                    label: 'Exit IT Support',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Shift+Q',
                    click: exitApp
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Full Screen',
                    accelerator: 'F11',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.setFullScreen(!mainWindow.isFullScreen());
                        }
                    }
                },
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => {
                        const webContents = mainWindow?.webContents;
                        if (webContents) {
                            webContents.setZoomLevel(webContents.getZoomLevel() + 1);
                        }
                    }
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => {
                        const webContents = mainWindow?.webContents;
                        if (webContents) {
                            webContents.setZoomLevel(webContents.getZoomLevel() - 1);
                        }
                    }
                },
                {
                    label: 'Reset Zoom',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => mainWindow?.webContents.setZoomLevel(0)
                }
            ]
        },
        {
            label: 'Our sites',
            submenu: OUR_SITES.map(site => ({
                label: site.label,
                click: () => shell.openExternal(site.url)
            }))
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Open in Browser',
                    click: () => shell.openExternal(APP_URL)
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    const savedBounds = store.get('windowBounds');

    mainWindow = new BrowserWindow({
        width: savedBounds.width || 1200,
        height: savedBounds.height || 800,
        x: savedBounds.x,
        y: savedBounds.y,
        minWidth: 800,
        minHeight: 600,
        show: false,
        icon: path.join(__dirname, 'it_support.png'),
        title: APP_NAME,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            partition: SESSION_PARTITION,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            backgroundThrottling: false
        }
    });

    mainWindow.once('ready-to-show', showMainWindow);
    mainWindow.loadURL(APP_URL);
    createAppMenu();

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(APP_ORIGIN)) {
            return { action: 'allow' };
        }

        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.send('desktop:auth-state', store.get(AUTH_STORE_KEY, {}));
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(APP_ORIGIN)) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            hideToTray();
            return;
        }
    });

    mainWindow.on('resize', saveWindowBounds);
    mainWindow.on('move', saveWindowBounds);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
        if (url.startsWith(APP_ORIGIN)) {
            event.preventDefault();
            callback(true);
            return;
        }

        callback(false);
    });
}

function saveWindowBounds() {
    if (!mainWindow || mainWindow.isMinimized() || mainWindow.isFullScreen()) {
        return;
    }

    store.set('windowBounds', mainWindow.getBounds());
}

function setupIpc() {
    ipcMain.on('auth:get-state', (event) => {
        event.returnValue = store.get(AUTH_STORE_KEY, {});
    });

    ipcMain.on('auth:set-item', (event, key, value) => {
        if (!AUTH_STORAGE_KEYS.includes(key)) return;

        const authState = store.get(AUTH_STORE_KEY, {});
        authState[key] = value;
        store.set(AUTH_STORE_KEY, authState);
    });

    ipcMain.on('auth:remove-item', (event, key) => {
        if (!AUTH_STORAGE_KEYS.includes(key)) return;

        const authState = store.get(AUTH_STORE_KEY, {});
        delete authState[key];
        store.set(AUTH_STORE_KEY, authState);
    });

    ipcMain.on('auth:clear', () => {
        store.set(AUTH_STORE_KEY, {});
    });

    ipcMain.on('notification:show', (event, title, body, payload = {}) => {
        if (!Notification.isSupported()) return;

        const notification = new Notification({
            title: title || APP_NAME,
            body: body || '',
            icon: path.join(__dirname, 'it_support.png')
        });

        notification.on('click', () => {
            showMainWindow();
            mainWindow?.webContents.send('desktop:notification-click', payload);
        });
        notification.show();
    });

    ipcMain.on('file:open-browser', (event, fileUrl) => {
        let fullUrl = fileUrl;
        if (fileUrl && fileUrl.startsWith('/')) {
            fullUrl = APP_URL + fileUrl;
        }
        shell.openExternal(fullUrl).catch((err) => {
            console.error('Error opening URL in browser:', err);
        });
    });

    ipcMain.on('file:open-buffer', (event, buffer, fileName) => {
        const tempDir = app.getPath('temp');
        const safeName = path.basename(fileName || 'document');
        const filePath = path.join(tempDir, `itsupport-${Date.now()}-${safeName}`);

        fs.writeFile(filePath, Buffer.from(buffer), (writeErr) => {
            if (writeErr) {
                console.error('Error writing temp file:', writeErr);
                return;
            }

            shell.openPath(filePath).then((openErr) => {
                if (openErr) {
                    console.error('Error opening file:', openErr);
                }
            });
        });
    });

    ipcMain.on('file:open-external', (event, fileUrl, fileName) => {
        downloadAndOpenExternalFile(fileUrl, fileName);
    });
}

function resolveDownloadUrl(fileUrl) {
    if (!fileUrl) return '';
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        return fileUrl;
    }
    if (fileUrl.startsWith('/')) {
        return APP_URL + fileUrl;
    }
    return fileUrl;
}

function downloadAndOpenExternalFile(fileUrl, fileName, redirectCount = 0) {
    if (redirectCount > 5) {
        console.error('Too many redirects while downloading file');
        return;
    }

    const fullUrl = resolveDownloadUrl(fileUrl);
    const tempDir = app.getPath('temp');
    const safeName = path.basename(fileName || 'document');
    const filePath = path.join(tempDir, `itsupport-${Date.now()}-${safeName}`);

    const request = net.request({
        method: 'GET',
        url: fullUrl,
        session: getAppSession()
    });

    request.on('response', (response) => {
        const statusCode = response.statusCode || 0;

        if (statusCode >= 300 && statusCode < 400) {
            const location = response.headers.location;
            const nextUrl = Array.isArray(location) ? location[0] : location;
            if (nextUrl) {
                downloadAndOpenExternalFile(nextUrl, fileName, redirectCount + 1);
            }
            return;
        }

        if (statusCode !== 200) {
            console.error('Failed to download file:', statusCode, fullUrl);
            return;
        }

        const file = fs.createWriteStream(filePath);
        response.pipe(file);

        file.on('finish', () => {
            file.close(() => {
                shell.openPath(filePath).then((openErr) => {
                    if (openErr) {
                        console.error('Error opening file:', openErr);
                    }
                });
            });
        });

        file.on('error', (err) => {
            fs.unlink(filePath, () => {});
            console.error('Error writing downloaded file:', err);
        });
    });

    request.on('error', (err) => {
        console.error('Error downloading file:', err);
    });

    request.end();
}

function setupSessionPermissions() {
    const appSession = getAppSession();

    appSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const url = webContents.getURL();
        callback(permission === 'notifications' && url.startsWith(APP_ORIGIN));
    });
}

app.setAppUserModelId('com.gti.itsupport');

if (gotSingleInstanceLock) {
    app.whenReady().then(() => {
        setupIpc();
        setupSessionPermissions();
        createTray();
        createWindow();
    });
}

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (isQuitting && process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    showMainWindow();
});
