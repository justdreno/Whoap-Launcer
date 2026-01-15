import { app, ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { AssetDownloader, DownloadTask } from './AssetDownloader';
import { JavaManager } from './JavaManager';
import { spawn } from 'child_process';
import { VersionManager } from './VersionManager';
import { ConfigManager } from '../managers/ConfigManager';
import { LogWindowManager } from '../managers/LogWindowManager';
import { CloudManager } from '../managers/CloudManager';
import { SkinServerManager } from '../managers/SkinServerManager';

export class LaunchProcess {
    private downloader: AssetDownloader;
    private javaManager: JavaManager;

    constructor() {
        this.downloader = new AssetDownloader();
        this.javaManager = new JavaManager();
        this.registerListeners();
    }

    private registerListeners() {
        ipcMain.handle('game:launch', async (event, instanceId: string, _unusedPath: string, versionId: string, authData: any) => {
            console.log(`[Launch] Starting ${instanceId} (${versionId})...`);

            // Register current user with SkinServer so it can serve the correct skin
            if (authData.name && authData.uuid) {
                SkinServerManager.setCurrentUser(authData.uuid, authData.name);
            }

            // Trigger Cloud Sync
            try {
                // Construct synthetic instance object for sync
                // We don't have full loader info here easily unless we fetch it, 
                // but for imported versions 'vanilla' is safe default.
                // Native instances logic should ideally read their json, but for speed we sync what we launched.
                const instanceObj = {
                    id: instanceId,
                    name: instanceId,
                    version: versionId,
                    loader: 'vanilla' as const, // Approximation
                    created: Date.now(),
                    lastPlayed: Date.now()
                };

                // Fire and forget sync
                // Note: authData.token is likely the Microsoft/Supabase token depending on login type.
                // Verify we have a valid Supabase session token, or skip.
                // We assume if authData.type === 'supabase', token is valid for RLS.
                // If authData.type === 'mojang' or 'offline', we likely CANNOT sync to RLS tables.

                if (authData.type === 'supabase') {
                    CloudManager.getInstance().syncInstance(instanceObj, authData.uuid, authData.token);
                } else {
                    console.log(`[Launch] Skipping Cloud Sync (Auth type: ${authData.type})`);
                }
            } catch (e) {
                console.error("[Launch] Failed to trigger cloud sync", e);
            }

            // Window Management
            const mainWindow = BrowserWindow.fromWebContents(event.sender);

            const gamePath = ConfigManager.getGamePath();
            const instancesRoot = ConfigManager.getInstancesPath();

            // Determine if this is a native instance or imported
            let isNativeInstance = fs.existsSync(path.join(instancesRoot, instanceId));

            // For TLauncher/custom versions, check if the version folder has mods/configs
            // If so, use the version folder as gameDir (TLauncher's "version isolation" behavior)
            const versionFolder = path.join(gamePath, 'versions', versionId);
            const versionHasMods = fs.existsSync(path.join(versionFolder, 'mods'));
            const versionHasConfig = fs.existsSync(path.join(versionFolder, 'config'));
            const versionHasCustomContent = versionHasMods || versionHasConfig;

            // Determine game directory:
            // - Native Instance -> Isolated in instances/<id>
            // - Imported Version WITH mods/config -> Use version folder (TLauncher style)
            // - Imported Version without custom content -> Use shared .minecraft
            let instancePath = isNativeInstance
                ? path.join(instancesRoot, instanceId)
                : (versionHasCustomContent ? versionFolder : gamePath);

            if (versionHasCustomContent && !isNativeInstance) {
                console.log(`[Launch] Detected TLauncher-style version isolation for ${versionId}`);
            }

            try {
                // 1. Fetch Version Data
                // Try remote first
                let versionData = await VersionManager.getVersionDetails(versionId);

                // Fallback: Local JSON (TLauncher/Custom)
                if (!versionData) {
                    const localJsonPath = path.join(gamePath, 'versions', versionId, `${versionId}.json`);
                    if (fs.existsSync(localJsonPath)) {
                        console.log("Loading local version JSON...");
                        try {
                            versionData = JSON.parse(fs.readFileSync(localJsonPath, 'utf-8'));
                        } catch (e) {
                            console.error("Failed to parse local JSON", e);
                        }
                    }
                }

                if (!versionData) throw new Error("Could not fetch or find version details");

                // Helper to deduplicate libraries by artifact ID
                const deduplicateLibraries = (libs: any[]) => {
                    const libMap = new Map<string, any>();

                    libs.forEach(lib => {
                        if (!lib.name) return; // Should not happen for standard libraries

                        // Parse "group:artifact:version:classifier"
                        const parts = lib.name.split(':');
                        if (parts.length < 3) return;

                        // IDKey = group:artifact[:classifier]
                        // We must preserve natives/classifiers, but deduplicate versions of the same artifact.
                        let key = `${parts[0]}:${parts[1]}`;
                        if (parts.length > 3) {
                            key += `:${parts[3]}`;
                        }

                        // Overwrite with latest
                        libMap.set(key, lib);
                    });

                    return Array.from(libMap.values());
                };

                // Resolve Inheritance (e.g. Fabric -> Vanilla)
                // We do this concurrently to ensure we have all data (libraries, client jar, etc.)
                const resolveInheritance = async (data: any): Promise<any> => {
                    console.log(`[Launch] Checking inheritance for ${data.id}. InheritsFrom: ${data.inheritsFrom}`);
                    if (data.inheritsFrom) {
                        console.log(`[Launch] Resolving inheritance from ${data.inheritsFrom}...`);
                        let parentData = await VersionManager.getVersionDetails(data.inheritsFrom);

                        if (!parentData) {
                            console.warn(`[Launch] Parent version ${data.inheritsFrom} not found remotely. Checking local...`);
                            const parentLocalPath = path.join(gamePath, 'versions', data.inheritsFrom, `${data.inheritsFrom}.json`);
                            if (fs.existsSync(parentLocalPath)) {
                                try { parentData = JSON.parse(fs.readFileSync(parentLocalPath, 'utf-8')); } catch { }
                            }
                        }

                        if (parentData) {
                            console.log(`[Launch] Parent data found. Merging...`);
                            parentData = await resolveInheritance(parentData); // Recursive

                            // Merge and Deduplicate Libraries
                            const allLibraries = [...(parentData.libraries || []), ...(data.libraries || [])];
                            const uniqueLibraries = deduplicateLibraries(allLibraries);

                            const merged = {
                                ...parentData,
                                ...data, // Child overrides parent
                                libraries: uniqueLibraries,
                                arguments: { // Merge args complex object
                                    game: [...(parentData.arguments?.game || []), ...(data.arguments?.game || [])],
                                    jvm: [...(parentData.arguments?.jvm || []), ...(data.arguments?.jvm || [])]
                                }
                            };
                            return merged;
                        } else {
                            console.error(`[Launch] Failed to find parent version ${data.inheritsFrom}!`);
                            throw new Error(`Parent version ${data.inheritsFrom} not found/resolved. Cannot launch.`);
                        }
                    } else {
                        console.log(`[Launch] No inheritance for ${data.id}`);
                    }
                    return data;
                };

                versionData = await resolveInheritance(versionData);
                console.log(`[Launch] Final Version Data | Client URL: ${versionData.downloads?.client?.url ? 'Yes' : 'No'} | Libs: ${versionData.libraries?.length}`);

                // Reuse shared folders
                const librariesDir = path.join(gamePath, 'libraries');
                const assetsDir = path.join(gamePath, 'assets');
                // For imported versions, natives go to versions/<ver>/natives
                // For instances, they go to instances/<id>/natives
                const nativesDir = isNativeInstance
                    ? path.join(instancePath, 'natives')
                    : path.join(gamePath, 'versions', versionId, 'natives');

                // Client JAR
                const sharedJarPath = path.join(gamePath, 'versions', versionId, `${versionId}.jar`);
                const instanceJarPath = path.join(instancesRoot, instanceId, 'client.jar');

                let clientJarPath = isNativeInstance ? instanceJarPath : sharedJarPath;

                let clientJarUrl = versionData.downloads?.client?.url;
                let clientJarSha1 = versionData.downloads?.client?.sha1;
                let clientJarSize = versionData.downloads?.client?.size;

                // If utilizing shared JAR and it exists, prefer it
                if (!isNativeInstance && fs.existsSync(sharedJarPath)) {
                    clientJarPath = sharedJarPath;
                } else if (!clientJarUrl && fs.existsSync(sharedJarPath)) {
                    // Fallback if no URL but file exists (custom versions)
                    clientJarPath = sharedJarPath;
                }

                // Ensure directories
                if (!fs.existsSync(librariesDir)) fs.mkdirSync(librariesDir, { recursive: true });
                if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
                if (!fs.existsSync(nativesDir)) fs.mkdirSync(nativesDir, { recursive: true });

                // 2. Queue Downloads
                const downloads: DownloadTask[] = [];

                // 2.1 Download Asset Index and Assets
                const assetIndexId = versionData.assetIndex?.id || versionData.assets || 'legacy';
                const assetIndexUrl = versionData.assetIndex?.url;
                const assetIndexPath = path.join(assetsDir, 'indexes', `${assetIndexId}.json`);
                
                if (assetIndexUrl) {
                    // Ensure indexes directory exists
                    const indexesDir = path.join(assetsDir, 'indexes');
                    if (!fs.existsSync(indexesDir)) fs.mkdirSync(indexesDir, { recursive: true });
                    
                    // Download asset index if missing or check existing
                    if (!fs.existsSync(assetIndexPath)) {
                        downloads.push({
                            url: assetIndexUrl,
                            destination: assetIndexPath,
                            sha1: versionData.assetIndex?.sha1,
                            size: versionData.assetIndex?.size,
                            priority: 15 // High priority for index
                        });
                        
                        console.log(`[Launch] Asset index will be downloaded: ${assetIndexId}`);
                    } else {
                        console.log(`[Launch] Asset index exists: ${assetIndexId}`);
                    }
                }

                // Authlib Injector Logic
                const AUTHLIB_URL = 'https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.7/authlib-injector-1.2.7.jar';
                // Using local backend-api for now
                const AUTH_SERVER_URL = 'http://localhost:3000';
                const authlibPath = path.join(librariesDir, 'authlib-injector.jar');

                // Only download if missing
                if (!fs.existsSync(authlibPath)) {
                    downloads.push({
                        url: AUTHLIB_URL,
                        destination: authlibPath,
                        priority: 20 // High priority
                    });
                }

                // Only download client if we have a URL and (it's missing OR we want to verify)
                // For imported versions, if it exists, assume it's good (TLauncher logic)
                if (clientJarUrl && !fs.existsSync(clientJarPath)) {
                    downloads.push({
                        url: clientJarUrl,
                        destination: clientJarPath,
                        sha1: clientJarSha1,
                        size: clientJarSize,
                        priority: 10
                    });
                }

                // Libraries match
                const cpLibraries: string[] = [];
                if (versionData.libraries) {
                    versionData.libraries.forEach((lib: any) => {
                        // Rules Check
                        if (lib.rules) {
                            let allowed = false;
                            if (lib.rules.some((r: any) => r.action === 'allow' && !r.os)) allowed = true;
                            const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
                            if (lib.rules.some((r: any) => r.action === 'allow' && r.os?.name === osName)) allowed = true;
                            if (lib.rules.some((r: any) => r.action === 'disallow' && r.os?.name === osName)) allowed = false;
                            if (!allowed) return;
                        }

                        // Path Resolution
                        let libPath = '';
                        let libUrl = '';
                        let libSha1 = '';
                        let libSize = 0;

                        if (lib.downloads && lib.downloads.artifact) {
                            // Standard Modern Format
                            libPath = path.join(librariesDir, lib.downloads.artifact.path);
                            libUrl = lib.downloads.artifact.url;
                            libSha1 = lib.downloads.artifact.sha1;
                            libSize = lib.downloads.artifact.size;
                        } else if (lib.name) {
                            // Legacy / Maven Format (TLauncher/Forge)
                            // Format: group:name:version
                            const parts = lib.name.split(':');
                            const group = parts[0].replace(/\./g, path.sep); // com.example -> com/example
                            const artifactId = parts[1];
                            const version = parts[2];
                            const filename = `${artifactId}-${version}.jar`;

                            libPath = path.join(librariesDir, group, artifactId, version, filename);

                            // Try to guess URL if missing? usually libraries.minecraft.net OR maven central
                            // But usually local versions assume files exist or providing a `url` field in the ID root.
                            if (lib.url) {
                                libUrl = lib.url + `${group.replace(/\\/g, '/')}/${artifactId}/${version}/${filename}`;
                            } else {
                                // Default repo fallback?
                                libUrl = `https://libraries.minecraft.net/${group.replace(/\\/g, '/')}/${artifactId}/${version}/${filename}`;
                            }
                        }

                        if (libPath) {
                            cpLibraries.push(libPath);

                            // Download if missing or check validity
                            // For local/imported versions, we act robust: if it exists, use it.
                            const exists = fs.existsSync(libPath);
                            if (!exists) {
                                if (libUrl) {
                                    downloads.push({
                                        url: libUrl,
                                        destination: libPath,
                                        sha1: libSha1,
                                        size: libSize
                                    });
                                } else {
                                    console.warn(`[Launch] Missing library ${lib.name} and no URL found.`);
                                }
                            } else if (authData.type !== 'offline') {
                                // Online: We can optionally verify SHA1 if strict.
                                // But for now we trust existing files to speed up launch, 
                                // unless user forces "repair".
                            }
                        }
                    });
                }

                // 3. Start Downloads
                if (downloads.length > 0) {
                    console.log(`[Launch] Downloading ${downloads.length} files...`);
                    event.sender.send('launch:progress', { status: 'Downloading files...', progress: 0, total: downloads.length });
                    this.downloader.addToQueue(downloads);

                    await new Promise<void>((resolve, reject) => {
                        this.downloader.on('done', resolve);
                        this.downloader.on('error', reject);
                        let lastProgress = 0;
                        this.downloader.on('progress', (p) => {
                            const now = Date.now();
                            if (now - lastProgress > 200) {
                                event.sender.send('launch:progress', {
                                    status: `Downloading... ${(p.current / 1024 / 1024).toFixed(1)}MB`,
                                    progress: p.current,
                                    total: p.total
                                });
                                lastProgress = now;
                            }
                        });
                    });
                }

                // 3.5 Download Missing/Corrupt Assets
                if (assetIndexUrl && fs.existsSync(assetIndexPath)) {
                    event.sender.send('launch:progress', { status: 'Checking assets...', progress: 0, total: 100 });
                    
                    try {
                        const assetIndex = JSON.parse(fs.readFileSync(assetIndexPath, 'utf-8'));
                        const assetDownloads: DownloadTask[] = [];
                        const objectsDir = path.join(assetsDir, 'objects');
                        
                        if (!fs.existsSync(objectsDir)) {
                            fs.mkdirSync(objectsDir, { recursive: true });
                        }

                        // Check each asset
                        const assets = assetIndex.objects || {};
                        const assetKeys = Object.keys(assets);
                        let checkedCount = 0;
                        
                        for (const assetKey of assetKeys) {
                            const asset = assets[assetKey];
                            const hash = asset.hash;
                            const size = asset.size;
                            
                            // Asset path follows Minecraft structure: objects/[first 2 chars of hash]/[hash]
                            const hashPrefix = hash.substring(0, 2);
                            const assetDir = path.join(objectsDir, hashPrefix);
                            const assetPath = path.join(assetDir, hash);
                            
                            // Check if asset exists and verify size
                            let needsDownload = false;
                            if (!fs.existsSync(assetPath)) {
                                needsDownload = true;
                            } else {
                                // Verify file size matches
                                const stats = fs.statSync(assetPath);
                                if (stats.size !== size) {
                                    console.log(`[Launch] Asset ${assetKey} size mismatch. Expected: ${size}, Got: ${stats.size}`);
                                    needsDownload = true;
                                }
                            }
                            
                            if (needsDownload) {
                                // Ensure subdirectory exists
                                if (!fs.existsSync(assetDir)) {
                                    fs.mkdirSync(assetDir, { recursive: true });
                                }
                                
                                assetDownloads.push({
                                    url: `https://resources.download.minecraft.net/${hashPrefix}/${hash}`,
                                    destination: assetPath,
                                    sha1: hash,
                                    size: size,
                                    priority: 5 // Lower priority than libraries
                                });
                            }
                            
                            checkedCount++;
                            if (checkedCount % 100 === 0) {
                                event.sender.send('launch:progress', { 
                                    status: `Checking assets... ${checkedCount}/${assetKeys.length}`, 
                                    progress: checkedCount, 
                                    total: assetKeys.length 
                                });
                            }
                        }
                        
                        // Download missing/corrupt assets
                        if (assetDownloads.length > 0) {
                            console.log(`[Launch] Downloading ${assetDownloads.length} missing/corrupt assets...`);
                            event.sender.send('launch:progress', { 
                                status: `Downloading ${assetDownloads.length} assets...`, 
                                progress: 0, 
                                total: assetDownloads.length 
                            });
                            
                            this.downloader.addToQueue(assetDownloads);
                            await new Promise<void>((resolve, reject) => {
                                this.downloader.on('done', resolve);
                                this.downloader.on('error', reject);
                                let lastProgress = 0;
                                this.downloader.on('progress', (p) => {
                                    const now = Date.now();
                                    if (now - lastProgress > 200) {
                                        event.sender.send('launch:progress', {
                                            status: `Downloading assets... ${(p.current / 1024 / 1024).toFixed(1)}MB`,
                                            progress: p.current,
                                            total: p.total
                                        });
                                        lastProgress = now;
                                    }
                                });
                            });
                        } else {
                            console.log(`[Launch] All assets verified and present`);
                        }
                    } catch (e) {
                        console.error('[Launch] Failed to process asset index:', e);
                        // Continue launch even if asset check fails
                    }
                }

                // 4. Build Classpath
                const classpath = [...cpLibraries, clientJarPath].join(path.delimiter);

                // 5. Get Java
                event.sender.send('launch:progress', { status: 'Verifying Java...', progress: 99, total: 100 });

                // Determine required Java version from version data
                let requiredJavaVersion = versionData.javaVersion?.majorVersion?.toString();

                if (!requiredJavaVersion) {
                    // Fallback to heuristic based on version number if metadata is missing (common with modloaders)
                    const v = versionId.match(/1\.(\d+)/);
                    if (v && v[1]) {
                        const minor = parseInt(v[1]);
                        if (minor >= 21) requiredJavaVersion = '21'; // 1.21+ needs Java 21
                        else if (minor >= 20 && versionId.includes('1.20.5')) requiredJavaVersion = '21'; // 1.20.5+ needs Java 21
                        else if (minor >= 18) requiredJavaVersion = '17'; // 1.18+ needs Java 17
                        else if (minor === 17) requiredJavaVersion = '16'; // 1.17 needs Java 16
                        else requiredJavaVersion = '8'; // Older needs Java 8
                    } else {
                        requiredJavaVersion = '8';
                    }
                    console.log(`[Launch] Heuristic determined Java version ${requiredJavaVersion} for ${versionId}`);
                }

                // Check for custom Java path in config for this specific version
                const configJavaPath = ConfigManager.getJavaPath(requiredJavaVersion);
                let javaPath: string;

                if (configJavaPath && configJavaPath !== 'auto') {
                    javaPath = configJavaPath;
                    console.log(`[Launch] Using custom Java ${requiredJavaVersion}: ${javaPath}`);
                } else {
                    javaPath = await this.javaManager.ensureJava(requiredJavaVersion, (status, progress) => {
                        event.sender.send('launch:progress', {
                            status: status,
                            progress: progress,
                            total: 100
                        });
                    });
                }

                // Get RAM settings
                const minRam = ConfigManager.getMinRam();
                const maxRam = ConfigManager.getMaxRam();

                // 6. Build Args
                const jvmArgs = [
                    `-Xms${minRam}M`,
                    `-Xmx${maxRam}M`,
                    `-Djava.library.path=${nativesDir}`,
                    '-Dminecraft.launcher.brand=whoap',
                    '-Dminecraft.launcher.version=1.0.0',
                    '-Dminecraft.client.jar=' + clientJarPath,
                    // Inject Authlib Agent
                    `-javaagent:${authlibPath}=${AUTH_SERVER_URL}`,
                    '-cp', classpath,
                    versionData.mainClass,
                    '--username', authData.name,
                    '--version', versionId,
                    '--gameDir', instancePath,
                    '--assetsDir', assetsDir,
                    '--assetIndex', versionData.assetIndex?.id || versionData.assets || 'legacy',
                    '--uuid', authData.uuid,
                    // Pass the Authlib API root as the accessToken source? No, standard MC doesn't use it this way.
                    // But authlib-injector wraps requests.
                    '--accessToken', authData.token,
                    '--userType', 'mojang',
                    '--versionType', versionData.type || 'release'
                ];

                console.log(`[Launch] Spawning java with RAM ${minRam}-${maxRam}MB...`);

                // Get launch behavior settings
                const launchBehavior = ConfigManager.getLaunchBehavior();
                const showConsole = ConfigManager.getShowConsoleOnLaunch();

                // Handle window based on launch behavior
                if (launchBehavior === 'hide') {
                    mainWindow?.hide();
                } else if (launchBehavior === 'minimize') {
                    mainWindow?.minimize();
                }
                // 'keep' = keep launcher open, do nothing

                // Show log window if enabled
                if (showConsole) {
                    LogWindowManager.create();
                    LogWindowManager.send(`Starting ${instanceId} (${versionId})...`, 'info');
                    LogWindowManager.send(`Java: ${javaPath}`, 'info');
                    LogWindowManager.send(`RAM: ${minRam}MB - ${maxRam}MB`, 'info');
                }

                // Use javaw.exe on windows to avoid console window creation
                if (process.platform === 'win32' && javaPath.endsWith('java.exe')) {
                    javaPath = javaPath.replace('java.exe', 'javaw.exe');
                }

                const gameProcess = spawn(javaPath, jvmArgs, {
                    cwd: instancePath,
                    detached: false, // Keep attached to main process to avoid new terminal window
                    stdio: 'pipe'
                });

                const logBuffer: string[] = [];
                const MAX_LOG_LINES = 500;

                const appendLog = (data: string) => {
                    const lines = data.split('\n');
                    logBuffer.push(...lines);
                    if (logBuffer.length > MAX_LOG_LINES) {
                        logBuffer.splice(0, logBuffer.length - MAX_LOG_LINES);
                    }
                };

                gameProcess.stdout.on('data', (d) => {
                    const str = d.toString();
                    appendLog(str);
                    LogWindowManager.send(str, 'stdout');
                });

                gameProcess.stderr.on('data', (d) => {
                    const str = d.toString();
                    appendLog(str);
                    LogWindowManager.send(str, 'stderr');
                });

                gameProcess.on('error', (err) => {
                    console.error("Failed to start game process", err);
                    event.sender.send('launch:error', err.message);
                    LogWindowManager.send(`Launch Error: ${err.message}`, 'stderr');
                    mainWindow?.show();
                });

                gameProcess.on('close', (code) => {
                    console.log(`Game process exited with code ${code}`);

                    if (code !== 0) {
                        console.log("Game crashed! Analyzing...");
                        import('./CrashAnalyzer').then(({ CrashAnalyzer }) => {
                            const report = CrashAnalyzer.analyze(code || 1, logBuffer);
                            event.sender.send('launch:crash', {
                                report,
                                log: logBuffer.slice(-100).join('\n') // Send last 100 lines for quick view
                            });
                        });
                    }

                    // Show Launcher
                    mainWindow?.show();
                    mainWindow?.focus();
                });

                gameProcess.unref();

                return { success: true };

            } catch (error) {
                console.error("Launch failed", error);
                // Ensure window is back if we crashed synchronously
                mainWindow?.show();
                return { success: false, error: String(error) };
            }
        });
    }
}
