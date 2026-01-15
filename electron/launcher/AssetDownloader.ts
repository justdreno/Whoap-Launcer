import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { net } from 'electron';
import { EventEmitter } from 'events';

export interface DownloadTask {
    url: string;
    destination: string;
    sha1?: string;
    size?: number;
    priority?: number;
}

export class AssetDownloader extends EventEmitter {
    private queue: DownloadTask[] = [];
    private activeDownloads = 0;
    private maxConcurrent = 10;
    private totalBytes = 0;
    private downloadedBytes = 0;

    constructor() {
        super();
    }

    addToQueue(tasks: DownloadTask[]) {
        this.queue.push(...tasks);
        tasks.forEach(t => this.totalBytes += (t.size || 0));
        this.processQueue();
    }

    private processQueue() {
        if (this.queue.length === 0 && this.activeDownloads === 0) {
            this.emit('done');
            return;
        }

        while (this.activeDownloads < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                this.downloadFile(task);
            }
        }
    }

    private async downloadFile(task: DownloadTask) {
        this.activeDownloads++;

        const dir = path.dirname(task.destination);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Check if file exists and matches SHA1
        if (fs.existsSync(task.destination) && task.sha1) {
            const valid = await this.verifyFile(task.destination, task.sha1);
            if (valid) {
                this.downloadedBytes += (task.size || 0);
                this.emit('progress', { total: this.totalBytes, current: this.downloadedBytes });
                this.activeDownloads--;
                this.processQueue();
                return;
            }
        }

        try {
            await this.download(task.url, task.destination, task.size);

            if (task.sha1) {
                const valid = await this.verifyFile(task.destination, task.sha1);
                if (!valid) {
                    throw new Error(`SHA1 mismatch for ${task.destination}`);
                }
            }
        } catch (error) {
            console.error(`Failed to download ${task.url}`, error);
            // Simple retry logic could go here, for now we just error
            this.emit('error', error);
        } finally {
            this.activeDownloads--;
            this.processQueue();
        }
    }

    private download(url: string, dest: string, expectedSize?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = net.request(url);
            request.on('response', (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                    return;
                }

                const fileStream = fs.createWriteStream(dest);
                response.on('data', (chunk) => {
                    fileStream.write(chunk);
                    this.downloadedBytes += chunk.length;

                    // Throttle events?
                    this.emit('progress', { total: this.totalBytes, current: this.downloadedBytes });
                });

                response.on('end', () => {
                    fileStream.end();
                    resolve();
                });

                response.on('error', (err) => {
                    fileStream.close();
                    fs.unlink(dest, () => { }); // Delete partial
                    reject(err);
                });
            });
            request.on('error', (err) => reject(err));
            request.end();
        });
    }

    private verifyFile(filePath: string, sha1: string): Promise<boolean> {
        return new Promise((resolve) => {
            const hash = crypto.createHash('sha1');
            const stream = fs.createReadStream(filePath);

            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => {
                const fileHash = hash.digest('hex');
                resolve(fileHash === sha1);
            });
            stream.on('error', () => resolve(false));
        });
    }
}
