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
    }

    private getModsPath(instanceId: string): string {
        // 1. Check if it's a created instance (in instances folder)
        const instancesPath = ConfigManager.getInstancesPath();
        const instancePath = path.join(instancesPath, instanceId);

        if (existsSync(instancePath)) {
            return path.join(instancePath, 'mods');
        }

        // 2. Fallback to imported/version instance (in gamedata/versions)
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
}
