import Store from 'electron-store';
import { app, ipcMain, dialog } from 'electron';
import path from 'path';
import { VersionUtils } from '../utils/VersionUtils';

interface JavaPaths {
    [version: string]: string; // e.g., { "8": "path/to/java8", "17": "auto", "21": "path/to/java21" }
}

interface ProxyConfig {
    enabled: boolean;
    host: string;
    port: number;
    type: 'http' | 'socks';
    username?: string;
    password?: string;
}

interface AppConfig {
    gamePath: string;
    instancesPath: string;
    // Memory
    minRam: number;  // MB
    maxRam: number;  // MB
    // Java - per-version paths
    javaPaths: JavaPaths;
    // Launch Behavior
    launchBehavior: 'hide' | 'minimize' | 'keep';
    showConsoleOnLaunch: boolean;
    // JVM Tuning
    jvmPreset: 'potato' | 'standard' | 'pro' | 'extreme' | 'custom';
    jvmArgs: string[];
    // Proxy (Proxifier style)
    proxy: ProxyConfig;
}

const store = new Store<AppConfig>({
    name: 'whoap-config',
    defaults: {
        gamePath: path.join(app.getPath('userData'), 'gamedata'),
        instancesPath: path.join(app.getPath('userData'), 'instances'),
        minRam: 1024,
        maxRam: 4096,
        javaPaths: {},
        launchBehavior: 'hide',
        showConsoleOnLaunch: true,
        jvmPreset: 'standard',
        jvmArgs: [],
        proxy: {
            enabled: false,
            host: '127.0.0.1',
            port: 8080,
            type: 'http'
        }
    }
});

export class ConfigManager {
    constructor() {
        this.registerListeners();
    }

    private registerListeners() {
        // Get all config
        ipcMain.handle('config:get', () => store.store);

        // Set any config key
        ipcMain.handle('config:set', (_, key: keyof AppConfig, value: any) => {
            store.set(key, value);
            return { success: true, value };
        });

        // Dialog to select game path
        ipcMain.handle('config:set-game-path', async () => {
            const result = await dialog.showOpenDialog({
                properties: ['openDirectory'],
                title: 'Select Game Data Folder (.minecraft)'
            });

            if (!result.canceled && result.filePaths.length > 0) {
                const newPath = result.filePaths[0];
                store.set('gamePath', newPath);
                return { success: true, path: newPath };
            }
            return { success: false };
        });

        // Dialog to select Java executable for a specific version
        ipcMain.handle('config:select-java', async (_, version: string) => {
            const result = await dialog.showOpenDialog({
                properties: ['openFile'],
                title: `Select Java ${version} Executable`,
                filters: [
                    { name: 'Executable', extensions: process.platform === 'win32' ? ['exe'] : [''] }
                ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
                const javaPath = result.filePaths[0];
                const javaPaths = store.get('javaPaths') || {};
                javaPaths[version] = javaPath;
                store.set('javaPaths', javaPaths);
                return { success: true, path: javaPath, version };
            }
            return { success: false };
        });

        // Set Java path for a specific version programmatically
        ipcMain.handle('config:set-java', (_, version: string, javaPath: string) => {
            const javaPaths = store.get('javaPaths') || {};
            javaPaths[version] = javaPath;
            store.set('javaPaths', javaPaths);
            return { success: true, version, path: javaPath };
        });

        // Reset Java for a specific version to auto
        ipcMain.handle('config:reset-java', (_, version?: string) => {
            if (version) {
                const javaPaths = store.get('javaPaths') || {};
                delete javaPaths[version];
                store.set('javaPaths', javaPaths);
            } else {
                // Reset all
                store.set('javaPaths', {});
            }
            return { success: true };
        });

        // Get all Java paths
        ipcMain.handle('config:get-java-paths', () => {
            return store.get('javaPaths') || {};
        });

        // Scan versions from game path
        ipcMain.handle('config:scan-versions', async (event) => {
            const gamePath = store.get('gamePath');
            const versionsPath = path.join(gamePath, 'versions');
            const fs = require('fs');
            const results: Array<{ id: string; name: string; version: string; loader: string }> = [];

            if (!fs.existsSync(versionsPath)) {
                return { success: false, error: 'Versions folder not found', versions: [] };
            }

            try {
                const folders = fs.readdirSync(versionsPath);
                const total = folders.length;
                let scanned = 0;

                for (const folder of folders) {
                    const jsonPath = path.join(versionsPath, folder, `${folder}.json`);

                    if (fs.existsSync(jsonPath)) {
                        // Use the new VersionUtils for robust extraction
                        const info = VersionUtils.getInfo(jsonPath, folder);

                        results.push({
                            id: folder,
                            name: info.name,
                            version: info.mcVersion,
                            loader: info.loader
                        });
                    }

                    scanned++;
                    // Emit progress (via webContents if available)
                    if (event.sender) {
                        event.sender.send('config:scan-progress', {
                            progress: scanned,
                            total: total,
                            current: folder
                        });
                    }
                }

                return { success: true, versions: results };
            } catch (e) {
                console.error('Version scan error:', e);
                return { success: false, error: String(e), versions: [] };
            }
        });
    }


    // Static getters for use in other managers
    static getGamePath(): string {
        return store.get('gamePath');
    }

    static getInstancesPath(): string {
        return store.get('instancesPath');
    }

    static getMinRam(): number {
        return store.get('minRam');
    }

    static getMaxRam(): number {
        return store.get('maxRam');
    }

    static getJavaPath(version?: string): string {
        const javaPaths = store.get('javaPaths') || {};
        if (version && javaPaths[version]) {
            return javaPaths[version];
        }
        return 'auto';
    }

    static getJavaPaths(): JavaPaths {
        return store.get('javaPaths') || {};
    }

    static getLaunchBehavior(): string {
        return store.get('launchBehavior');
    }

    static getShowConsoleOnLaunch(): boolean {
        return store.get('showConsoleOnLaunch');
    }

    static getJvmPreset(): string {
        return store.get('jvmPreset') || 'standard';
    }

    static getJvmArgs(): string[] {
        return store.get('jvmArgs') || [];
    }

    static getProxy(): ProxyConfig {
        return store.get('proxy') || { enabled: false, host: '127.0.0.1', port: 8080, type: 'http' };
    }
}
