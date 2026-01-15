import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { ModrinthApi } from '../api/ModrinthApi';
import { ConfigManager } from '../managers/ConfigManager';
import { randomUUID } from 'crypto';

export class ModpackInstaller {
    private static instancesDir = path.join(app.getPath('userData'), 'instances');

    static async installFromModrinth(
        versionId: string,
        projectId: string,
        projectName: string,
        iconUrl: string | undefined,
        onProgress: (status: string, progress: number, total: number) => void
    ) {
        console.log(`[ModpackInstaller] Starting install for ${projectName} (Version: ${versionId})`);

        try {
            onProgress("Fetching version details...", 0, 100);
            const versionData = await axios.get(`https://api.modrinth.com/v2/version/${versionId}`, {
                headers: { 'User-Agent': 'WhoapLauncher/1.0' }
            });
            const files = versionData.data.files;
            const primary = files.find((f: any) => f.primary) || files[0];

            if (!primary || !primary.url.endsWith('.mrpack')) {
                throw new Error("No .mrpack file found for this version.");
            }

            // Setup Instance Paths
            const safeName = projectName.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
            let instanceDir = path.join(this.instancesDir, safeName);
            let counter = 1;
            while (fs.existsSync(instanceDir)) {
                instanceDir = path.join(this.instancesDir, `${safeName}_${counter}`);
                counter++;
            }
            fs.mkdirSync(instanceDir, { recursive: true });

            // Download .mrpack
            onProgress("Downloading modpack configuration...", 10, 100);
            console.log(`[ModpackInstaller] Downloading .mrpack from ${primary.url}`);
            const packPath = path.join(instanceDir, 'modpack.mrpack');
            await this.downloadFile(primary.url, packPath);

            // Extract .mrpack
            onProgress("Extracting configuration...", 20, 100);
            const zip = new AdmZip(packPath);
            zip.extractAllTo(instanceDir, true);

            // Read index
            const indexPath = path.join(instanceDir, 'modrinth.index.json');
            if (!fs.existsSync(indexPath)) throw new Error("Invalid modpack: modrinth.index.json missing");
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

            // Init Directories
            const modsDir = path.join(instanceDir, 'mods');
            fs.mkdirSync(modsDir, { recursive: true });

            // Handle Overrides
            const overridesDir = path.join(instanceDir, 'overrides');
            if (fs.existsSync(overridesDir)) this.copyRecursiveSync(overridesDir, instanceDir);

            const clientOverridesDir = path.join(instanceDir, 'client-overrides');
            if (fs.existsSync(clientOverridesDir)) this.copyRecursiveSync(clientOverridesDir, instanceDir);

            // Download Mods
            const downloads = indexData.files;
            const totalMods = downloads.length;

            // Calculate total size if available (often implied in indexData, check spec)
            // Modrinth index 'files' entries: { path, hashes, env, downloads: [url], fileSize: int }
            // Let's assume fileSize is there (it is in spec).
            const totalBytes = downloads.reduce((acc: number, f: any) => acc + (f.fileSize || 0), 0);
            const totalMB = (totalBytes / 1024 / 1024).toFixed(1);

            console.log(`[ModpackInstaller] Downloading ${totalMods} mods (${totalMB} MB)...`);

            // Process downloads with concurrency limit (e.g., 5) to avoid flooding and better tracking
            const CONCURRENCY = 5;
            let completed = 0;
            let bytesDownloaded = 0;

            const downloadQueue = [...downloads];
            const activeWorkers = [];

            const downloadWorker = async () => {
                while (downloadQueue.length > 0) {
                    const file = downloadQueue.shift();
                    if (!file) break;

                    if (file.env && file.env.client === 'unsupported') continue;

                    const destPath = path.join(instanceDir, file.path);
                    const destFolder = path.dirname(destPath);
                    if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

                    const url = file.downloads[0];
                    try {
                        await this.downloadFile(url, destPath);
                        completed++;
                        bytesDownloaded += (file.fileSize || 0);

                        // Report Progress
                        // Scale: 30% to 90% is downloading
                        const overallPercent = 30 + Math.floor((completed / totalMods) * 60);
                        onProgress(`Downloading mods: ${completed}/${totalMods} (${(bytesDownloaded / 1024 / 1024).toFixed(1)}/${totalMB} MB)`, overallPercent, 100);
                    } catch (err) {
                        console.error(`Failed to download ${file.path}`, err);
                        // Optional: continue or fail? A modpack might be broken without a file.
                        // For now we continue but log it.
                    }
                }
            };

            // Start workers
            for (let i = 0; i < CONCURRENCY; i++) activeWorkers.push(downloadWorker());
            await Promise.all(activeWorkers);

            // Install Loader (Fabric/Quilt/Forge)
            console.log('[ModpackInstaller] Dependencies:', JSON.stringify(indexData.dependencies, null, 2));

            const deps = indexData.dependencies;
            const loader = (deps['fabric-loader'] || deps.fabric_loader) ? 'fabric' :
                (deps.forge ? 'forge' :
                    (deps.neoforge ? 'neoforge' :
                        ((deps['quilt-loader'] || deps.quilt_loader) ? 'quilt' : 'vanilla')));

            console.log(`[ModpackInstaller] Detected loader: ${loader}`);

            const gameVersion = deps.minecraft;
            let loaderVersion = deps[`${loader}-loader`] || deps[`${loader}_loader`] || deps[loader];

            // If loader version is just recognized as "required" but version not specified (unlikely for modrinth index), handle it.
            // Modrinth index usually specifies exact version.

            let launchVersionId = gameVersion; // Default to vanilla

            if (loader === 'fabric' || loader === 'quilt') {
                try {
                    onProgress(`Installing ${loader} loader...`, 90, 100);
                    // Fetch profile JSON
                    // Fabric: https://meta.fabricmc.net/v2/versions/loader/<game_version>/<loader_version>/profile/json
                    // Quilt: https://meta.quiltmc.org/v3/versions/loader/<game_version>/<loader_version>/profile/json
                    const metaHost = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';

                    // If loaderVersion is missing, fetch stable? Modpacks usually define it.
                    if (!loaderVersion) {
                        const vRes = await axios.get(`${metaHost}/versions/loader/${gameVersion}`);
                        const best = vRes.data.find((l: any) => l.loader.stable) || vRes.data[0];
                        if (best) loaderVersion = best.loader.version;
                    }

                    if (loaderVersion) {
                        const profileUrl = `${metaHost}/versions/loader/${gameVersion}/${loaderVersion}/profile/json`;
                        console.log(`[ModpackInstaller] Fetching loader profile from ${profileUrl}`);
                        const profileRes = await axios.get(profileUrl);
                        const profileJson = profileRes.data;

                        const versionId = profileJson.id;
                        // We need to reliably find games dir.
                        // Use ConfigManager to get the actual configured path
                        const gamePath = ConfigManager.getGamePath();
                        const versionDir = path.join(gamePath, 'versions', versionId);

                        if (!fs.existsSync(versionDir)) {
                            fs.mkdirSync(versionDir, { recursive: true });
                            fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(profileJson, null, 4));
                        }

                        launchVersionId = versionId;
                    }

                } catch (e) {
                    console.error("Failed to install loader", e);
                }
            } else if (loader === 'forge' || loader === 'neoforge') {
                // Forge/NeoForge installation is more complex (installers).
                // For now, we set the intention.
                // TODO: Implement Forge handling.
                console.warn("Forge/NeoForge auto-setup not fully implemented in ModpackInstaller yet.");
            }

            const instanceConfig = {
                id: path.basename(instanceDir), // Fix: Use folder name as ID
                name: projectName,
                version: gameVersion,
                loader: loader,
                loaderVersion: loaderVersion,
                launchVersionId: launchVersionId,
                icon: iconUrl,
                created: Date.now(),
                lastPlayed: 0,
                memory: 4096
            };

            fs.writeFileSync(path.join(instanceDir, 'instance.json'), JSON.stringify(instanceConfig, null, 4));
            fs.unlinkSync(packPath);

            console.log(`[ModpackInstaller] Installation complete for ${projectName}`);
            onProgress("Complete!", 100, 100);
            return { success: true, instanceId: instanceConfig.id };

        } catch (error) {
            console.error(`[ModpackInstaller] Error:`, error);
            throw error;
        }
    }

    private static async downloadFile(url: string, dest: string) {
        const writer = fs.createWriteStream(dest);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'WhoapLauncher/1.0'
            }
        });
        response.data.pipe(writer);
        return new Promise<void>((resolve, reject) => {
            writer.on('finish', () => resolve());
            writer.on('error', reject);
        });
    }

    private static copyRecursiveSync(src: string, dest: string) {
        if (!fs.existsSync(src)) return;
        const stats = fs.statSync(src);
        if (stats && stats.isDirectory()) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const items = fs.readdirSync(src);
            for (const childItemName of items) {
                this.copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
            }
        } else if (stats) {
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            fs.copyFileSync(src, dest);
        }
    }
}
