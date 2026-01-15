import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import path from 'path'

process.env.DIST = path.join(__dirname, '../dist-react')
process.env.PUBLIC = app.isPackaged ? process.env.DIST! : path.join(process.env.DIST!, '../public')

let win: BrowserWindow | null
let tray: Tray | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        resizable: true,
        frame: false, // Frameless for custom titlebar
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        transparent: true,
        // Use logo.png for icon (works in both dev and prod)
        icon: app.isPackaged
            ? path.join(process.resourcesPath, 'icon.png')
            : path.join(__dirname, '../src/assets/logo.png')
    })

    // Test active push message to user 
    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL!)
    } else {
        win.loadFile(path.join(process.env.DIST!, 'index.html'))
    }
}

function createTray() {
    // Use logo.png for tray icon
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(__dirname, '../src/assets/logo.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Launcher', click: () => win?.show() },
        {
            label: 'Quit', click: () => {
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Whoap Launcher');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (win?.isVisible()) {
            win.hide();
        } else {
            win?.show();
        }
    });

    // Handle balloon click if needed specific to OS
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

import { AuthManager } from './managers/AuthManager';
import { SkinServerManager } from './managers/SkinServerManager';
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
import { ScreenshotManager } from './managers/ScreenshotManager';

app.whenReady().then(() => {
    new ConfigManager(); // Init first
    new AuthManager();
    new SkinServerManager();
    InstanceManager.getInstance();
    new VersionManager();
    new LaunchProcess();
    new LogWindowManager(); // Init listeners
    new ModpackManager(); // Init Modpack IPC
    new ModsManager(); // Init Mods IPC
    new NetworkManager(); // Init Network IPC
    new ScreenshotManager(); // Init Screenshot IPC
    CloudManager.getInstance(); // Init Cloud

    // Reset handler - mode: 'database' | 'full'
    // 'database' = only clear launcher config, keep game files
    // 'full' = delete everything including instances
    ipcMain.handle('app:reset', async (_, mode: 'database' | 'full' = 'database') => {
        const userDataPath = app.getPath('userData');
        const fs = require('fs');
        const path = require('path');

        try {
            // Always delete configuration files
            ['auth.json', 'config.json', 'favorites.json', 'whoap-config.json'].forEach(file => {
                const filePath = path.join(userDataPath, file);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });

            if (mode === 'full') {
                // Full reset: Delete instances directory too
                const instancesPath = path.join(userDataPath, 'instances');
                if (fs.existsSync(instancesPath)) {
                    fs.rmSync(instancesPath, { recursive: true, force: true });
                }
            }
            // In 'database' mode, we keep the instances folder but they won't be recognized
            // because the config is cleared. User can re-import them.

            app.relaunch();
            app.exit(0);
            return { success: true };
        } catch (e) {
            console.error(e);
            return { success: false, error: String(e) };
        }
    });

    // Skin Server IPC handlers for multiplayer support
    ipcMain.handle('skin:register-player', async (_, playerData: { uuid: string; name: string; realUuid: string }) => {
        try {
            SkinServerManager.registerPlayer(playerData.uuid, playerData.name, playerData.realUuid);
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('skin:get-server-info', async () => {
        const skinServer = SkinServerManager.getInstance();
        return {
            url: `http://localhost:${skinServer?.getPort() || 3000}`,
            port: skinServer?.getPort() || 3000,
            multiplayerEnabled: true
        };
    });

    ipcMain.on('window-minimize', () => win?.minimize());
    ipcMain.on('window-maximize', () => {
        if (win?.isMaximized()) {
            win.unmaximize();
        } else {
            win?.maximize();
        }
    });
    ipcMain.on('window-close', () => win?.close());

    createWindow();
    createTray();

    // Initialize Auto-Updater
    const updater = AutoUpdateManager.getInstance();
    if (win) {
        updater.setMainWindow(win);
        updater.checkForUpdatesOnStartup();
    }
})
