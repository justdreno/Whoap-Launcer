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
        try {
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

            this.rpc.login({ clientId: this.clientId }).catch(err => {
                console.warn('[Discord] Failed to connect:', err.message);
            });
        } catch (err) {
            console.error('[Discord] Initialization error:', err);
        }
    }

    private registerIpc() {
        ipcMain.handle('discord:update-presence', async (_, data: PresenceData) => {
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
        } catch (err) {
            console.error('[Discord] Failed to set activity:', err);
        }
    }

    public clearPresence() {
        if (this.rpc && this.isReady) {
            this.rpc.clearActivity();
        }
    }
}
