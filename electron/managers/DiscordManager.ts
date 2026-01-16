import { Client } from 'discord-rpc';
import { ipcMain } from 'electron';

export interface PresenceData {
    state?: string;
    details?: string;
    largeImageKey?: string;
    largeImageText?: string;
    smallImageKey?: string;
    smallImageText?: string;
    startTimestamp?: number | Date;
    instance?: boolean;
}

export class DiscordManager {
    private static instance: DiscordManager;
    private rpc: Client | null = null;
    private clientId: string = '1329323145455960144'; // Placeholder or User's App ID
    private isReady: boolean = false;

    constructor() {
        this.init();
        this.registerIpc();
    }

    public static getInstance(): DiscordManager {
        if (!DiscordManager.instance) {
            DiscordManager.instance = new DiscordManager();
        }
        return DiscordManager.instance;
    }

    private init() {
        this.attemptConnection();
        // Retry connection every 15 seconds if not ready
        setInterval(() => {
            if (!this.isReady) {
                this.attemptConnection();
            }
        }, 15000);
    }

    private async attemptConnection() {
        if (this.isReady) return;

        try {
            // Re-instantiate client if it was destroyed or null
            if (!this.rpc) {
                this.rpc = new Client({ transport: 'ipc' });

                this.rpc.on('ready', () => {
                    console.log('[Discord] RPC Ready');
                    this.isReady = true;
                    this.updatePresence({
                        details: 'Browsing Menu',
                        state: 'Ready to play',
                        largeImageKey: 'logo',
                        largeImageText: 'Whoap Launcher',
                        startTimestamp: Date.now()
                    });
                });
            }

            await this.rpc.login({ clientId: this.clientId });
        } catch (err: any) {
            // Connection failed, correct behavior is to just log debug and try again later
            // We destroy the client to ensure a fresh start next attempt
            this.rpc = null;
            // Only log if it's not the common "connection closed" error which spans logs
            if (err.message !== 'connection closed') {
                console.warn('[Discord] Connection attempt failed:', err.message);
            }
        }
    }

    private registerIpc() {
        ipcMain.handle('discord:update-presence', async (_: any, data: PresenceData) => {
            return this.updatePresence(data);
        });
    }

    public updatePresence(data: PresenceData) {
        if (!this.rpc || !this.isReady) return;

        try {
            this.rpc.setActivity({
                ...data,
                instance: false
            });
        } catch (err: any) {
            console.error('[Discord] Failed to set activity:', err);
        }
    }

    public clearPresence() {
        if (this.rpc && this.isReady) {
            this.rpc.clearActivity();
        }
    }
}
