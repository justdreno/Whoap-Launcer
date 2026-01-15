import { ipcMain, net } from 'electron';

const VANILLA_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_LOADER_URL = 'https://meta.fabricmc.net/v2/versions/loader';
const FABRIC_GAME_URL = 'https://meta.fabricmc.net/v2/versions/game';

export interface MinecraftVersion {
    id: string;
    type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
    url: string;
    releaseTime: string;
}

export interface FabricLoaderVersion {
    version: string;
    stable: boolean;
}

export interface VersionManifest {
    latest: {
        release: string;
        snapshot: string;
    };
    versions: MinecraftVersion[];
}

// Helper to fetch JSON using Electron's net module (bypasses CORS issues)
async function fetchJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const request = net.request(url);
        let data = '';

        request.on('response', (response) => {
            response.on('data', (chunk) => {
                data += chunk.toString();
            });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Failed to parse JSON from ' + url));
                }
            });
            response.on('error', (err) => {
                reject(err);
            });
        });

        request.on('error', (err) => {
            reject(err);
        });

        request.end();
    });
}

export class VersionManager {
    private vanillaManifest: VersionManifest | null = null;
    private fabricLoaders: FabricLoaderVersion[] = [];
    private fabricGames: { version: string; stable: boolean }[] = [];

    constructor() {
        this.registerListeners();
        console.log('[VersionManager] Initialized');
    }

    private registerListeners() {
        // Fetch Vanilla versions
        ipcMain.handle('versions:get-vanilla', async () => {
            console.log('[VersionManager] Fetching vanilla versions...');
            try {
                if (!this.vanillaManifest) {
                    this.vanillaManifest = await fetchJson<VersionManifest>(VANILLA_MANIFEST_URL);
                    console.log('[VersionManager] Loaded', this.vanillaManifest.versions.length, 'vanilla versions');
                }
                return {
                    success: true,
                    latest: this.vanillaManifest.latest,
                    versions: this.vanillaManifest.versions
                };
            } catch (error) {
                console.error('[VersionManager] Failed to fetch vanilla manifest:', error);
                return { success: false, error: String(error) };
            }
        });

        // Fetch Fabric loaders
        ipcMain.handle('versions:get-fabric-loaders', async () => {
            try {
                if (this.fabricLoaders.length === 0) {
                    const loaders = await fetchJson<{ version: string; stable: boolean }[]>(FABRIC_LOADER_URL);
                    this.fabricLoaders = loaders.map(l => ({ version: l.version, stable: l.stable }));
                }
                return { success: true, loaders: this.fabricLoaders };
            } catch (error) {
                console.error('[VersionManager] Failed to fetch Fabric loaders:', error);
                return { success: false, error: String(error) };
            }
        });

        // Fetch Fabric-compatible game versions
        ipcMain.handle('versions:get-fabric-games', async () => {
            try {
                if (this.fabricGames.length === 0) {
                    this.fabricGames = await fetchJson<{ version: string; stable: boolean }[]>(FABRIC_GAME_URL);
                }
                return { success: true, versions: this.fabricGames };
            } catch (error) {
                console.error('[VersionManager] Failed to fetch Fabric game versions:', error);
                return { success: false, error: String(error) };
            }
        });

        // Get version details (for downloading assets/libraries)
        ipcMain.handle('versions:get-details', async (_, versionId: string) => {
            try {
                if (!this.vanillaManifest) {
                    this.vanillaManifest = await fetchJson<VersionManifest>(VANILLA_MANIFEST_URL);
                }

                const version = this.vanillaManifest.versions.find(v => v.id === versionId);
                if (!version) {
                    return { success: false, error: 'Version not found' };
                }

                // Fetch the detailed version JSON
                const details = await fetchJson<any>(version.url);
                return { success: true, details };
            } catch (error) {
                console.error('[VersionManager] Failed to fetch version details:', error);
                return { success: false, error: String(error) };
            }
        });

        // Clear cache (useful for refreshing)
        ipcMain.handle('versions:refresh', async () => {
            this.vanillaManifest = null;
            this.fabricLoaders = [];
            this.fabricGames = [];
            return { success: true };
        });
    }

    // Static helper for internal use (LaunchProcess)
    static async getVersionDetails(versionId: string): Promise<any> {
        // This is a quick hack to reuse the existing logic without properly refactoring into a shared service
        // In a real app, the manifest fetching and caching should be a singleton service
        const VANILLA_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
        const manifest = await fetchJson<VersionManifest>(VANILLA_MANIFEST_URL);
        const version = manifest.versions.find(v => v.id === versionId);
        if (!version) return null;
        return await fetchJson<any>(version.url);
    }
}
