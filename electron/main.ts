import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';

// --- 0. Load .env manually for Main Process ---
function loadEnv() {
    // During development, __dirname is dist-electron. .env is in project root.
    const envPath = app.isPackaged
        ? path.join(process.resourcesPath, '.env')
        : path.join(__dirname, '../.env');

    if (fs.existsSync(envPath)) {
        try {
            const content = fs.readFileSync(envPath, 'utf8');
            content.split(/\r?\n/).forEach(line => {
                const [key, ...valueParts] = line.split('=');
                if (key && !key.startsWith('#') && valueParts.length > 0) {
                    const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
                    process.env[key.trim()] = value;
                }
            });
            console.log('[Main] Loaded .env file');
        } catch (e) {
            console.error('[Main] Failed to parse .env file:', e);
        }
    }
}

loadEnv();

// Managers Import
import { AuthManager } from './managers/AuthManager';
import { InstanceManager } from './managers/InstanceManager';
import { VersionManager } from './launcher/VersionManager';
import { LaunchProcess } from './launcher/LaunchProcess';
import { ConfigManager } from './managers/ConfigManager';
import { LogWindowManager } from './managers/LogWindowManager';
import { CloudManager } from './managers/CloudManager';
import { ModpackManager } from './managers/ModpackManager';
import { ModsManager } from './managers/ModsManager';
import { NetworkManager } from './managers/NetworkManager';
import { AutoUpdateManager } from './managers/AutoUpdateManager';
import { DiscordManager } from './managers/DiscordManager';
import { ScreenshotManager } from './managers/ScreenshotManager';
import { ModPlatformManager } from './managers/ModPlatformManager';

// Paths Configuration
process.env.DIST = path.join(__dirname, '../dist-react');
process.env.PUBLIC = app.isPackaged ? process.env.DIST! : path.join(process.env.DIST!, '../public');

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

let win: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let tray: Tray | null = null;

// --- 1. Create Splash Screen ---
function createSplashWindow() {
    splash = new BrowserWindow({
        width: 300, // Compact Size
        height: 350,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Load splash.html from public folder
    const splashUrl = VITE_DEV_SERVER_URL
        ? path.join(__dirname, '../public/splash.html')
        : path.join(process.env.DIST!, 'splash.html');

    splash.loadFile(splashUrl);

    console.log('[Main] Splash screen created');
}

// --- 2. Create Main Window ---
function createMainWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        show: false, // Hide initially (wait for splash)
        frame: false, // Custom Titlebar
        transparent: true,
        backgroundColor: '#00000000', // Transparent bg for rounded corners
        icon: getIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL);
    } else {
        win.loadFile(path.join(process.env.DIST!, 'index.html'));
    }

    // When Main Window is Ready
    win.once('ready-to-show', () => {
        // Wait a bit for aesthetics (optional) then swap
        setTimeout(() => {
            splash?.destroy();
            splash = null;
            win?.show();
            win?.focus();

            // Check updates after launch
            AutoUpdateManager.getInstance().setMainWindow(win!);
            AutoUpdateManager.getInstance().checkForUpdatesOnStartup();
        }, 1500);
    });

    // Window Events
    win.on('maximize', () => win?.webContents.send('window:maximized-changed', true));
    win.on('unmaximize', () => win?.webContents.send('window:maximized-changed', false));
    win.on('closed', () => { win = null; });
}

// --- Helper: Get Icon Path ---
function getIconPath() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(__dirname, '../src/assets/logo.png');
}

// --- 3. Tray Icon ---
function createTray() {
    const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 16, height: 16 });
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Launcher', click: () => win?.show() },
        { label: 'Quit', click: () => app.quit() }
    ]);

    tray.setToolTip('Whoap Launcher');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        if (!win) return;
        win.isVisible() ? win.hide() : win.show();
    });
}

// --- 4. App Lifecycle ---
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    app.whenReady().then(async () => {
        console.log("!!! ELECTRON MAIN STARTUP - VERIFICATION LOG !!!");
        // Initialize Core Managers
        new ConfigManager();
        new AuthManager();
        InstanceManager.getInstance();
        new VersionManager();
        new LaunchProcess();
        new LogWindowManager();
        new ModpackManager();
        new ModsManager();
        new NetworkManager();
        new ScreenshotManager();
        CloudManager.getInstance();
        DiscordManager.getInstance();
        ModPlatformManager.getInstance();

        // Register IPC Handlers
        registerIpcHandlers();

        // Start UI Flow
        createSplashWindow(); // Show splash immediately
        createMainWindow();   // Load main app in background
        createTray();
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- 5. IPC Handlers ---
function registerIpcHandlers() {
    // Window Controls
    ipcMain.on('window:minimize', () => win?.minimize());
    ipcMain.on('window:maximize', () => {
        if (!win) return;
        win.isMaximized() ? win.unmaximize() : win.maximize();
    });
    ipcMain.on('window:close', () => win?.close());

    // Legacy Support (just in case)
    ipcMain.on('window-minimize', () => win?.minimize());
    ipcMain.on('window-maximize', () => {
        if (!win) return;
        win.isMaximized() ? win.unmaximize() : win.maximize();
    });
    ipcMain.on('window-close', () => win?.close());

    // App Reset
    ipcMain.handle('app:reset', async (_, mode: 'database' | 'full' = 'database') => {
        const userDataPath = app.getPath('userData');
        const fs = require('fs');

        try {
            ['auth.json', 'config.json', 'favorites.json', 'whoap-config.json'].forEach(file => {
                const f = path.join(userDataPath, file);
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });

            if (mode === 'full') {
                const instancesPath = path.join(userDataPath, 'instances');
                if (fs.existsSync(instancesPath)) fs.rmSync(instancesPath, { recursive: true, force: true });
            }

            app.relaunch();
            app.exit(0);
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

}