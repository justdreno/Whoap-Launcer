import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { AuthManager } from './managers/AuthManager';
import { InstanceManager } from './managers/InstanceManager';
import { ConfigManager } from './managers/ConfigManager';
import { ModsManager } from './managers/ModsManager';
import { ModpackManager } from './managers/ModpackManager';
import { SkinServerManager } from './managers/SkinServerManager';
import { LogWindowManager } from './managers/LogWindowManager';
import { AutoUpdateManager } from './managers/AutoUpdateManager';
import { ScreenshotManager } from './managers/ScreenshotManager';
import { NetworkManager } from './managers/NetworkManager';
import { LaunchProcess } from './launcher/LaunchProcess';

let mainWindow: BrowserWindow | null = null;
let skinServer: SkinServerManager | null = null;

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        backgroundColor: '#000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    // Development vs Production URL
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Window Management IPC
    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
        if (mainWindow?.isMaximized()) mainWindow.unmaximize();
        else mainWindow?.maximize();
    });
    ipcMain.on('window:close', () => mainWindow?.close());

    // Skin Server Info IPC
    ipcMain.handle('skin:get-server-info', () => {
        return {
            url: skinServer?.getServerUrl() || 'http://127.0.0.1:25500',
            port: skinServer?.getPort() || 25500
        };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Ensure single instance
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        // Initialize Managers
        new AuthManager();
        InstanceManager.getInstance();
        new ConfigManager();
        new ModsManager();
        new ModpackManager();
        new LaunchProcess();
        new ScreenshotManager();
        new NetworkManager();
        new LogWindowManager();

        // Start Skin Server
        skinServer = new SkinServerManager();

        // Auto Update
        const autoUpdate = AutoUpdateManager.getInstance();
        autoUpdate.setMainWindow(mainWindow!);

        createWindow();
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});