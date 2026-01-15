import { app, ipcMain, shell, dialog, clipboard, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { ConfigManager } from './ConfigManager';
import { InstanceManager } from './InstanceManager';

export interface Screenshot {
    id: string;
    filename: string;
    path: string;
    instanceId: string;
    instanceName: string;
    size: number;
    date: number;
    version?: string;
    loader?: string;
}

export class ScreenshotManager {
    constructor() {
        this.registerListeners();
    }

    private registerListeners() {
        ipcMain.handle('screenshots:list', async () => {
            return await this.listAllScreenshots();
        });

        ipcMain.handle('screenshots:delete', async (_, screenshotPath: string) => {
            return await this.deleteScreenshot(screenshotPath);
        });

        ipcMain.handle('screenshots:open-location', async (_, screenshotPath: string) => {
            return await this.openLocation(screenshotPath);
        });

        ipcMain.handle('screenshots:copy-to-clipboard', async (_, screenshotPath: string) => {
            return await this.copyToClipboard(screenshotPath);
        });

        ipcMain.handle('screenshots:export', async (_, screenshotPath: string) => {
            return await this.exportScreenshot(screenshotPath);
        });

        ipcMain.handle('screenshots:share-to-cloud', async (_, screenshotPath: string, userId: string) => {
            return await this.shareToCloud(screenshotPath, userId);
        });
    }

    private async listAllScreenshots(): Promise<Screenshot[]> {
        const screenshots: Screenshot[] = [];
        const instanceManager = InstanceManager.getInstance();

        try {
            // Get all instances
            const instances = await instanceManager['getInstances']();

            // Scan each instance for screenshots
            for (const instance of instances) {
                const instancePath = this.resolveInstancePath(instance.id);
                if (!instancePath) continue;

                const screenshotsPath = path.join(instancePath, 'screenshots');

                if (existsSync(screenshotsPath)) {
                    try {
                        const files = await fs.readdir(screenshotsPath);

                        for (const file of files) {
                            // Only include image files
                            if (!/\.(png|jpg|jpeg|gif|bmp)$/i.test(file)) continue;

                            const filePath = path.join(screenshotsPath, file);

                            try {
                                const stats = statSync(filePath);

                                screenshots.push({
                                    id: `${instance.id}:${file}`,
                                    filename: file,
                                    path: filePath,
                                    instanceId: instance.id,
                                    instanceName: instance.name,
                                    size: stats.size,
                                    date: stats.mtimeMs,
                                    version: instance.version,
                                    loader: instance.loader
                                });
                            } catch (err) {
                                console.warn(`Failed to stat screenshot: ${filePath}`, err);
                            }
                        }
                    } catch (err) {
                        console.warn(`Failed to read screenshots from ${instance.name}`, err);
                    }
                }
            }

            // Sort by date (newest first)
            screenshots.sort((a, b) => b.date - a.date);

        } catch (err) {
            console.error('Failed to list screenshots:', err);
        }

        return screenshots;
    }

    private resolveInstancePath(instanceId: string): string | null {
        const instancesPath = ConfigManager.getInstancesPath();

        // 1. Check local instances
        let p = path.join(instancesPath, instanceId);
        if (existsSync(p)) {
            return p;
        }

        // 2. Check external versions (.minecraft/versions)
        p = path.join(ConfigManager.getGamePath(), 'versions', instanceId);
        if (existsSync(p)) {
            return p;
        }

        return null;
    }

    private async deleteScreenshot(screenshotPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            if (!existsSync(screenshotPath)) {
                return { success: false, error: 'Screenshot not found' };
            }

            await fs.unlink(screenshotPath);
            return { success: true };
        } catch (err) {
            console.error('Failed to delete screenshot:', err);
            return { success: false, error: String(err) };
        }
    }

    private async openLocation(screenshotPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            if (!existsSync(screenshotPath)) {
                return { success: false, error: 'Screenshot not found' };
            }

            // Open the folder containing the screenshot
            const folder = path.dirname(screenshotPath);
            await shell.openPath(folder);
            return { success: true };
        } catch (err) {
            console.error('Failed to open location:', err);
            return { success: false, error: String(err) };
        }
    }

    private async copyToClipboard(screenshotPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            if (!existsSync(screenshotPath)) {
                return { success: false, error: 'Screenshot not found' };
            }

            const image = nativeImage.createFromPath(screenshotPath);
            clipboard.writeImage(image);
            return { success: true };
        } catch (err) {
            console.error('Failed to copy to clipboard:', err);
            return { success: false, error: String(err) };
        }
    }

    private async exportScreenshot(screenshotPath: string): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> {
        try {
            if (!existsSync(screenshotPath)) {
                return { success: false, error: 'Screenshot not found' };
            }

            const filename = path.basename(screenshotPath);

            const { filePath } = await dialog.showSaveDialog({
                title: 'Export Screenshot',
                defaultPath: filename,
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
            });

            if (!filePath) {
                return { success: false, canceled: true };
            }

            await fs.copyFile(screenshotPath, filePath);
            return { success: true, filePath };
        } catch (err) {
            console.error('Failed to export screenshot:', err);
            return { success: false, error: String(err) };
        }
    }

    private async shareToCloud(screenshotPath: string, userId: string): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
        try {
            if (!existsSync(screenshotPath)) {
                return { success: false, error: 'Screenshot not found' };
            }

            // Read the screenshot file
            const fileBuffer = await fs.readFile(screenshotPath);
            const filename = path.basename(screenshotPath);
            const timestamp = Date.now();
            const uniqueFilename = `${userId}/${timestamp}_${filename}`;

            // This will be handled by the frontend with Supabase client
            // Return the buffer as base64 for frontend to upload
            const base64Data = fileBuffer.toString('base64');

            return {
                success: true,
                publicUrl: base64Data // Frontend will handle actual upload
            };
        } catch (err) {
            console.error('Failed to prepare screenshot for cloud:', err);
            return { success: false, error: String(err) };
        }
    }
}
