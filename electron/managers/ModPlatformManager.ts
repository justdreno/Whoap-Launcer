import { ipcMain } from 'electron';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { InstanceManager } from './InstanceManager';
import { ConfigManager } from './ConfigManager';

const API_BASE = 'https://api.modrinth.com/v2';
const USER_AGENT = 'WhoapLauncher/2.3.1 (contact@whoap.gg)'; // Replace with real contact if available

interface ModrinthProject {
    project_id: string;
    title: string;
    description: string;
    icon_url?: string;
    slug: string;
    author: string;
    downloads: number;
    follows: number;
    client_side: string;
    server_side: string;
}

interface ModrinthVersion {
    id: string;
    project_id: string;
    author_id: string;
    featured: boolean;
    name: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
    files: {
        hashes: { sha1: string; sha512: string };
        url: string;
        filename: string;
        primary: boolean;
        size: number;
    }[];
    dependencies: {
        version_id?: string;
        project_id?: string;
        file_name?: string;
        dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
    }[];
}

interface InstallStatus {
    modName: string;
    status: 'pending' | 'downloading' | 'installed' | 'skipped' | 'failed';
    error?: string;
}

export class ModPlatformManager {
    private static instance: ModPlatformManager;

    private constructor() {
        this.registerListeners();
    }

    public static getInstance(): ModPlatformManager {
        if (!ModPlatformManager.instance) {
            ModPlatformManager.instance = new ModPlatformManager();
        }
        return ModPlatformManager.instance;
    }

    private registerListeners() {
        ipcMain.handle('mods:search', async (_, query: string, filters: { version: string; loader: string; offset?: number; limit?: number }) => {
            return await this.searchMods(query, filters);
        });

        ipcMain.handle('mods:get-versions', async (_, projectId: string, filters: { version: string; loader: string }) => {
            return await this.getProjectVersions(projectId, filters);
        });

        ipcMain.handle('mods:install', async (event, instanceId: string, versionId: string) => {
            try {
                const results = await this.smartInstall(instanceId, versionId, (status) => {
                    event.sender.send('mods:install-progress', status);
                });
                return { success: true, results };
            } catch (error: any) {
                console.error("Smart install failed:", error);
                return { success: false, error: error.message };
            }
        });
    }

    private async searchMods(query: string, filters: { version: string; loader: string; offset?: number; limit?: number }) {
        try {
            const facets = [
                [`categories:${filters.loader}`],
                [`versions:${filters.version}`],
                ["project_type:mod"]
            ];

            const response = await axios.get(`${API_BASE}/search`, {
                params: {
                    query,
                    facets: JSON.stringify(facets),
                    offset: filters.offset || 0,
                    limit: filters.limit || 20,
                    index: 'relevance'
                },
                headers: { 'User-Agent': USER_AGENT }
            });

            return response.data;
        } catch (error) {
            console.error("Modrinth search error:", error);
            throw error;
        }
    }

    private async getProjectVersions(projectId: string, filters: { version: string; loader: string }) {
        try {
            const response = await axios.get(`${API_BASE}/project/${projectId}/version`, {
                params: {
                    loaders: JSON.stringify([filters.loader]),
                    game_versions: JSON.stringify([filters.version])
                },
                headers: { 'User-Agent': USER_AGENT }
            });
            return response.data as ModrinthVersion[];
        } catch (error) {
            console.error("Failed to fetch versions:", error);
            return [];
        }
    }

    private async getVersion(versionId: string): Promise<ModrinthVersion> {
        const response = await axios.get(`${API_BASE}/version/${versionId}`, {
            headers: { 'User-Agent': USER_AGENT }
        });
        return response.data;
    }

    /**
     * Recursively resolves dependencies and installs them.
     */
    private async smartInstall(
        instanceId: string,
        rootVersionId: string,
        progressCallback: (status: InstallStatus) => void
    ): Promise<InstallStatus[]> {
        const instancePath = path.join(ConfigManager.getInstancesPath(), instanceId);
        const modsDir = path.join(instancePath, 'mods');
        await fs.mkdir(modsDir, { recursive: true });

        const installed = new Set<string>(); // Track installed Project IDs to avoid loops
        const installQueue: ModrinthVersion[] = [];
        const resolutionStack: string[] = [rootVersionId]; // For recursion
        const results: InstallStatus[] = [];

        // 1. Resolve Phase
        const resolve = async (vId: string) => {
            progressCallback({ modName: 'Resolving dependencies...', status: 'pending' });

            try {
                const version = await this.getVersion(vId);

                // If we've already processed this project in this session, skip
                if (installed.has(version.project_id)) return;
                installed.add(version.project_id);

                installQueue.push(version);

                // Check dependencies
                for (const dep of version.dependencies) {
                    if (dep.dependency_type === 'required') {
                        if (dep.version_id) {
                            await resolve(dep.version_id);
                        } else if (dep.project_id) {
                            // Need to find a compatible version for this dependency project
                            // We need the original instance metadata to know which MC version/loader to pick
                            // Ideally, we pass that down. for now, assuming same as parent's game_versions[0]
                            const bestDepVersion = await this.findCompatibleVersion(dep.project_id, version.game_versions[0], version.loaders[0]);
                            if (bestDepVersion) {
                                await resolve(bestDepVersion.id);
                            } else {
                                console.warn(`Could not resolve dependency project ${dep.project_id}`);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Failed to resolve version ${vId}`, e);
            }
        };

        await resolve(rootVersionId);

        // 2. Install Phase
        for (const ver of installQueue) {
            const primaryFile = ver.files.find(f => f.primary) || ver.files[0];
            const destPath = path.join(modsDir, primaryFile.filename);

            // Check if exists (by name or hash could be better, but name is fast)
            try {
                await fs.access(destPath);
                results.push({ modName: ver.name, status: 'skipped' }); // Already exists
                progressCallback({ modName: ver.name, status: 'skipped' });
            } catch {
                // Download
                progressCallback({ modName: ver.name, status: 'downloading' });
                try {
                    const response = await axios.get(primaryFile.url, { responseType: 'stream' });
                    await pipeline(response.data, createWriteStream(destPath));
                    results.push({ modName: ver.name, status: 'installed' });
                    progressCallback({ modName: ver.name, status: 'installed' });
                } catch (e: any) {
                    results.push({ modName: ver.name, status: 'failed', error: e.message });
                    progressCallback({ modName: ver.name, status: 'failed', error: e.message });
                }
            }
        }

        return results;
    }

    private async findCompatibleVersion(projectId: string, gameVersion: string, loader: string): Promise<ModrinthVersion | null> {
        const versions = await this.getProjectVersions(projectId, { version: gameVersion, loader });
        return versions.length > 0 ? versions[0] : null;
    }
}
