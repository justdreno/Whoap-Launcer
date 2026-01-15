import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';

export class AutoUpdateManager {
    private static instance: AutoUpdateManager;
    private mainWindow: BrowserWindow | null = null;

    private constructor() {
        // Configure auto-updater
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;

        this.setupListeners();
    }

    public static getInstance(): AutoUpdateManager {
        if (!AutoUpdateManager.instance) {
            AutoUpdateManager.instance = new AutoUpdateManager();
        }
        return AutoUpdateManager.instance;
    }

    public setMainWindow(window: BrowserWindow) {
        this.mainWindow = window;
    }

    private setupListeners() {
        autoUpdater.on('checking-for-update', () => {
            console.log('[AutoUpdater] Checking for updates...');
            this.sendToRenderer('update:checking');
        });

        autoUpdater.on('update-available', (info: UpdateInfo) => {
            console.log('[AutoUpdater] Update available:', info.version);
            this.sendToRenderer('update:available', {
                version: info.version,
                releaseDate: info.releaseDate,
                releaseNotes: info.releaseNotes
            });
        });

        autoUpdater.on('update-not-available', () => {
            console.log('[AutoUpdater] No updates available.');
            this.sendToRenderer('update:not-available');
        });

        autoUpdater.on('download-progress', (progress) => {
            console.log(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`);
            this.sendToRenderer('update:progress', {
                percent: progress.percent,
                bytesPerSecond: progress.bytesPerSecond,
                transferred: progress.transferred,
                total: progress.total
            });
        });

        autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
            console.log('[AutoUpdater] Update downloaded:', info.version);
            this.sendToRenderer('update:downloaded', { version: info.version });
        });

        autoUpdater.on('error', (err) => {
            console.error('[AutoUpdater] Error:', err.message);
            this.sendToRenderer('update:error', { message: err.message });
        });

        // IPC Handlers
        ipcMain.handle('update:check', async () => {
            try {
                const result = await autoUpdater.checkForUpdates();
                return { success: true, updateInfo: result?.updateInfo };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('update:download', async () => {
            try {
                await autoUpdater.downloadUpdate();
                return { success: true };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle('update:install', () => {
            autoUpdater.quitAndInstall(false, true);
        });
    }

    private sendToRenderer(channel: string, data?: any) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, data);
        }
    }

    public async checkForUpdatesOnStartup() {
        // Wait a bit before checking to let app fully load
        setTimeout(async () => {
            try {
                console.log('[AutoUpdater] Running startup check...');
                await autoUpdater.checkForUpdates();
            } catch (err) {
                console.error('[AutoUpdater] Startup check failed:', err);
            }
        }, 5000);
    }
}
