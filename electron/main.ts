import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, protocol, net } from 'electron';
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
import { ResourcePackManager } from './managers/ResourcePackManager';
import { ShaderPackManager } from './managers/ShaderPackManager';

// Paths Configuration
process.env.DIST = path.join(__dirname, '../dist-react');
process.env.PUBLIC = app.isPackaged ? process.env.DIST! : path.join(process.env.DIST!, '../public');

// --- 0.5 Register Protocols as Privileged ---
protocol.registerSchemesAsPrivileged([
    { scheme: 'whoap-skin', privileges: { secure: true, standard: true, supportFetchAPI: true } },
    { scheme: 'whoap-cape', privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

let win: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let tray: Tray | null = null;

// --- 1. Create Splash Screen ---
function createSplashWindow() {
    splash = new BrowserWindow({
        width: 340, // Expanded for new design
        height: 400,
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
        resizable: true, // Allow resizing
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
        new ResourcePackManager();
        new ShaderPackManager();
        new NetworkManager();
        new ScreenshotManager();
        CloudManager.getInstance();
        DiscordManager.getInstance();
        ModPlatformManager.getInstance();

        // Register IPC Handlers
        registerIpcHandlers();

        // Start UI Flow
        createSplashWindow(); // Show splash immediately
        // --- 0.7 Register Protocol Handlers ---
        protocol.handle('whoap-skin', async (request: Request) => {
            console.log(`[Protocol] Request URL: ${request.url}`);
            // Manual parsing is more robust for custom schemes with query params
            let fileName = request.url.replace('whoap-skin://', '');
            fileName = fileName.split('?')[0]; // Strip query string
            fileName = fileName.replace(/\/+$/, ''); // Strip ALL trailing slashes
            fileName = decodeURIComponent(fileName);

            const filePath = path.join(app.getPath('userData'), 'skins', fileName);
            console.log(`[Protocol] Resolved Skin: "${fileName}" -> "${filePath}"`);
            try {
                if (!fs.existsSync(filePath)) {
                    console.warn(`[Protocol] Skin file NOT found at: ${filePath}`);
                    return new Response(null, { status: 404 });
                }
                return await net.fetch('file://' + filePath);
            } catch (e) {
                console.error('[Protocol] Error loading skin', e);
                return new Response(null, { status: 404 });
            }
        });

        protocol.handle('whoap-cape', async (request: Request) => {
            let fileName = request.url.replace('whoap-cape://', '');
            fileName = fileName.split('?')[0]; // Strip query string
            if (fileName.endsWith('/')) fileName = fileName.slice(0, -1); // Strip trailing slash
            fileName = decodeURIComponent(fileName);

            const filePath = path.join(app.getPath('userData'), 'capes', fileName);
            console.log(`[Protocol] Loading cape: ${fileName} -> ${filePath}`);
            try {
                if (!fs.existsSync(filePath)) {
                    console.warn(`[Protocol] Cape file not found: ${filePath}`);
                    return new Response(null, { status: 404 });
                }
                return await net.fetch('file://' + filePath);
            } catch (e) {
                console.error('[Protocol] Failed to load cape', e);
                return new Response(null, { status: 404 });
            }
        });

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

    ipcMain.on('log-to-terminal', (_, message) => {
        console.log(`[Renderer] ${message}`);
    });

    // Skin Import - Open file dialog, copy to appData/skins/
    ipcMain.handle('skin:import', async (_, username?: string) => {
        const { dialog } = require('electron');
        const fsExtra = require('fs');
        const result = await dialog.showOpenDialog({
            title: 'Import Skin',
            filters: [{ name: 'Skin Files', extensions: ['png'] }],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        const srcPath = result.filePaths[0];
        const skinsDir = path.join(app.getPath('userData'), 'skins');

        if (!fsExtra.existsSync(skinsDir)) {
            fsExtra.mkdirSync(skinsDir, { recursive: true });
        }

        // Generate friendly filename
        let fileName;
        if (username) {
            // Sanitize username just in case
            const safeName = username.replace(/[^a-zA-Z0-9_-]/g, '');
            const timestamp = Date.now().toString().slice(-6); // Last 6 digits for brevity
            fileName = `${safeName}_${timestamp}.png`;
        } else {
            fileName = path.basename(srcPath);
        }

        const destPath = path.join(skinsDir, fileName);

        try {
            fsExtra.copyFileSync(srcPath, destPath);
            console.log(`[Skin] Imported skin: ${fileName}`);
            return { success: true, fileName, filePath: destPath };
        } catch (e) {
            console.error('[Skin] Failed to import skin:', e);
            return { success: false, error: String(e) };
        }
    });

    // Get skins directory path
    ipcMain.handle('skin:get-path', async () => {
        return path.join(app.getPath('userData'), 'skins');
    });

    // Cape Import
    ipcMain.handle('cape:import', async () => {
        const { dialog } = require('electron');
        const fsExtra = require('fs');
        const result = await dialog.showOpenDialog({
            title: 'Import Cape',
            filters: [{ name: 'Cape Files', extensions: ['png'] }],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        const srcPath = result.filePaths[0];
        const capesDir = path.join(app.getPath('userData'), 'capes');
        if (!fsExtra.existsSync(capesDir)) fsExtra.mkdirSync(capesDir, { recursive: true });

        const fileName = path.basename(srcPath);
        const destPath = path.join(capesDir, fileName);

        try {
            fsExtra.copyFileSync(srcPath, destPath);
            return { success: true, fileName };
        } catch (e) {
            console.error('Failed to copy cape file', e);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('cape:get-path', () => {
        return path.join(app.getPath('userData'), 'capes');
    });
}