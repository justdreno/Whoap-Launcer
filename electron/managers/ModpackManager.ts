import { ipcMain } from 'electron';
import { ModrinthApi } from '../api/ModrinthApi';
import { ModpackInstaller } from '../utils/ModpackInstaller';

export class ModpackManager {
    constructor() {
        this.registerListeners();
    }

    private registerListeners() {
        // Search Modpacks (Modrinth for now)
        ipcMain.handle('modpack:search', async (_, query: string, source: 'modrinth' | 'curseforge' = 'modrinth', index = 'relevance') => {
            console.log(`[ModpackManager] Searching ${source} for: "${query}" (sort: ${index})`);
            try {
                if (source === 'modrinth') {
                    // Modrinth Search
                    // Use searchProjects directly to support index/sorting
                    const results = await ModrinthApi.searchProjects(query, 'modpack', 20, index);
                    return { success: true, results };
                } else if (source === 'curseforge') {
                    // CurseForge Search (Placeholder)
                    return { success: false, error: 'CurseForge support not implemented yet.' };
                }
            } catch (error) {
                console.error('[ModpackManager] Search failed:', error);
                return { success: false, error: 'Search failed' };
            }
        });

        // Get Versions
        ipcMain.handle('modpack:get-versions', async (_, projectId: string, source: 'modrinth' | 'curseforge' = 'modrinth', loaders?: string[], gameVersions?: string[]) => {
            try {
                if (source === 'modrinth') {
                    const versions = await ModrinthApi.getProjectVersions(projectId, loaders, gameVersions);
                    return { success: true, versions };
                }
                return { success: false, error: 'Source not supported' };
            } catch (error) {
                return { success: false, error: 'Failed to fetch versions' };
            }
        });

        // Install Modpack
        ipcMain.handle('modpack:install', async (event, data: any) => {
            console.log(`[ModpackManager] Install request received for ${data.projectName}`);
            try {
                const result = await ModpackInstaller.installFromModrinth(
                    data.versionId,
                    data.projectId,
                    data.projectName,
                    data.iconUrl,
                    (status, progress, total) => {
                        event.sender.send('modpack:install-progress', {
                            status,
                            progress,
                            total
                        });
                    }
                );
                return result;
            } catch (error: any) {
                console.error('[ModpackManager] Install failed:', error);
                return { success: false, error: error.message || 'Unknown install error' };
            }
        });
    }
}
