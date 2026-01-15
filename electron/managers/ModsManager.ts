import { ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, readdirSync, statSync } from 'fs';
import { ConfigManager } from './ConfigManager';

export interface Mod {
    name: string;
    path: string;
    size: number;
    isEnabled: boolean;
}

export interface ResourcePack {
    name: string;
    path: string;
    size: number;
    isEnabled: boolean;
}

export interface ShaderPack {
    name: string;
    path: string;
    size: number;
    isEnabled: boolean;
}

export class ModsManager {
    constructor() {
        this.registerListeners();
    }

    private registerListeners() {
        // List mods for an instance
        ipcMain.handle('mods:list', async (_, instanceId: string) => {
            try {
                return await this.getMods(instanceId);
            } catch (error) {
                console.error("Failed to list mods:", error);
                return [];
            }
        });

        // Toggle a mod (enable/disable)
        ipcMain.handle('mods:toggle', async (_, instanceId: string, modName: string) => {
            try {
                return await this.toggleMod(instanceId, modName);
            } catch (error) {
                console.error("Failed to toggle mod:", error);
                return { success: false, error: String(error) };
            }
        });

        // Delete a mod
        ipcMain.handle('mods:delete', async (_, instanceId: string, modName: string) => {
            try {
                return await this.deleteMod(instanceId, modName);
            } catch (error) {
                console.error("Failed to delete mod:", error);
                return { success: false, error: String(error) };
            }
        });

        // Add mods (via file dialog)
        ipcMain.handle('mods:add', async (_, instanceId: string) => {
            try {
                const result = await dialog.showOpenDialog({
                    properties: ['openFile', 'multiSelections'],
                    filters: [{ name: 'Mods', extensions: ['jar'] }]
                });

                if (!result.canceled && result.filePaths.length > 0) {
                    const modsPath = this.getModsPath(instanceId);
                    await fs.mkdir(modsPath, { recursive: true });

                    for (const filePath of result.filePaths) {
                        const fileName = path.basename(filePath);
                        await fs.copyFile(filePath, path.join(modsPath, fileName));
                    }
                    return { success: true };
                }
                return { success: false, canceled: true };
            } catch (error) {
                console.error("Failed to add mods:", error);
                return { success: false, error: String(error) };
            }
        });


        // Search for new mods (Modrinth)
        ipcMain.handle('mods:search-new', async (_, query: string) => {
            console.log(`[ModsManager] Searching mods for: ${query}`);
            try {
                const { ModrinthApi } = require('../api/ModrinthApi');
                const results = await ModrinthApi.searchProjects(query, 'mod');
                return { success: true, results };
            } catch (error) {
                console.error("Failed to search mods:", error);
                return { success: false, error: String(error) };
            }
        });

        // Install a new mod (download version file)
        ipcMain.handle('mods:install-new', async (event, instanceId: string, versionId: string, filename: string, url: string) => {
            console.log(`[ModsManager] Installing mod ${filename} to instance ${instanceId}`);
            try {
                const modsPath = this.getModsPath(instanceId);
                await fs.mkdir(modsPath, { recursive: true });

                const destPath = path.join(modsPath, filename);

                // Use axios to download
                const { default: axios } = require('axios'); // Dynamic import if needed or use existing if possible
                // Better to use imported axios if available, but for now reuse dynamic to ensure scope
                const writer = (await import('fs')).createWriteStream(destPath);

                const response = await axios({
                    url,
                    method: 'GET',
                    responseType: 'stream',
                    onDownloadProgress: (progressEvent: any) => {
                        const total = progressEvent.total;
                        const current = progressEvent.loaded;
                        const progress = total ? Math.round((current / total) * 100) : 0;
                        // Send progress to renderer
                        // We use versionId to identify unique installs if needed, or just filename
                        event.sender.send('mods:install-progress', {
                            versionId,
                            progress,
                            status: 'downloading',
                            filename
                        });
                    }
                });

                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                return { success: true };
            } catch (error) {
                console.error("Failed to install mod:", error);
                return { success: false, error: String(error) };
            }
        });

        // Smart version fetching and validation
        ipcMain.handle('mods:get-smart-version', async (_, projectId: string, mcVersion: string, loader: string) => {
            try {
                return await this.getSmartVersion(projectId, mcVersion, loader);
            } catch (error) {
                console.error("[ModsManager] Smart version fetch failed:", error);
                return { success: false, error: String(error) };
            }
        });

        // ===== RESOURCE PACKS =====

        // List resource packs for an instance
        ipcMain.handle('resourcepacks:list', async (_, instanceId: string) => {
            try {
                return await this.getResourcePacks(instanceId);
            } catch (error) {
                console.error("Failed to list resource packs:", error);
                return [];
            }
        });

        // Toggle a resource pack (enable/disable)
        ipcMain.handle('resourcepacks:toggle', async (_, instanceId: string, packName: string) => {
            try {
                return await this.toggleResourcePack(instanceId, packName);
            } catch (error) {
                console.error("Failed to toggle resource pack:", error);
                return { success: false, error: String(error) };
            }
        });

        // Delete a resource pack
        ipcMain.handle('resourcepacks:delete', async (_, instanceId: string, packName: string) => {
            try {
                return await this.deleteResourcePack(instanceId, packName);
            } catch (error) {
                console.error("Failed to delete resource pack:", error);
                return { success: false, error: String(error) };
            }
        });

        // Add resource packs (via file dialog)
        ipcMain.handle('resourcepacks:add', async (_, instanceId: string) => {
            try {
                const result = await dialog.showOpenDialog({
                    properties: ['openFile', 'multiSelections'],
                    filters: [{ name: 'Resource Packs', extensions: ['zip'] }]
                });

                if (!result.canceled && result.filePaths.length > 0) {
                    const packsPath = this.getResourcePacksPath(instanceId);
                    await fs.mkdir(packsPath, { recursive: true });

                    for (const filePath of result.filePaths) {
                        const fileName = path.basename(filePath);
                        await fs.copyFile(filePath, path.join(packsPath, fileName));
                    }
                    return { success: true };
                }
                return { success: false, canceled: true };
            } catch (error) {
                console.error("Failed to add resource packs:", error);
                return { success: false, error: String(error) };
            }
        });

        // Search for resource packs (Modrinth)
        ipcMain.handle('resourcepacks:search-new', async (_, query: string) => {
            console.log(`[ModsManager] Searching resource packs for: ${query}`);
            try {
                const { ModrinthApi } = require('../api/ModrinthApi');
                const results = await ModrinthApi.searchProjects(query, 'resourcepack');
                return { success: true, results };
            } catch (error) {
                console.error("Failed to search resource packs:", error);
                return { success: false, error: String(error) };
            }
        });

        // Install a new resource pack
        ipcMain.handle('resourcepacks:install-new', async (event, instanceId: string, versionId: string, filename: string, url: string) => {
            console.log(`[ModsManager] Installing resource pack ${filename} to instance ${instanceId}`);
            try {
                const packsPath = this.getResourcePacksPath(instanceId);
                await fs.mkdir(packsPath, { recursive: true });

                const destPath = path.join(packsPath, filename);

                const { default: axios } = require('axios');
                const writer = (await import('fs')).createWriteStream(destPath);

                const response = await axios({
                    url,
                    method: 'GET',
                    responseType: 'stream',
                    onDownloadProgress: (progressEvent: any) => {
                        const total = progressEvent.total;
                        const current = progressEvent.loaded;
                        const progress = total ? Math.round((current / total) * 100) : 0;
                        event.sender.send('resourcepacks:install-progress', {
                            versionId,
                            progress,
                            status: 'downloading',
                            filename
                        });
                    }
                });

                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                return { success: true };
            } catch (error) {
                console.error("Failed to install resource pack:", error);
                return { success: false, error: String(error) };
            }
        });

        // ===== SHADERPACKS =====

        // List shaderpacks for an instance
        ipcMain.handle('shaderpacks:list', async (_, instanceId: string) => {
            try {
                return await this.getShaderPacks(instanceId);
            } catch (error) {
                console.error("Failed to list shaderpacks:", error);
                return [];
            }
        });

        // Toggle a shaderpack (enable/disable)
        ipcMain.handle('shaderpacks:toggle', async (_, instanceId: string, packName: string) => {
            try {
                return await this.toggleShaderPack(instanceId, packName);
            } catch (error) {
                console.error("Failed to toggle shaderpack:", error);
                return { success: false, error: String(error) };
            }
        });

        // Delete a shaderpack
        ipcMain.handle('shaderpacks:delete', async (_, instanceId: string, packName: string) => {
            try {
                return await this.deleteShaderPack(instanceId, packName);
            } catch (error) {
                console.error("Failed to delete shaderpack:", error);
                return { success: false, error: String(error) };
            }
        });

        // Add shaderpacks (via file dialog)
        ipcMain.handle('shaderpacks:add', async (_, instanceId: string) => {
            try {
                const result = await dialog.showOpenDialog({
                    properties: ['openFile', 'multiSelections'],
                    filters: [{ name: 'Shader Packs', extensions: ['zip'] }]
                });

                if (!result.canceled && result.filePaths.length > 0) {
                    const packsPath = this.getShaderPacksPath(instanceId);
                    await fs.mkdir(packsPath, { recursive: true });

                    for (const filePath of result.filePaths) {
                        const fileName = path.basename(filePath);
                        await fs.copyFile(filePath, path.join(packsPath, fileName));
                    }
                    return { success: true };
                }
                return { success: false, canceled: true };
            } catch (error) {
                console.error("Failed to add shaderpacks:", error);
                return { success: false, error: String(error) };
            }
        });

        // Search for shaderpacks (Modrinth)
        ipcMain.handle('shaderpacks:search-new', async (_, query: string) => {
            console.log(`[ModsManager] Searching shaderpacks for: ${query}`);
            try {
                const { ModrinthApi } = require('../api/ModrinthApi');
                const results = await ModrinthApi.searchProjects(query, 'shader');
                return { success: true, results };
            } catch (error) {
                console.error("Failed to search shaderpacks:", error);
                return { success: false, error: String(error) };
            }
        });

        // Install a new shaderpack
        ipcMain.handle('shaderpacks:install-new', async (event, instanceId: string, versionId: string, filename: string, url: string) => {
            console.log(`[ModsManager] Installing shaderpack ${filename} to instance ${instanceId}`);
            try {
                const packsPath = this.getShaderPacksPath(instanceId);
                await fs.mkdir(packsPath, { recursive: true });

                const destPath = path.join(packsPath, filename);

                const { default: axios } = require('axios');
                const writer = (await import('fs')).createWriteStream(destPath);

                const response = await axios({
                    url,
                    method: 'GET',
                    responseType: 'stream',
                    onDownloadProgress: (progressEvent: any) => {
                        const total = progressEvent.total;
                        const current = progressEvent.loaded;
                        const progress = total ? Math.round((current / total) * 100) : 0;
                        event.sender.send('shaderpacks:install-progress', {
                            versionId,
                            progress,
                            status: 'downloading',
                            filename
                        });
                    }
                });

                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                return { success: true };
            } catch (error) {
                console.error("Failed to install shaderpack:", error);
                return { success: false, error: String(error) };
            }
        });
    }

    private getModsPath(instanceId: string): string {
        const instancesPath = ConfigManager.getInstancesPath();
        const instancePath = path.join(instancesPath, instanceId);
        const configPath = path.join(instancePath, 'instance.json');

        // 1. Check for referenced imports (no-copy)
        if (existsSync(configPath)) {
            try {
                const data = JSON.parse(readdirSync(instancePath).includes('instance.json')
                    ? require('fs').readFileSync(configPath, 'utf8')
                    : '{}');

                if (data.useExternalPath) {
                    const gamePath = ConfigManager.getGamePath();
                    return path.join(gamePath, 'versions', instanceId, 'mods');
                }
            } catch (e) {
                console.error(`[ModsManager] Failed to read instance.json for ${instanceId}:`, e);
            }
        }

        // 2. Default: Look in the instance's own folder
        if (existsSync(instancePath)) {
            return path.join(instancePath, 'mods');
        }

        // 3. Last resort: standard versions folder (legacy/fallback)
        const gamePath = ConfigManager.getGamePath();
        return path.join(gamePath, 'versions', instanceId, 'mods');
    }

    private async getMods(instanceId: string): Promise<Mod[]> {
        const modsPath = this.getModsPath(instanceId);
        const mods: Mod[] = [];

        if (existsSync(modsPath)) {
            const files = await fs.readdir(modsPath);
            for (const file of files) {
                if (file.endsWith('.jar') || file.endsWith('.jar.disabled')) {
                    const filePath = path.join(modsPath, file);
                    const stats = await fs.stat(filePath);
                    const isEnabled = file.endsWith('.jar');

                    mods.push({
                        name: file,
                        path: filePath,
                        size: stats.size,
                        isEnabled
                    });
                }
            }
        }
        return mods;
    }

    private async toggleMod(instanceId: string, modName: string) {
        const modsPath = this.getModsPath(instanceId);
        const oldPath = path.join(modsPath, modName);

        let newName = '';
        if (modName.endsWith('.disabled')) {
            newName = modName.replace('.disabled', '');
        } else {
            newName = modName + '.disabled';
        }

        const newPath = path.join(modsPath, newName);
        await fs.rename(oldPath, newPath);
        return { success: true, newName };
    }

    private async deleteMod(instanceId: string, modName: string) {
        const modsPath = this.getModsPath(instanceId);
        const filePath = path.join(modsPath, modName);
        await fs.unlink(filePath);
        return { success: true };
    }

    // ===== RESOURCE PACK METHODS =====

    private getResourcePacksPath(instanceId: string): string {
        const instancesPath = ConfigManager.getInstancesPath();
        const instancePath = path.join(instancesPath, instanceId);
        const configPath = path.join(instancePath, 'instance.json');

        // Check for referenced imports (no-copy)
        if (existsSync(configPath)) {
            try {
                const data = JSON.parse(readdirSync(instancePath).includes('instance.json')
                    ? require('fs').readFileSync(configPath, 'utf8')
                    : '{}');

                if (data.useExternalPath) {
                    const gamePath = ConfigManager.getGamePath();
                    return path.join(gamePath, 'versions', instanceId, 'resourcepacks');
                }
            } catch (e) {
                console.error(`[ModsManager] Failed to read instance.json for ${instanceId}:`, e);
            }
        }

        // Default: Look in the instance's own folder
        if (existsSync(instancePath)) {
            return path.join(instancePath, 'resourcepacks');
        }

        // Last resort: standard versions folder (legacy/fallback)
        const gamePath = ConfigManager.getGamePath();
        return path.join(gamePath, 'versions', instanceId, 'resourcepacks');
    }

    private async getResourcePacks(instanceId: string): Promise<ResourcePack[]> {
        const packsPath = this.getResourcePacksPath(instanceId);
        const packs: ResourcePack[] = [];

        if (existsSync(packsPath)) {
            const files = await fs.readdir(packsPath);
            for (const file of files) {
                if (file.endsWith('.zip') || file.endsWith('.zip.disabled')) {
                    const filePath = path.join(packsPath, file);
                    const stats = await fs.stat(filePath);
                    const isEnabled = file.endsWith('.zip');

                    packs.push({
                        name: file,
                        path: filePath,
                        size: stats.size,
                        isEnabled
                    });
                }
            }
        }
        return packs;
    }

    private async toggleResourcePack(instanceId: string, packName: string) {
        const packsPath = this.getResourcePacksPath(instanceId);
        const oldPath = path.join(packsPath, packName);

        let newName = '';
        if (packName.endsWith('.disabled')) {
            newName = packName.replace('.disabled', '');
        } else {
            newName = packName + '.disabled';
        }

        const newPath = path.join(packsPath, newName);
        await fs.rename(oldPath, newPath);
        return { success: true, newName };
    }

    private async deleteResourcePack(instanceId: string, packName: string) {
        const packsPath = this.getResourcePacksPath(instanceId);
        const filePath = path.join(packsPath, packName);
        await fs.unlink(filePath);
        return { success: true };
    }

    // ===== SHADERPACK METHODS =====

    private getShaderPacksPath(instanceId: string): string {
        const instancesPath = ConfigManager.getInstancesPath();
        const instancePath = path.join(instancesPath, instanceId);
        const configPath = path.join(instancePath, 'instance.json');

        // Check for referenced imports (no-copy)
        if (existsSync(configPath)) {
            try {
                const data = JSON.parse(readdirSync(instancePath).includes('instance.json')
                    ? require('fs').readFileSync(configPath, 'utf8')
                    : '{}');

                if (data.useExternalPath) {
                    const gamePath = ConfigManager.getGamePath();
                    return path.join(gamePath, 'versions', instanceId, 'shaderpacks');
                }
            } catch (e) {
                console.error(`[ModsManager] Failed to read instance.json for ${instanceId}:`, e);
            }
        }

        // Default: Look in the instance's own folder
        if (existsSync(instancePath)) {
            return path.join(instancePath, 'shaderpacks');
        }

        // Last resort: standard versions folder (legacy/fallback)
        const gamePath = ConfigManager.getGamePath();
        return path.join(gamePath, 'versions', instanceId, 'shaderpacks');
    }

    private async getShaderPacks(instanceId: string): Promise<ShaderPack[]> {
        const packsPath = this.getShaderPacksPath(instanceId);
        const packs: ShaderPack[] = [];

        if (existsSync(packsPath)) {
            const files = await fs.readdir(packsPath);
            for (const file of files) {
                if (file.endsWith('.zip') || file.endsWith('.zip.disabled')) {
                    const filePath = path.join(packsPath, file);
                    const stats = await fs.stat(filePath);
                    const isEnabled = file.endsWith('.zip');

                    packs.push({
                        name: file,
                        path: filePath,
                        size: stats.size,
                        isEnabled
                    });
                }
            }
        }
        return packs;
    }

    private async toggleShaderPack(instanceId: string, packName: string) {
        const packsPath = this.getShaderPacksPath(instanceId);
        const oldPath = path.join(packsPath, packName);

        let newName = '';
        if (packName.endsWith('.disabled')) {
            newName = packName.replace('.disabled', '');
        } else {
            newName = packName + '.disabled';
        }

        const newPath = path.join(packsPath, newName);
        await fs.rename(oldPath, newPath);
        return { success: true, newName };
    }

    private async deleteShaderPack(instanceId: string, packName: string) {
        const packsPath = this.getShaderPacksPath(instanceId);
        const filePath = path.join(packsPath, packName);
        await fs.unlink(filePath);
        return { success: true };
    }

    /**
     * Upgraded Modrinth Core logic
     */

    private validateLoaderAndVersion(versionNumber: string, loader: string, mcVersion?: string) {
        // Warning: Snapshot/Pre-release detection (contains any letters)
        const isSnapshot = /[a-zA-Z]/.test(versionNumber);

        // Warning: Only Fabric and Forge are officially "supported" for auto-detect logic here
        const normalizedLoader = loader.toLowerCase();
        const isSupportedLoader = normalizedLoader === 'fabric' || normalizedLoader === 'forge';

        // Warning: Invalid Minecraft version (e.g. "BigDoggy")
        const isInvalidMcVersion = mcVersion ? !/^\d+/.test(mcVersion) : false;

        if (isSnapshot || !isSupportedLoader || isInvalidMcVersion) {
            return {
                isValid: false,
                warning: 'Version detect failed, likely imported manually. Please consider that mods, shader packs, or resource packs may conflict.'
            };
        }

        return { isValid: true };
    }

    private async getSmartVersion(projectId: string, mcVersion: string, loader: string) {
        console.log(`[ModsManager] Smart fetching for ${projectId} (MC: ${mcVersion}, Loader: ${loader})`);

        try {
            // 0. Pre-validate MC version string
            if (!/^\d+/.test(mcVersion)) {
                return {
                    success: true,
                    isValid: false,
                    warning: 'Version detect failed, likely imported manually. Please consider that mods, shader packs, or resource packs may conflict.'
                };
            }

            // 1. Fetch compatible versions from Modrinth
            const { ModrinthApi } = require('../api/ModrinthApi');
            const versions = await ModrinthApi.getProjectVersions(projectId, [loader.toLowerCase()], [mcVersion]);

            if (!versions || versions.length === 0) {
                return { success: false, error: 'No compatible versions found.' };
            }

            // 2. Validate the latest version
            const latest = versions[0];
            const validation = this.validateLoaderAndVersion(latest.version_number, loader, mcVersion);

            return {
                success: true,
                version: latest,
                file: latest.files.find((f: any) => f.primary) || latest.files[0],
                warning: validation.warning,
                isValid: validation.isValid
            };
        } catch (error) {
            console.error('[ModsManager] Smart version fetch failed:', error);
            throw error;
        }
    }
}
