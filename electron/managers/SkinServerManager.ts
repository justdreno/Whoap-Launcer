import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import NodeRSA from 'node-rsa';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';

// Cache for storing other Whoap users' skins (for multiplayer visibility)
interface CachedProfile {
    uuid: string;
    name: string;
    realUuid: string; // The Whoap UUID for skin lookup
    timestamp: number;
}

// Skin cache to avoid repeated fetches
interface SkinCacheEntry {
    data: Buffer;
    timestamp: number;
    exists: boolean;
}

// Session storage for join/hasJoined validation (critical for multiplayer)
interface JoinSession {
    accessToken: string;
    selectedProfile: string; // UUID
    serverId: string;
    username: string;
    timestamp: number;
}

export class SkinServerManager {
    private static instance: SkinServerManager;
    private static currentUser: { uuid: string; name: string; offlineUuid?: string; skinModel?: 'default' | 'slim' } | null = null;

    // Cache for other players' profiles (Whoap users on multiplayer servers)
    private static playerCache: Map<string, CachedProfile> = new Map();
    private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

    // Skin/cape data cache
    private static skinCache: Map<string, SkinCacheEntry> = new Map();
    private static capeCache: Map<string, SkinCacheEntry> = new Map();
    private static TEXTURE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache

    // Session storage for multiplayer join validation (serverId -> JoinSession)
    private static joinSessions: Map<string, JoinSession> = new Map();
    private static JOIN_SESSION_TTL = 30 * 1000; // 30 seconds - standard Mojang timeout

    private app_express;
    private server: any;
    private port = 25500; // Use non-conflicting port for skin server
    private key: NodeRSA;
    private keyPath: string;

    // Default Steve skin (64x64 PNG) - base64 encoded
    private static DEFAULT_STEVE_SKIN: Buffer | null = null;

    // Supabase configuration for fetching other Whoap users
    private readonly SUPABASE_PROJECT = 'ibtctzkqzezrtcglicjf';
    private readonly SUPABASE_URL = `https://${this.SUPABASE_PROJECT}.supabase.co`;

    public static getInstance(): SkinServerManager {
        return SkinServerManager.instance;
    }

    public static setCurrentUser(uuid: string, name: string, skinModel?: 'default' | 'slim') {
        // Calculate offline UUID for this user to support cracked servers
        const offlineUuid = SkinServerManager.getOfflineUuid(name);
        SkinServerManager.currentUser = { uuid, name, offlineUuid, skinModel: skinModel || 'default' };
        console.log(`[SkinServer] Current user set: ${name} (UUID: ${uuid}, Offline UUID: ${offlineUuid})`);
    }

    public static getCurrentUser() {
        return SkinServerManager.currentUser;
    }

    // Register another Whoap player for multiplayer skin visibility
    public static registerPlayer(uuid: string, name: string, realUuid: string) {
        const offlineUuid = SkinServerManager.getOfflineUuid(name);
        SkinServerManager.playerCache.set(uuid.replace(/-/g, ''), {
            uuid: uuid,
            name: name,
            realUuid: realUuid,
            timestamp: Date.now()
        });
        // Also cache by offline UUID
        SkinServerManager.playerCache.set(offlineUuid.replace(/-/g, ''), {
            uuid: offlineUuid,
            name: name,
            realUuid: realUuid,
            timestamp: Date.now()
        });
        console.log(`[SkinServer] Registered player: ${name} (UUID: ${uuid}, Real UUID: ${realUuid})`);
    }

    // Get cached player or return null
    private static getCachedPlayer(uuid: string): CachedProfile | null {
        const cleanUuid = uuid.replace(/-/g, '');
        const cached = SkinServerManager.playerCache.get(cleanUuid);
        if (cached && (Date.now() - cached.timestamp) < SkinServerManager.CACHE_TTL) {
            return cached;
        }
        return null;
    }

    constructor() {
        SkinServerManager.instance = this;
        this.app_express = express();

        // Store key in app data for persistence across restarts
        const dataPath = app.getPath('userData');
        this.keyPath = path.join(dataPath, 'skin-server-key-4096.pem');

        // Load or generate RSA key (4096 bits for better compatibility)
        this.key = this.loadOrGenerateKey();

        // Load default Steve skin
        this.loadDefaultSkin();

        this.setupRoutes();
        this.start();
    }

    private loadDefaultSkin() {
        try {
            const assetsPath = app.isPackaged
                ? path.join(process.resourcesPath, 'assets')
                : path.join(__dirname, '../../src/assets');

            const stevePath = path.join(assetsPath, 'steve.png');
            const whoapSkinPath = path.join(assetsPath, 'whoap-skin.png');

            if (fs.existsSync(whoapSkinPath)) {
                SkinServerManager.DEFAULT_STEVE_SKIN = fs.readFileSync(whoapSkinPath);
                console.log('[SkinServer] Loaded Whoap default skin');
            } else if (fs.existsSync(stevePath)) {
                SkinServerManager.DEFAULT_STEVE_SKIN = fs.readFileSync(stevePath);
                console.log('[SkinServer] Loaded Steve default skin');
            }
        } catch (e) {
            console.warn('[SkinServer] Could not load default skin:', e);
        }
    }

    private loadOrGenerateKey(): NodeRSA {
        try {
            if (fs.existsSync(this.keyPath)) {
                const keyData = fs.readFileSync(this.keyPath, 'utf-8');
                const key = new NodeRSA(keyData);
                key.setOptions({ signingScheme: 'pkcs1-sha1' });
                console.log('[SkinServer] Loaded existing RSA key');
                return key;
            }
        } catch (err) {
            console.warn('[SkinServer] Failed to load existing key, generating new one:', err);
        }

        console.log('[SkinServer] Generating new 4096-bit RSA key...');
        const key = new NodeRSA({ b: 4096 });
        key.setOptions({ signingScheme: 'pkcs1-sha1' });

        try {
            fs.writeFileSync(this.keyPath, key.exportKey('private'));
            console.log('[SkinServer] Saved new RSA key');
        } catch (err) {
            console.error('[SkinServer] Failed to save RSA key:', err);
        }

        return key;
    }

    private getPublicKey(): string {
        return this.key.exportKey('public');
    }

    private sign(data: string): string {
        this.key.setOptions({ signingScheme: 'pkcs1-sha1' });
        return this.key.sign(Buffer.from(data, 'utf-8'), 'base64');
    }

    private getTextureProperties(uuid: string, name: string, skinUuid?: string, options?: { model?: 'default' | 'slim', hasCape?: boolean, unsigned?: boolean }): any[] {
        let formattedUuid = uuid;
        if (uuid.length === 32) {
            formattedUuid = uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }

        let formattedSkinUuid = skinUuid || formattedUuid;
        if (formattedSkinUuid.length === 32) {
            formattedSkinUuid = formattedSkinUuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }

        const profileId = uuid.replace(/-/g, '');
        const skinUrl = `${this.SUPABASE_URL}/storage/v1/object/public/skins/${formattedSkinUuid}.png`;
        const capeUrl = `${this.SUPABASE_URL}/storage/v1/object/public/capes/${formattedSkinUuid}.png`;
        const skinModel = options?.model || SkinServerManager.currentUser?.skinModel || 'default';

        const textures: any = {
            SKIN: {
                url: skinUrl,
                metadata: {
                    model: skinModel === 'slim' ? 'slim' : 'default'
                }
            }
        };

        if (options?.hasCape !== false) {
            textures.CAPE = {
                url: capeUrl
            };
        }

        const texturePayload = {
            timestamp: Date.now(),
            profileId: profileId,
            profileName: name,
            textures: textures
        };

        const textureBase64 = Buffer.from(JSON.stringify(texturePayload)).toString('base64');
        const useUnsigned = options?.unsigned !== false;

        if (useUnsigned) {
            return [{
                name: "textures",
                value: textureBase64
            }];
        } else {
            const signature = this.sign(textureBase64);
            return [{
                name: "textures",
                value: textureBase64,
                signature: signature
            }];
        }
    }

    private static getOfflineUuid(username: string): string {
        const md5 = crypto.createHash('md5');
        md5.update('OfflinePlayer:' + username);
        const buffer = md5.digest();
        buffer[6] = (buffer[6] & 0x0f) | 0x30;
        buffer[8] = (buffer[8] & 0x3f) | 0x80;
        const hex = buffer.toString('hex');
        return hex.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    }

    private generateAliasedSkinPayload(requestedProfileId: string, realUuidForSkin: string, name: string, options?: { model?: 'default' | 'slim', hasCape?: boolean, unsigned?: boolean }): any[] {
        return this.getTextureProperties(requestedProfileId, name, realUuidForSkin, options);
    }

    private async fetchSkinFromSupabase(uuid: string): Promise<{ data: Buffer | null, exists: boolean }> {
        const cleanUuid = uuid.replace(/-/g, '');
        const formattedUuid = cleanUuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

        const cached = SkinServerManager.skinCache.get(cleanUuid);
        if (cached && (Date.now() - cached.timestamp) < SkinServerManager.TEXTURE_CACHE_TTL) {
            return { data: cached.exists ? cached.data : null, exists: cached.exists };
        }

        return new Promise((resolve) => {
            const url = `${this.SUPABASE_URL}/storage/v1/object/public/skins/${formattedUuid}.png`;
            https.get(url, (res) => {
                if (res.statusCode === 200) {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => {
                        const data = Buffer.concat(chunks);
                        SkinServerManager.skinCache.set(cleanUuid, { data, timestamp: Date.now(), exists: true });
                        resolve({ data, exists: true });
                    });
                } else {
                    SkinServerManager.skinCache.set(cleanUuid, { data: Buffer.alloc(0), timestamp: Date.now(), exists: false });
                    resolve({ data: null, exists: false });
                }
            }).on('error', () => {
                resolve({ data: null, exists: false });
            });
        });
    }

    private async fetchCapeFromSupabase(uuid: string): Promise<{ data: Buffer | null, exists: boolean }> {
        const cleanUuid = uuid.replace(/-/g, '');
        const formattedUuid = cleanUuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

        const cached = SkinServerManager.capeCache.get(cleanUuid);
        if (cached && (Date.now() - cached.timestamp) < SkinServerManager.TEXTURE_CACHE_TTL) {
            return { data: cached.exists ? cached.data : null, exists: cached.exists };
        }

        return new Promise((resolve) => {
            const url = `${this.SUPABASE_URL}/storage/v1/object/public/capes/${formattedUuid}.png`;
            https.get(url, (res) => {
                if (res.statusCode === 200) {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => {
                        const data = Buffer.concat(chunks);
                        SkinServerManager.capeCache.set(cleanUuid, { data, timestamp: Date.now(), exists: true });
                        resolve({ data, exists: true });
                    });
                } else {
                    SkinServerManager.capeCache.set(cleanUuid, { data: Buffer.alloc(0), timestamp: Date.now(), exists: false });
                    resolve({ data: null, exists: false });
                }
            }).on('error', () => {
                resolve({ data: null, exists: false });
            });
        });
    }

    private async fetchMojangProfile(uuid: string): Promise<{ id: string; name: string } | null> {
        return new Promise((resolve) => {
            const cleanUuid = uuid.replace(/-/g, '');
            const url = `https://sessionserver.mojang.com/session/minecraft/profile/${cleanUuid}`;
            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const profile = JSON.parse(data);
                            resolve({ id: profile.id, name: profile.name });
                        } else {
                            resolve(null);
                        }
                    } catch {
                        resolve(null);
                    }
                });
            }).on('error', () => resolve(null));
        });
    }

    private setupRoutes() {
        this.app_express.use(express.json());

        // CORS headers
        this.app_express.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (req.method === 'OPTIONS') return res.status(204).send();
            next();
        });

        // Request logger
        this.app_express.use((req, res, next) => {
            console.log(`[SkinServer] ${req.method} ${req.path}`);
            next();
        });

        // --- ROOT METADATA ---
        this.app_express.get(['/', '/authlib-injector', '/authlib-injector/yggdrasil', '/yggdrasil'], (req: Request, res: Response) => {
            res.json({
                meta: {
                    serverName: "Whoap Skin Server",
                    implementationName: "whoap-yggdrasil",
                    implementationVersion: "3.1.0",
                    feature: {
                        non_email_login: true,
                        legacy_skin_api: true,
                        no_mojang_namespace: false,
                        enable_mojang_anti_features: false,
                        enable_profile_key: true,
                        username_check: false,
                        noAuthlib: false
                    }
                },
                skinDomains: [
                    "127.0.0.1", "localhost", ".localhost",
                    `${this.SUPABASE_PROJECT}.supabase.co`, ".supabase.co",
                    ".minecraft.net", "textures.minecraft.net", "api.mojang.com", "sessionserver.mojang.com",
                    "mc-heads.net", "crafatar.com", "minotar.net",
                    "api.whoap.com", ".whoap.com"
                ],
                signaturePublickey: this.getPublicKey()
            });
        });

        // --- PUBLIC KEYS (Alias Support) ---
        // Handles both /publickey and /publickeys to fix client errors
        this.app_express.get(['/publickey', '/publickeys', '/api/yggdrasil/publickey'], (req: Request, res: Response) => {
            // Some clients expect raw PEM, others expect JSON list
            // If path is /publickeys (plural), send JSON array
            if (req.path === '/publickeys') {
                res.json({
                    profileProperties: true,
                    fetchKey: true,
                    verifyKey: true,
                    keys: [{ publicKey: this.getPublicKey(), signature: "" }]
                });
            } else {
                res.setHeader('Content-Type', 'text/plain');
                res.send(this.getPublicKey());
            }
        });

        // --- ATTRIBUTES & CERTIFICATES (Fixes 404s) ---
        this.app_express.get('/player/attributes', (req: Request, res: Response) => {
            res.json({
                privileges: {
                    onlineChat: { enabled: true },
                    multiplayerServer: { enabled: true },
                    multiplayerRealms: { enabled: false },
                    telemetry: { enabled: false }
                },
                profanityFilterPreferences: { profanityFilterOn: false }
            });
        });

        // Handle both GET and POST for certificates
        const handleCertificates = (req: Request, res: Response) => {
            res.json({
                keyPair: { privateKey: "", publicKey: "" },
                publicKeySignature: "",
                publicKeySignatureV2: "",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                refreshedAfter: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
            });
        };
        this.app_express.get(['/player/certificates', '/minecraftservices/player/certificates'], handleCertificates);
        this.app_express.post(['/player/certificates', '/minecraftservices/player/certificates'], handleCertificates);

        // --- PROFILE ENDPOINT (Dual Path Support) ---
        // Handles both /sessionserver/session/... and /session/...
        this.app_express.get(['/sessionserver/session/minecraft/profile/:uuid', '/session/minecraft/profile/:uuid'], async (req: Request, res: Response) => {
            let uuid = req.params.uuid as string;
            uuid = uuid.replace('.png', '');

            if (uuid.length < 32) return res.status(400).json({ error: "Invalid UUID" });

            const cleanRequestUuid = uuid.replace(/-/g, '');
            console.log(`[SkinServer] Profile request for UUID: ${cleanRequestUuid}`);

            const currentUser = SkinServerManager.getCurrentUser();
            let username = "Player_" + uuid.substring(0, 5);
            let skinUuid = cleanRequestUuid;
            let isMatch = false;
            let skinModel: 'default' | 'slim' = 'default';

            if (currentUser) {
                const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                const cleanOfflineUuid = currentUser.offlineUuid ? currentUser.offlineUuid.replace(/-/g, '') : '';

                if (cleanRequestUuid === cleanRealUuid || cleanRequestUuid === cleanOfflineUuid) {
                    username = currentUser.name;
                    skinUuid = currentUser.uuid;
                    skinModel = currentUser.skinModel || 'default';
                    isMatch = true;
                }
            }

            if (!isMatch) {
                const cachedPlayer = SkinServerManager.getCachedPlayer(cleanRequestUuid);
                if (cachedPlayer) {
                    username = cachedPlayer.name;
                    skinUuid = cachedPlayer.realUuid;
                    isMatch = true;
                }
            }

            if (!isMatch) {
                try {
                    const mojangProfile = await this.fetchMojangProfile(cleanRequestUuid);
                    if (mojangProfile) {
                        return res.redirect(`https://sessionserver.mojang.com/session/minecraft/profile/${cleanRequestUuid}?unsigned=false`);
                    }
                } catch { }
            }

            const responseProperties = isMatch
                ? this.generateAliasedSkinPayload(cleanRequestUuid, skinUuid, username, { model: skinModel })
                : this.getTextureProperties(cleanRequestUuid, username);

            res.json({
                id: cleanRequestUuid,
                name: username,
                properties: responseProperties
            });
        });

        // --- PROXY ENDPOINT (For Mojang calls) ---
        this.app_express.get('/https/*proxyPath', async (req: Request, res: Response) => {
            const proxyPath = (req.params as any).proxyPath || req.params[0] || '';
            const targetUrl = 'https://' + proxyPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');

            try {
                if (targetUrl.includes('sessionserver.mojang.com/session/minecraft/profile/')) {
                    const uuidMatch = targetUrl.match(/profile\/([a-f0-9-]+)/i);
                    if (uuidMatch) {
                        const requestedUuid = uuidMatch[1].replace(/-/g, '');
                        const currentUser = SkinServerManager.getCurrentUser();

                        if (currentUser) {
                            const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                            const cleanOfflineUuid = currentUser.offlineUuid?.replace(/-/g, '') || '';

                            if (requestedUuid === cleanRealUuid || requestedUuid === cleanOfflineUuid) {
                                const properties = this.generateAliasedSkinPayload(
                                    requestedUuid,
                                    currentUser.uuid,
                                    currentUser.name,
                                    { model: currentUser.skinModel || 'default' }
                                );
                                return res.json({
                                    id: requestedUuid,
                                    name: currentUser.name,
                                    properties: properties
                                });
                            }
                        }
                    }
                }

                const response = await new Promise<{ statusCode: number; data: string }>((resolve, reject) => {
                    https.get(targetUrl, (proxyRes) => {
                        let data = '';
                        proxyRes.on('data', chunk => data += chunk);
                        proxyRes.on('end', () => resolve({ statusCode: proxyRes.statusCode || 500, data }));
                    }).on('error', reject);
                });

                res.status(response.statusCode);
                try {
                    res.json(JSON.parse(response.data));
                } catch {
                    res.send(response.data);
                }
            } catch (err: any) {
                res.status(502).json({ error: "Proxy error", message: err.message });
            }
        });

        // --- TEXTURE SERVING ---
        this.app_express.get(['/textures/skin/:uuid', '/skins/:uuid'], async (req: Request, res: Response) => {
            let uuid = (req.params.uuid as string).replace('.png', '');
            const currentUser = SkinServerManager.getCurrentUser();
            let targetUuid = uuid;

            if (currentUser) {
                const cleanUuid = uuid.replace(/-/g, '');
                const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                const cleanOfflineUuid = currentUser.offlineUuid?.replace(/-/g, '') || '';
                if (cleanUuid === cleanRealUuid || cleanUuid === cleanOfflineUuid) targetUuid = currentUser.uuid;
            }

            const result = await this.fetchSkinFromSupabase(targetUuid);
            if (result.exists && result.data) {
                res.setHeader('Content-Type', 'image/png');
                res.send(result.data);
            } else if (SkinServerManager.DEFAULT_STEVE_SKIN) {
                res.setHeader('Content-Type', 'image/png');
                res.send(SkinServerManager.DEFAULT_STEVE_SKIN);
            } else {
                res.redirect(`https://mc-heads.net/skin/${targetUuid.replace(/-/g, '')}`);
            }
        });

        this.app_express.get(['/textures/cape/:uuid', '/capes/:uuid'], async (req: Request, res: Response) => {
            let uuid = (req.params.uuid as string).replace('.png', '');
            const currentUser = SkinServerManager.getCurrentUser();
            let targetUuid = uuid;

            if (currentUser) {
                const cleanUuid = uuid.replace(/-/g, '');
                const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                const cleanOfflineUuid = currentUser.offlineUuid?.replace(/-/g, '') || '';
                if (cleanUuid === cleanRealUuid || cleanUuid === cleanOfflineUuid) targetUuid = currentUser.uuid;
            }

            const result = await this.fetchCapeFromSupabase(targetUuid);
            if (result.exists && result.data) {
                res.setHeader('Content-Type', 'image/png');
                res.send(result.data);
            } else {
                res.status(404).send('Cape not found');
            }
        });

        // --- MULTIPLAYER JOIN/AUTH ---
        this.app_express.post('/api/profiles/minecraft', async (req: Request, res: Response) => {
            const usernames: string[] = req.body;
            if (!Array.isArray(usernames)) return res.status(400).json({ error: "Expected array" });

            const profiles: any[] = [];
            const currentUser = SkinServerManager.getCurrentUser();

            for (const username of usernames.slice(0, 10)) {
                if (currentUser && currentUser.name.toLowerCase() === username.toLowerCase()) {
                    profiles.push({ id: currentUser.uuid.replace(/-/g, ''), name: currentUser.name });
                    continue;
                }
                const offlineUuid = SkinServerManager.getOfflineUuid(username);
                profiles.push({ id: offlineUuid.replace(/-/g, ''), name: username });
            }
            res.json(profiles);
        });

        this.app_express.post('/sessionserver/session/minecraft/join', (req: Request, res: Response) => {
            const { accessToken, selectedProfile, serverId } = req.body;
            if (!selectedProfile || !serverId) return res.status(400).json({ error: "Missing fields" });

            const profileName = typeof selectedProfile === 'object' ? selectedProfile.name : null;
            const currentUser = SkinServerManager.getCurrentUser();
            const username = profileName || currentUser?.name || 'Unknown';

            const session: JoinSession = {
                accessToken: accessToken || '',
                selectedProfile: (typeof selectedProfile === 'object' ? selectedProfile.id : selectedProfile)?.replace(/-/g, '') || '',
                serverId: serverId,
                username: username,
                timestamp: Date.now()
            };

            SkinServerManager.joinSessions.set(serverId, session);
            this.cleanupExpiredSessions();
            res.status(204).send();
        });

        this.app_express.get('/sessionserver/session/minecraft/hasJoined', async (req: Request, res: Response) => {
            // FIX: Cast query params to string to fix TS error
            const username = req.query.username as string;
            const serverId = req.query.serverId as string;

            if (!username) return res.status(400).json({ error: "Missing username" });

            const session = SkinServerManager.joinSessions.get(serverId);
            const currentUser = SkinServerManager.getCurrentUser();

            // FIX: Initialize variables
            let uuid: string = "";
            let skinUuid: string = "";
            let skinModel: 'default' | 'slim' = 'default';
            let isValid = false;

            if (currentUser && currentUser.name.toLowerCase() === username.toLowerCase()) {
                isValid = true; // Allow local user
                uuid = currentUser.uuid;
                skinUuid = currentUser.uuid;
                skinModel = currentUser.skinModel || 'default';
            } else if (session && (Date.now() - session.timestamp) < SkinServerManager.JOIN_SESSION_TTL) {
                isValid = true;
                uuid = SkinServerManager.getOfflineUuid(username);
                skinUuid = uuid;
                const cached = SkinServerManager.getCachedPlayer(uuid);
                if (cached) skinUuid = cached.realUuid;
            }

            if (session) SkinServerManager.joinSessions.delete(serverId);

            if (!isValid) return res.status(204).send();

            const cleanUuid = uuid.replace(/-/g, '');
            res.json({
                id: cleanUuid,
                name: username,
                properties: this.generateAliasedSkinPayload(cleanUuid, skinUuid, username, { model: skinModel })
            });
        });

        // --- AUTH ---
        this.app_express.post('/authserver/authenticate', (req: Request, res: Response) => {
            const { username } = req.body;
            const uuid = SkinServerManager.getOfflineUuid(username);
            const id = uuid.replace(/-/g, '');
            const properties = this.getTextureProperties(id, username);

            res.json({
                accessToken: uuidv4(),
                clientToken: req.body.clientToken || uuidv4(),
                selectedProfile: { id, name: username, properties },
                availableProfiles: [{ id, name: username, properties }]
            });
        });

        this.app_express.post('/authserver/validate', (req, res) => res.status(204).send());
        this.app_express.post('/authserver/invalidate', (req, res) => res.status(204).send());
        this.app_express.post('/authserver/signout', (req, res) => res.status(204).send());
        this.app_express.post('/authserver/refresh', (req, res) => {
            res.json({
                accessToken: uuidv4(),
                clientToken: req.body.clientToken,
                selectedProfile: req.body.selectedProfile
            });
        });
    }

    private cleanupExpiredSessions(): void {
        const now = Date.now();
        SkinServerManager.joinSessions.forEach((session, key) => {
            if (now - session.timestamp > SkinServerManager.JOIN_SESSION_TTL) {
                SkinServerManager.joinSessions.delete(key);
            }
        });
    }

    public start(): void {
        const tryStart = (port: number) => {
            this.server = this.app_express.listen(port, '127.0.0.1', () => {
                this.port = port;
                console.log(`[SkinServer] ✓ Started on http://127.0.0.1:${port}`);
            }).on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') tryStart(port + 1);
                else console.error('[SkinServer] Failed to start:', err);
            });
        };
        tryStart(this.port);
    }

    public getPort(): number {
        return this.port;
    }

    public getServerUrl(): string {
        return `http://127.0.0.1:${this.port}`;
    }
}