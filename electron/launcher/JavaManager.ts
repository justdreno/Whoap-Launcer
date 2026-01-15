import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';
import { AssetDownloader } from './AssetDownloader';

// Map Java major version to download URLs (using Corretto or Adoptium)
// We assume Windows x64. Future: Detect OS/Arch.
const JAVA_DOWNLOADS: Record<string, string> = {
    '8': 'https://api.adoptium.net/v3/binary/latest/8/ga/windows/x64/jdk/hotspot/normal/eclipse',
    '17': 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse',
    '21': 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse',
};

export class JavaManager {
    private javaPath: string;
    private downloader: AssetDownloader;

    constructor() {
        this.javaPath = path.join(app.getPath('userData'), 'runtimes');
        this.downloader = new AssetDownloader();
        if (!fs.existsSync(this.javaPath)) {
            fs.mkdirSync(this.javaPath, { recursive: true });
        }
    }

    async ensureJava(majorVersion: string, onProgress?: (status: string, progress: number) => void): Promise<string> {
        // 1. Check if we already downloaded it
        const targetDir = path.join(this.javaPath, `java-${majorVersion}`);
        // Bin check: Sometimes it's inside a nested folder (jdk-17+...)
        // We'll search for java.exe inside targetDir recursively if simple check fails.
        const cachedJava = this.findJavaBinary(targetDir);
        if (cachedJava) {
            console.log(`[Java] Found cached Java ${majorVersion} at ${cachedJava}`);
            return cachedJava;
        }

        // 2. Check System Java
        // Note: verify if we should emit "Checking system..."
        if (onProgress) onProgress(`Checking system for Java ${majorVersion}...`, 10);

        const systemJava = await this.detectSystemJava(majorVersion);
        if (systemJava) {
            if (onProgress) onProgress(`Found Java ${majorVersion}`, 100);
            return systemJava;
        }

        // 3. Download if missing
        console.log(`[Java] Java ${majorVersion} missing. Downloading...`);
        return await this.downloadJava(majorVersion, targetDir);
    }

    private findJavaBinary(root: string): string | null {
        if (!fs.existsSync(root)) return null;

        // Direct check
        const directBin = path.join(root, 'bin', 'java.exe');
        if (fs.existsSync(directBin)) return directBin;

        // Nested check (e.g. runtimes/java-17/jdk-17.0.1+12/bin/java.exe)
        try {
            const files = fs.readdirSync(root);
            for (const file of files) {
                const nested = path.join(root, file, 'bin', 'java.exe');
                if (fs.existsSync(nested)) return nested;
            }
        } catch { }

        return null;
    }

    private async downloadJava(version: string, targetDir: string, onProgress?: (status: string, progress: number) => void): Promise<string> {
        const url = JAVA_DOWNLOADS[version];
        if (!url) throw new Error(`Unsupported Java version: ${version}`);

        const zipPath = path.join(this.javaPath, `temp-${version}.zip`);

        // Download
        console.log(`[Java] Downloading from ${url}`);
        await new Promise<void>((resolve, reject) => {
            this.downloader.addToQueue([{
                url,
                destination: zipPath,
                priority: 100
            }]);
            this.downloader.on('done', resolve);
            this.downloader.on('error', reject);

            let lastUpdate = 0;
            this.downloader.on('progress', (p) => {
                const now = Date.now();
                if (now - lastUpdate > 100) {
                    const totalMB = (p.total / 1024 / 1024).toFixed(1);
                    const currentMB = (p.current / 1024 / 1024).toFixed(1);
                    if (onProgress) onProgress(`Downloading Java ${version} (${currentMB}/${totalMB} MB)...`, (p.current / p.total) * 100);
                    lastUpdate = now;
                }
            });
        });

        // Extract
        console.log(`[Java] Extracting to ${targetDir}...`);
        if (onProgress) onProgress(`Extracting Java ${version}...`, 100);

        try {
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(targetDir, true);
        } catch (e) {
            throw new Error(`Failed to extract Java: ${e}`);
        } finally {
            // Cleanup
            if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        }

        // Verify
        const bin = this.findJavaBinary(targetDir);
        if (!bin) throw new Error("Java installed but executable not found.");

        return bin;
    }

    private async detectSystemJava(majorVersion: string): Promise<string | null> {
        // 1. Check 'java' in PATH
        if (await this.checkJavaVersion('java', majorVersion)) {
            console.log(`[Java] System 'java' command matches version ${majorVersion}`);
            return 'java';
        }

        // 2. Directories to scan recursively (depth 3-4 typical for runtimes)
        const scanRoots = [
            `C:\\Program Files\\Java`,
            `C:\\Program Files\\Eclipse Adoptium`,
            path.join(app.getPath('userData'), '../.minecraft/runtime'), // Mojang
            path.join(app.getPath('userData'), '../.tlauncher/jvms'),   // TLauncher
            path.join(app.getPath('userData'), '../.curseforge/minecraft/Install/runtime'), // Curse
        ];

        console.log(`[Java] Scanning system for Java ${majorVersion}...`);

        for (const root of scanRoots) {
            if (!fs.existsSync(root)) continue;

            try {
                // Get subdirectories (potential jdk folders)
                const subdirs = fs.readdirSync(root);
                for (const dir of subdirs) {
                    const fullDir = path.join(root, dir);
                    // Check for bin/java.exe directly or nested
                    const possibleBins = [
                        path.join(fullDir, 'bin', 'java.exe'),
                        path.join(fullDir, 'java-runtime-gamma', 'bin', 'java.exe'), // Mojang weirdness
                        path.join(fullDir, 'windows-x64', 'java-runtime-gamma', 'bin', 'java.exe'),
                    ];

                    // Also generic deep search if specific paths fail (simple depth 2 search)
                    // e.g. root/jdk-21/bin/java.exe

                    for (const attemptBin of possibleBins) {
                        if (fs.existsSync(attemptBin)) {
                            const match = await this.checkJavaVersion(attemptBin, majorVersion);
                            if (match) {
                                console.log(`[Java] Found matching java at ${attemptBin}`);
                                return attemptBin;
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore permission errors etc
            }
        }

        return null;
    }

    private checkJavaVersion(bin: string, requiredMajor: string): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn(bin, ['-version']);
            let output = '';
            proc.stderr.on('data', (d) => output += d.toString()); // java -version outputs to stderr
            proc.stdout.on('data', (d) => output += d.toString());

            proc.on('error', () => resolve(false));

            proc.on('close', () => {
                // Parse output: "openjdk version "17.0.1" ..." or "java version "1.8.0_..."
                // Regex for version
                const match = output.match(/version "(\d+)/);
                // For Java 1.8 it returns 1, need to handle 1.8 as 8.
                // Actually modern java is "17...", legacy "1.8.0".

                if (output.includes(`version "${requiredMajor}`)) return resolve(true);
                if (requiredMajor === '8' && output.includes('version "1.8')) return resolve(true);

                // Brute force check for typical outputs
                // e.g. "21.0.2" starts with "21"
                const vMatch = output.match(/version "(\d+)\.(\d+)/);
                if (vMatch) {
                    const major = vMatch[1] === '1' ? vMatch[2] : vMatch[1]; // Handle 1.8 vs 17
                    if (major === requiredMajor) return resolve(true);
                }

                resolve(false);
            });
        });
    }
}
