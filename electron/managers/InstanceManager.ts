import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { ConfigManager } from './ConfigManager';
import AdmZip from 'adm-zip';
import { dialog } from 'electron';

export interface Instance {
    id: string;
    name: string;
    version: string;
    loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';
    created: number;
    lastPlayed: number;
    type?: 'created' | 'imported';
    isFavorite?: boolean;
    isImported?: boolean;
    launchVersionId?: string; // The actual ID to launch (e.g. fabric-loader-x.x.x-1.20.1)
    useExternalPath?: boolean; // If true, launch using the original version folder as gameDir
}

export class InstanceManager {
    private instancesPath: string;

    constructor() {
        this.instancesPath = ConfigManager.getInstancesPath();
        console.log("InstanceManager initialized. Path:", this.instancesPath);
        this.ensureInstancesDirectory();
        this.registerListeners();
    }
    // ... (rest of class remains, skipping to createInstance modification)


    private ensureInstancesDirectory() {
        if (!existsSync(this.instancesPath)) {
            mkdirSync(this.instancesPath, { recursive: true });
        }
    }

    private registerListeners() {
        ipcMain.handle('instance:create', async (_, data: { name: string; version: string; loader?: string, loaderVersion?: string }) => {
            try {
                return await this.createInstance(data.name, data.version, data.loader, data.loaderVersion);
            } catch (error) {
                console.error("Failed to create instance:", error);
                return { success: false, error: String(error) };
            }
        });

        ipcMain.handle('meta:get-fabric-loaders', async (_, version: string) => {
            return await this.getFabricLoaders(version);
        });

        ipcMain.handle('instance:list', async () => {
            try {
                return await this.getInstances();
            } catch (error) {
                console.error("Failed to list instances:", error);
                return [];
            }
        });

        ipcMain.handle('instance:delete', async (_, id: string) => {
            try {
                return await this.deleteInstance(id);
            } catch (error) {
                console.error("Failed to delete instance:", error);
                return { success: false, error: String(error) };
            }
        });

        ipcMain.handle('meta:get-versions', async () => {
            try {
                return await this.fetchVersions();
            } catch (error) {
                console.error("Failed to fetch versions:", error);
                return [];
            }
        });

        ipcMain.handle('instance:toggle-favorite', async (_, instanceId: string) => {
            return await this.toggleFavorite(instanceId);
        });

        ipcMain.handle('instance:get-options', async (_, instanceId: string) => {
            const instancePath = path.join(this.instancesPath, instanceId);
            if (existsSync(instancePath)) {
                const { GameOptionsManager } = await import('./GameOptionsManager');
                return await GameOptionsManager.readOptions(instancePath);
            }
            return {};
        });

        ipcMain.handle('instance:open-folder', async (_, instanceId: string) => {
            const { shell } = require('electron');
            const instancePath = this.resolveInstancePath(instanceId);

            if (instancePath) {
                await shell.openPath(instancePath);
                return { success: true };
            }
            return { success: false, error: 'Instance path not found' };
        });

        ipcMain.handle('instance:update-last-played', async (_, id: string) => {
            await this.updateLastPlayed(id);
        });

        ipcMain.handle('instance:duplicate', async (_, instanceId: string, newName: string) => {
            console.log(`IPC instance:duplicate called for ${instanceId} -> ${newName}`);
            try {
                return await this.duplicateInstance(instanceId, newName);
            } catch (error) {
                console.error("Failed to duplicate instance:", error);
                return { success: false, error: String(error) };
            }
        });


        ipcMain.handle('instance:export', async (_, instanceId: string) => {
            try {
                return await this.exportInstance(instanceId);
            } catch (error) {
                console.error("Failed to export instance:", error);
                return { success: false, error: String(error) };
            }
        });

        ipcMain.handle('instance:import', async (event) => {
            try {
                return await this.importInstance(event);
            } catch (error) {
                console.error("Failed to import instance:", error);
                return { success: false, error: String(error) };
            }
        });

        ipcMain.handle('instance:rename', async (_, instanceId: string, newName: string) => {
            console.log(`IPC instance:rename called for ${instanceId} -> ${newName}`);
            try {
                return await this.renameInstance(instanceId, newName);
            } catch (error) {
                console.error("Failed to rename instance:", error);
                return { success: false, error: String(error) };
            }
        });

        ipcMain.handle('instance:import-external', async (event, versionIds: string[]) => {
            try {
                return await this.importExternalInstances(event, versionIds);
            } catch (error) {
                console.error("Failed to import external instances:", error);
                return { success: false, error: String(error) };
            }
        });
    }

    private resolveInstancePath(instanceId: string): string | null {
        console.log(`Resolving path for ID: ${instanceId}`);
        // 1. Check local instances (Whoap/instances)
        let p = path.join(this.instancesPath, instanceId);
        if (existsSync(p)) {
            console.log(`Found local instance at: ${p}`);
            return p;
        }

        // 2. Check external versions (.minecraft/versions)
        p = path.join(ConfigManager.getGamePath(), 'versions', instanceId);
        if (existsSync(p)) {
            console.log(`Found external instance at: ${p}`);
            return p;
        }

        console.log("Instance path NOT found.");
        return null;
    }

    private getFavoritesPath(): string {
        return path.join(app.getPath('userData'), 'favorites.json');
    }

    private async loadFavorites(): Promise<string[]> {
        try {
            const p = this.getFavoritesPath();
            if (existsSync(p)) {
                return JSON.parse(await fs.readFile(p, 'utf-8'));
            }
        } catch { }
        return [];
    }

    private async toggleFavorite(instanceId: string) {
        const favorites = await this.loadFavorites();
        const index = favorites.indexOf(instanceId);
        if (index === -1) {
            favorites.push(instanceId);
        } else {
            favorites.splice(index, 1);
        }
        await fs.writeFile(this.getFavoritesPath(), JSON.stringify(favorites));
        return { success: true, isFavorite: index === -1 };
    }

    async updateLastPlayed(instanceId: string) {
        const instancePath = path.join(this.instancesPath, instanceId);
        if (existsSync(instancePath)) {
            try {
                const configPath = path.join(instancePath, 'instance.json');
                const content = await fs.readFile(configPath, 'utf-8');
                const data = JSON.parse(content);
                data.lastPlayed = Date.now();
                await fs.writeFile(configPath, JSON.stringify(data, null, 4));
            } catch (e) {
                console.error("Failed to update last played", e);
            }
        }
    }

    async fetchVersions() {
        // Fetch from Mojang's Piston Meta
        const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        const data = await response.json();
        return data.versions.filter((v: any) => v.type === 'release'); // Only return releases for now
    }

    async getFabricLoaders(gameVersion: string) {
        try {
            const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`);
            const data = await res.json();
            return data.map((l: any) => ({
                id: l.loader.version,
                stable: l.loader.stable
            }));
        } catch (e) {
            console.error("Failed to fetch fabric loaders", e);
            return [];
        }
    }

    async createInstance(name: string, version: string, loader: string = 'vanilla', loaderVersion?: string) {
        const folderName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const instancePath = path.join(this.instancesPath, folderName);

        if (existsSync(instancePath)) {
            throw new Error("Instance with this name/folder already exists.");
        }

        // Install Fabric Loader if requested
        let launchVersionId = version; // Default to vanilla version

        if (loader === 'fabric') {
            try {
                // If specific loader version not provided, fetch stable defaults
                let targetLoaderVersion = loaderVersion;

                if (!targetLoaderVersion) {
                    // 1. Fetch stable loader version for this game version
                    const metaRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
                    const metaData = await metaRes.json();

                    if (metaData && metaData.length > 0) {
                        const bestLoader = metaData.find((l: any) => l.loader.stable) || metaData[0];
                        targetLoaderVersion = bestLoader.loader.version;
                    }
                }

                if (targetLoaderVersion) {
                    // 2. Fetch the actual profile JSON
                    // Format: https://meta.fabricmc.net/v2/versions/loader/<game_version>/<loader_version>/profile/json
                    const profileRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${version}/${targetLoaderVersion}/profile/json`);
                    const profileJson = await profileRes.json();

                    // 3. Save to versions folder (Standard Minecraft structure)
                    // The ID usually looks like "fabric-loader-0.15.7-1.20.1"
                    const versionId = profileJson.id;
                    const versionsDir = path.join(ConfigManager.getGamePath(), 'versions');
                    const versionDir = path.join(versionsDir, versionId);

                    if (!existsSync(versionDir)) {
                        await fs.mkdir(versionDir, { recursive: true });
                        await fs.writeFile(path.join(versionDir, `${versionId}.json`), JSON.stringify(profileJson, null, 4));
                    }

                    launchVersionId = versionId;
                }
            } catch (e) {
                console.warn("Failed to install Fabric loader", e);
                // Fallback to vanilla creation but warn
            }
        }

        const instanceData: Instance = {
            id: folderName,
            name: name,
            version: version,
            loader: loader as 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt',
            created: Date.now(),
            lastPlayed: 0,
            type: 'created',
            launchVersionId: launchVersionId
        };

        await fs.mkdir(instancePath, { recursive: true });
        await fs.writeFile(
            path.join(instancePath, 'instance.json'),
            JSON.stringify(instanceData, null, 4)
        );

        return { success: true, instance: instanceData };
    }

    async deleteInstance(instanceId: string) {
        const instancePath = this.resolveInstancePath(instanceId);

        if (instancePath) {
            // Check if it's in the instances folder to allow safe deletion
            // Or allow deleting external versions too? User asked for "really delete".
            // Let's allow it but maybe careful.
            await fs.rm(instancePath, { recursive: true, force: true });
            return { success: true };
        }
        return { success: false, error: "Instance not found" };
    }

    async renameInstance(instanceId: string, newName: string) {
        const instancePath = this.resolveInstancePath(instanceId);
        if (!instancePath) throw new Error("Instance not found");

        const configPath = path.join(instancePath, 'instance.json');
        if (existsSync(configPath)) {
            const content = await fs.readFile(configPath, 'utf-8');
            const data = JSON.parse(content);
            data.name = newName;
            await fs.writeFile(configPath, JSON.stringify(data, null, 4));
            return { success: true };
        } else {
            throw new Error("Cannot rename this instance type (no instance.json)");
        }
    }

    async getInstances(): Promise<Instance[]> {
        const instances: Instance[] = [];
        const externalVersions: Instance[] = [];
        const favorites = await this.loadFavorites();

        // 1. Scan Native Instances (Whoap Created)
        if (existsSync(this.instancesPath)) {
            const entries = await fs.readdir(this.instancesPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const configPath = path.join(this.instancesPath, entry.name, 'instance.json');
                    if (existsSync(configPath)) {
                        try {
                            const content = await fs.readFile(configPath, 'utf-8');
                            const data = JSON.parse(content);
                            instances.push({
                                ...data,
                                type: 'created',
                                isFavorite: favorites.includes(data.id),
                                isImported: false
                            });
                        } catch (e) {
                            console.warn(`Failed to load instance from ${entry.name}`, e);
                        }
                    }
                }
            }
        }

        // 2. Scan External/Shared Versions (TLauncher/Vanilla) from Configured Game Path
        // [MODIFIED] Auto-scan disabled as per user request to only show imported versions.
        /*
        const gamePath = ConfigManager.getGamePath();
        const versionsPath = path.join(gamePath, 'versions');

        if (existsSync(versionsPath)) {
            try {
                const folders = readdirSync(versionsPath);
                for (const folder of folders) {
                    // Avoid duplicating if we already have a created instance with this exact ID
                    if (!instances.some(i => i.id === folder)) {
                        // Check if it looks like a version (has json)
                        const jsonPath = path.join(versionsPath, folder, `${folder}.json`);

                        // TLauncher/Standard requirement: JSON must exist.
                        if (existsSync(jsonPath)) {
                            // Detect Loader
                            const loaderType = this.detectLoader(jsonPath, folder);

                            // Detect Version Robustly
                            const cleanVersion = this.extractVersion(jsonPath, folder);

                            externalVersions.push({
                                id: folder,
                                name: folder, // Clean name
                                version: cleanVersion,
                                loader: loaderType as any,
                                created: 0,
                                lastPlayed: 0,
                                type: 'imported',
                                isFavorite: favorites.includes(folder),
                                isImported: true
                            });
                        }
                    }
                }
            } catch (e) {
                console.warn("Failed to scan external versions", e);
            }
        }
        */

        const allInstances = [...instances, ...externalVersions];

        // Sort: Favorites first, then created flag? No, favorites first, then Version/Name
        return allInstances.sort((a, b) => {
            if (a.isFavorite && !b.isFavorite) return -1;
            if (!a.isFavorite && b.isFavorite) return 1;

            // Then by valid version number
            const parseVersion = (v: string) => {
                const parts = v.toString().replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n) || 0);
                return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
            };
            return parseVersion(b.version) - parseVersion(a.version);
        });
    }

    private detectLoader(jsonPath: string, id: string): string {
        try {
            const content = readFileSync(jsonPath, 'utf-8');
            const data = JSON.parse(content);
            const lowerId = id.toLowerCase();

            // 1. Check ID/Name heuristics
            if (lowerId.includes('neoforge')) return 'neoforge';
            if (lowerId.includes('forge')) return 'forge';
            if (lowerId.includes('fabric')) return 'fabric';
            if (lowerId.includes('quilt')) return 'quilt';

            // 2. Check JSON data
            const mainClass = data.mainClass || '';
            if (mainClass.includes('fabric')) return 'fabric';
            if (mainClass.includes('forge')) return 'forge'; // includes cpw.mods... or net.minecraftforge
            if (mainClass.includes('quilt')) return 'quilt';

            // 3. Libraries check (most robust)
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

    private extractVersion(jsonPath: string, folderName: string): string {
        try {
            const content = readFileSync(jsonPath, 'utf-8');
            const data = JSON.parse(content);

            // 1. Try 'inheritsFrom' (e.g. "1.21.1") - Very reliable for Forge/Fabric
            if (data.inheritsFrom && data.inheritsFrom.match(/^\d+\.\d+(\.\d+)?$/)) {
                return data.inheritsFrom;
            }

            // 2. Try 'jar' property
            if (data.jar && data.jar.match(/^\d+\.\d+(\.\d+)?$/)) {
                return data.jar;
            }

            // 2. Check arguments for version string (sometimes in game arguments)
            // Skipped for now, can be complex.

            // 3. Fallback: Regex on Folder Name
            const versionMatch = folderName.match(/\b1\.\d+(\.\d+)?\b/);
            if (versionMatch) {
                return versionMatch[0];
            }

            // 4. Client.jar version in downloads?
            if (data.downloads && data.downloads.client && data.downloads.client.url) {
                const url = data.downloads.client.url;
                const match = url.match(/\/versions\/(1\.\d+(\.\d+)?)\//);
                if (match) return match[1];
            }

            return folderName;
        } catch {
            // Regex on folder as final backup
            const versionMatch = folderName.match(/\b1\.\d+(\.\d+)?\b/);
            return versionMatch ? versionMatch[0] : folderName;
        }
    }

    async duplicateInstance(instanceId: string, newName: string) {
        const sourcePath = this.resolveInstancePath(instanceId);

        if (!sourcePath) {
            throw new Error('Source instance not found');
        }

        // Create new folder name
        const newFolderName = newName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const destPath = path.join(this.instancesPath, newFolderName);

        if (existsSync(destPath)) {
            throw new Error('An instance with this name already exists');
        }

        // Recursively copy folder
        try {
            await this.copyDirectory(sourcePath, destPath);
        } catch (e) {
            console.error(`Duplicate failed: ${e}`);
            throw e;
        }

        // Update or Create instance.json
        const configPath = path.join(destPath, 'instance.json');

        if (existsSync(configPath)) {
            const content = await fs.readFile(configPath, 'utf-8');
            const data = JSON.parse(content);
            data.id = newFolderName;
            data.name = newName;
            data.created = Date.now();
            data.lastPlayed = 0;
            await fs.writeFile(configPath, JSON.stringify(data, null, 4));
        } else {
            // No instance.json (likely external/vanilla version)
            // We need to generate one so it shows up in Whoap
            let version = 'unknown';
            let loader = 'vanilla';

            try {
                // Find the main version JSON
                const entries = await fs.readdir(destPath);
                const jsonFile = entries.find(f => f.endsWith('.json') && f !== 'instance.json');

                if (jsonFile) {
                    const jsonPath = path.join(destPath, jsonFile);
                    version = this.extractVersion(jsonPath, newFolderName);
                    loader = this.detectLoader(jsonPath, newFolderName);
                }
            } catch (e) {
                console.warn("Failed to detect version for duplicate", e);
            }

            const data: Instance = {
                id: newFolderName,
                name: newName,
                version: version,
                loader: loader as any,
                created: Date.now(),
                lastPlayed: 0,
                type: 'created'
            };
            await fs.writeFile(configPath, JSON.stringify(data, null, 4));
        }

        return { success: true, instanceId: newFolderName };
    }

    private async copyDirectory(src: string, dest: string) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }



    async exportInstance(instanceId: string) {
        const instancePath = this.resolveInstancePath(instanceId);

        if (!instancePath) {
            throw new Error('Instance not found');
        }

        const { filePath } = await dialog.showSaveDialog({
            title: 'Export Instance',
            defaultPath: `${instanceId}.zip`,
            filters: [{ name: 'Zip Files', extensions: ['zip'] }]
        });

        if (!filePath) return { success: false, canceled: true };

        const zip = new AdmZip();
        zip.addLocalFolder(instancePath);

        // Check if instance.json exists, if not, generate and add it
        const configPath = path.join(instancePath, 'instance.json');
        if (!existsSync(configPath)) {
            let version = 'unknown';
            let loader = 'vanilla';
            try {
                const entries = await fs.readdir(instancePath);
                const jsonFile = entries.find(f => f.endsWith('.json') && f !== 'instance.json');
                if (jsonFile) {
                    const jsonPath = path.join(instancePath, jsonFile);
                    version = this.extractVersion(jsonPath, instanceId);
                    loader = this.detectLoader(jsonPath, instanceId);
                }
            } catch (e) { }

            const data: Instance = {
                id: instanceId, // Use original ID/Name for export
                name: instanceId,
                version: version,
                loader: loader as any,
                created: Date.now(),
                lastPlayed: 0,
                type: 'created'
            };
            zip.addFile('instance.json', Buffer.from(JSON.stringify(data, null, 4)));
        }

        zip.writeZip(filePath);

        return { success: true, filePath };
    }

    async importInstance(event?: any) {
        const { filePaths } = await dialog.showOpenDialog({
            title: 'Import Instance',
            properties: ['openFile'],
            filters: [{ name: 'Zip Files', extensions: ['zip'] }]
        });

        if (!filePaths || filePaths.length === 0) return { success: false, canceled: true };

        event?.sender.send('instance:import-progress', { status: 'Reading zip file...', progress: 10 });

        const zipPath = filePaths[0];
        const zip = new AdmZip(zipPath);

        // Read instance.json from zip to get ID/Name
        const zipEntries = zip.getEntries();
        const configEntry = zipEntries.find(entry => entry.entryName === 'instance.json');

        if (!configEntry) {
            throw new Error('Invalid instance file: instance.json not found inside zip.');
        }

        event?.sender.send('instance:import-progress', { status: 'Parsing configuration...', progress: 30 });

        const configContent = configEntry.getData().toString('utf8');
        let config;
        try {
            config = JSON.parse(configContent);
        } catch (e) {
            throw new Error('Invalid instance.json file');
        }

        // Logic to avoid overwriting existing instance
        let newInstanceId = config.id || path.basename(zipPath, '.zip').toLowerCase().replace(/[^a-z0-9]/g, '_');
        let counter = 1;
        while (existsSync(path.join(this.instancesPath, newInstanceId))) {
            newInstanceId = `${config.id}_${counter}`;
            counter++;
        }

        event?.sender.send('instance:import-progress', { status: 'Extracting files...', progress: 50 });

        const destPath = path.join(this.instancesPath, newInstanceId);
        zip.extractAllTo(destPath, true);

        // Update ID in the extracted config if it changed
        if (config.id !== newInstanceId) {
            config.id = newInstanceId;
            // Optionally update name if duplicated? Keep name same for now.
            await fs.writeFile(path.join(destPath, 'instance.json'), JSON.stringify(config, null, 4));
        }

        event?.sender.send('instance:import-progress', { status: 'Finalizing...', progress: 100 });

        return { success: true, instanceId: newInstanceId };
    }

    async importExternalInstances(event: any, versionIds: string[]) {
        const gamePath = ConfigManager.getGamePath();
        const versionsPath = path.join(gamePath, 'versions');
        const results: { success: boolean, id: string, error?: string }[] = [];

        const total = versionIds.length;
        let current = 0;

        // Parallel import with concurrency limit
        const limit = 5; // Increased limit because we are just writing small files now
        const chunks = [];
        for (let i = 0; i < versionIds.length; i += limit) {
            chunks.push(versionIds.slice(i, i + limit));
        }

        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (id) => {
                try {
                    const sourcePath = path.join(versionsPath, id);
                    if (!existsSync(sourcePath)) {
                        results.push({ success: false, id, error: 'Source version not found' });
                        return;
                    }

                    const destPath = path.join(this.instancesPath, id);
                    if (existsSync(destPath)) {
                        results.push({ success: false, id, error: 'Instance already exists' });
                        return;
                    }

                    // DO NOT COPY - Just create the instance folder and config
                    await fs.mkdir(destPath, { recursive: true });

                    // Create instance.json
                    let version = 'unknown';
                    let loader = 'vanilla';

                    const jsonPath = path.join(sourcePath, `${id}.json`);
                    if (existsSync(jsonPath)) {
                        version = this.extractVersion(jsonPath, id);
                        loader = this.detectLoader(jsonPath, id);
                    }

                    const data: Instance = {
                        id: id,
                        name: id,
                        version: version,
                        loader: loader as any,
                        created: Date.now(),
                        lastPlayed: 0,
                        type: 'imported',
                        isImported: true,
                        launchVersionId: id,
                        useExternalPath: true // This tells the launcher to use the sourcePath as gameDir
                    };

                    await fs.writeFile(path.join(destPath, 'instance.json'), JSON.stringify(data, null, 4));
                    results.push({ success: true, id });

                } catch (e) {
                    console.error(`Failed to import ${id}`, e);
                    results.push({ success: false, id, error: String(e) });
                } finally {
                    current++;
                    const progress = (current / total) * 100;
                    event.sender.send('instance:import-progress', {
                        status: `Imported ${current}/${total} versions...`,
                        progress
                    });
                }
            }));
        }

        return { success: true, results };
    }
}
