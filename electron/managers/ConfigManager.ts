import Store from 'electron-store';
import { app, ipcMain, dialog } from 'electron';
import path from 'path';

interface JavaPaths {
    [version: string]: string; // e.g., { "8": "path/to/java8", "17": "auto", "21": "path/to/java21" }
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
        showConsoleOnLaunch: true
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
                        // Detect loader type
                        const loader = this.detectLoaderFromJson(jsonPath, folder);
                        const version = this.extractVersion(folder);

                        results.push({
                            id: folder,
                            name: folder,
                            version: version,
                            loader: loader
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

    private detectLoaderFromJson(jsonPath: string, id: string): string {
        try {
            const fs = require('fs');
            const content = fs.readFileSync(jsonPath, 'utf-8');
            const data = JSON.parse(content);
            const lowerId = id.toLowerCase();

            // Check ID/Name heuristics
            if (lowerId.includes('neoforge')) return 'neoforge';
            if (lowerId.includes('forge')) return 'forge';
            if (lowerId.includes('fabric')) return 'fabric';
            if (lowerId.includes('quilt')) return 'quilt';

            // Check JSON mainClass
            const mainClass = data.mainClass || '';
            if (mainClass.includes('fabric')) return 'fabric';
            if (mainClass.includes('forge') || mainClass.includes('cpw.mods')) return 'forge';
            if (mainClass.includes('quilt')) return 'quilt';

            // Libraries check
            if (data.libraries && Array.isArray(data.libraries)) {
                const libs = data.libraries.map((l: any) => l.name || '');
                if (libs.some((n: string) => n.includes('net.fabricmc:fabric-loader'))) return 'fabric';
                if (libs.some((n: string) => n.includes('net.neoforged'))) return 'neoforge';
                if (libs.some((n: string) => n.includes('minecraftforge'))) return 'forge';
                if (libs.some((n: string) => n.includes('org.quiltmc'))) return 'quilt';
            }

            return 'vanilla';
        } catch {
            return 'vanilla';
        }
    }

    private extractVersion(folderId: string): string {
        // Try to extract MC version from folder name
        // Common patterns: "1.20.4", "fabric-loader-0.15.0-1.20.4", "1.20.4-forge-49.0.0"
        const mcVersionMatch = folderId.match(/(\d+\.\d+(?:\.\d+)?)/);
        return mcVersionMatch ? mcVersionMatch[1] : folderId;
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
}
