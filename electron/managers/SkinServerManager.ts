
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import NodeRSA from 'node-rsa';
import https from 'https';
import http from 'http';
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

        // SELF-TEST: Verify signature
        try {
            const testPayload = "eyJ0ZXN0IjoidmFsdWUifQ=="; // base64 of {"test":"value"}
            const signature = this.sign(testPayload);
            const verified = this.key.verify(Buffer.from(testPayload, 'utf-8'), signature, 'utf8', 'base64');
            console.log(`[SkinServer] ✓ Self-test ${verified ? 'passed' : 'FAILED'}`);
        } catch (e) {
            console.error(`[SkinServer] ✗ Self-test failed:`, e);
        }
    }

    private loadDefaultSkin() {
        // Try to load default Steve skin from assets
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
                key.setOptions({ signingScheme: 'pkcs1-sha1' }); // authlib-injector expects SHA1withRSA
                console.log('[SkinServer] Loaded existing RSA key');
                return key;
            }
        } catch (err) {
            console.warn('[SkinServer] Failed to load existing key, generating new one:', err);
        }

        // Generate new key with 4096 bits for better security
        console.log('[SkinServer] Generating new 4096-bit RSA key...');
        const key = new NodeRSA({ b: 4096 });
        key.setOptions({ signingScheme: 'pkcs1-sha1' }); // authlib-injector expects SHA1withRSA

        // Save for future use
        try {
            fs.writeFileSync(this.keyPath, key.exportKey('private'));
            console.log('[SkinServer] Saved new RSA key');
        } catch (err) {
            console.error('[SkinServer] Failed to save RSA key:', err);
        }

        return key;
    }

    private getPublicKey(): string {
        // authlib-injector expects the public key in PEM format WITH headers
        return this.key.exportKey('public');
    }

    private sign(data: string): string {
        // Sign with SHA1 and PKCS1 padding (SHA1withRSA)
        this.key.setOptions({ signingScheme: 'pkcs1-sha1' });
        return this.key.sign(Buffer.from(data, 'utf-8'), 'base64');
    }

    // Generate proper texture payload with metadata
    private getTextureProperties(uuid: string, name: string, skinUuid?: string, options?: { model?: 'default' | 'slim', hasCape?: boolean }): any[] {
        // Ensure UUID has dashes for the skin URL
        let formattedUuid = uuid;
        if (uuid.length === 32) {
            formattedUuid = uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }

        // Use skinUuid for the actual texture URL if provided (for aliasing)
        let formattedSkinUuid = skinUuid || formattedUuid;
        if (formattedSkinUuid.length === 32) {
            formattedSkinUuid = formattedSkinUuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }

        // Ensure UUID has NO dashes for profileId in payload
        const profileId = uuid.replace(/-/g, '');

        // Use direct Supabase URLs for better compatibility with third-party servers
        // The 127.0.0.1 URLs won't work for remote servers
        const skinUrl = `${this.SUPABASE_URL}/storage/v1/object/public/skins/${formattedSkinUuid}.png`;
        const capeUrl = `${this.SUPABASE_URL}/storage/v1/object/public/capes/${formattedSkinUuid}.png`;

        const skinModel = options?.model || SkinServerManager.currentUser?.skinModel || 'default';

        // Build textures object
        const textures: any = {
            SKIN: {
                url: skinUrl,
                metadata: {
                    model: skinModel === 'slim' ? 'slim' : 'default'
                }
            }
        };

        // Only include cape if user has one
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
        const signature = this.sign(textureBase64);

        return [{
            name: "textures",
            value: textureBase64,
            signature: signature
        }];
    }

    // Generate offline UUID (same algorithm Minecraft uses)
    private static getOfflineUuid(username: string): string {
        const md5 = crypto.createHash('md5');
        md5.update('OfflinePlayer:' + username);
        const buffer = md5.digest();
        // Set version to 3 (UUIDv3)
        buffer[6] = (buffer[6] & 0x0f) | 0x30;
        // Set variant to IETF (RFC 4122)
        buffer[8] = (buffer[8] & 0x3f) | 0x80;
        const hex = buffer.toString('hex');
        // Format as UUID string
        return hex.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    }

    // Method to handle aliased skin payloads
    private generateAliasedSkinPayload(requestedProfileId: string, realUuidForSkin: string, name: string, options?: { model?: 'default' | 'slim', hasCape?: boolean }): any[] {
        // Ensure UUID has dashes for the skin URL
        let formattedSkinUuid = realUuidForSkin;
        if (realUuidForSkin.length === 32) {
            formattedSkinUuid = realUuidForSkin.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }

        const skinModel = options?.model || SkinServerManager.currentUser?.skinModel || 'default';

        // Use direct Supabase URLs for better compatibility with third-party servers
        const skinUrl = `${this.SUPABASE_URL}/storage/v1/object/public/skins/${formattedSkinUuid}.png`;
        const capeUrl = `${this.SUPABASE_URL}/storage/v1/object/public/capes/${formattedSkinUuid}.png`;

        // Build textures object
        const textures: any = {
            SKIN: {
                url: skinUrl,
                metadata: {
                    model: skinModel === 'slim' ? 'slim' : 'default'
                }
            }
        };

        // Only include cape if user has one
        if (options?.hasCape !== false) {
            textures.CAPE = {
                url: capeUrl
            };
        }

        const texturePayload = {
            timestamp: Date.now(),
            profileId: requestedProfileId.replace(/-/g, ''), // Use the requested ID for the payload's profileId
            profileName: name,
            textures: textures
        };

        const textureBase64 = Buffer.from(JSON.stringify(texturePayload)).toString('base64');
        const signature = this.sign(textureBase64);

        return [{
            name: "textures",
            value: textureBase64,
            signature: signature
        }];
    }

    // Fetch skin from Supabase with caching
    private async fetchSkinFromSupabase(uuid: string): Promise<{ data: Buffer | null, exists: boolean }> {
        const cleanUuid = uuid.replace(/-/g, '');
        const formattedUuid = cleanUuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

        // Check cache first
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
            }).on('error', (err) => {
                console.error(`[SkinServer] Skin fetch error for ${uuid}:`, err.message);
                resolve({ data: null, exists: false });
            });
        });
    }

    // Fetch cape from Supabase with caching
    private async fetchCapeFromSupabase(uuid: string): Promise<{ data: Buffer | null, exists: boolean }> {
        const cleanUuid = uuid.replace(/-/g, '');
        const formattedUuid = cleanUuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

        // Check cache first
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
            }).on('error', (err) => {
                console.error(`[SkinServer] Cape fetch error for ${uuid}:`, err.message);
                resolve({ data: null, exists: false });
            });
        });
    }

    // Fetch profile from Mojang API (for premium server support)
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

    // Look up Whoap user by username from Supabase
    private async lookupWhoapUser(username: string): Promise<{ uuid: string; name: string } | null> {
        return new Promise((resolve) => {
            // Query the profiles table for the username
            const url = `${this.SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,username`;

            https.get(url, {
                headers: {
                    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImliddGN0emtxemV6cnRjZ2xpY2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzYxMDY2NjUsImV4cCI6MjA1MTY4MjY2NX0.example',
                    'Content-Type': 'application/json'
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const profiles = JSON.parse(data);
                            if (profiles.length > 0) {
                                resolve({ uuid: profiles[0].id, name: profiles[0].username });
                            } else {
                                resolve(null);
                            }
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

        // CORS headers for cross-origin requests
        this.app_express.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (req.method === 'OPTIONS') {
                return res.status(204).send();
            }
            next();
        });

        // Request logging middleware
        this.app_express.use((req, res, next) => {
            console.log(`[SkinServer] ${req.method} ${req.path}`);
            next();
        });

        // ============================================
        // ROOT METADATA ENDPOINTS (for authlib-injector)
        // ============================================

        // Root Metadata - Primary endpoint for authlib-injector
        this.app_express.get('/', (req: Request, res: Response) => {
            const metadata = {
                meta: {
                    serverName: "Whoap Skin Server",
                    implementationName: "whoap-yggdrasil",
                    implementationVersion: "3.1.0",
                    feature: {
                        // Enable all features for maximum compatibility
                        non_email_login: true,
                        legacy_skin_api: true,
                        // IMPORTANT: Set to false to allow Mojang namespace for mixed servers
                        // This enables loading other players' skins from Mojang
                        no_mojang_namespace: false,
                        enable_mojang_anti_features: false,
                        enable_profile_key: true,
                        username_check: false,
                        // Enable texture hash download for multiplayer
                        noAuthlib: false
                    }
                },
                skinDomains: [
                    // Local server
                    "127.0.0.1",
                    "localhost",
                    ".localhost",
                    // Supabase storage (our skin storage)
                    ".supabase.co",
                    `${this.SUPABASE_PROJECT}.supabase.co`,
                    "ibtctzkqzezrtcglicjf.supabase.co",
                    // Mojang official (for other players' skins)
                    ".minecraft.net",
                    "textures.minecraft.net",
                    "api.mojang.com",
                    "sessionserver.mojang.com",
                    // Fallback skin services
                    "mc-heads.net",
                    ".mc-heads.net",
                    "crafatar.com",
                    ".crafatar.com",
                    "minotar.net",
                    ".minotar.net",
                    // Custom domains
                    "api.whoap.com",
                    ".whoap.com"
                ],
                signaturePublickey: this.getPublicKey()
            };
            res.json(metadata);
        });

        // Authlib-injector specific metadata endpoint
        this.app_express.get('/authlib-injector', (req: Request, res: Response) => {
            res.redirect('/');
        });

        this.app_express.get('/authlib-injector/yggdrasil', (req: Request, res: Response) => {
            res.redirect('/');
        });

        // Alternative metadata paths used by some servers
        this.app_express.get('/yggdrasil', (req: Request, res: Response) => {
            res.redirect('/');
        });

        // ============================================
        // SESSION SERVER ENDPOINTS (for skin/profile lookups)
        // ============================================

        // Profile Endpoint - Single UUID lookup (most common)
        // This is called by the game client to fetch player profiles for skin display
        this.app_express.get('/sessionserver/session/minecraft/profile/:uuid', async (req: Request, res: Response) => {
            let uuid = req.params.uuid as string;

            // Remove .png extension if present (some clients append it)
            uuid = uuid.replace('.png', '');

            // Validate UUID length
            if (uuid.length < 32) {
                return res.status(400).json({ error: "Invalid UUID" });
            }

            // Normalize UUID for comparison (remove dashes)
            const cleanRequestUuid = uuid.replace(/-/g, '');

            console.log(`[SkinServer] Profile request for UUID: ${cleanRequestUuid}`);

            // Check current user first (highest priority)
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
                    console.log(`[SkinServer] Matched current user: ${username}`);
                }
            }

            // Check player cache for other Whoap users
            if (!isMatch) {
                const cachedPlayer = SkinServerManager.getCachedPlayer(cleanRequestUuid);
                if (cachedPlayer) {
                    username = cachedPlayer.name;
                    skinUuid = cachedPlayer.realUuid;
                    isMatch = true;
                    console.log(`[SkinServer] Matched cached player: ${username}`);
                }
            }

            // If not a known user, try to fetch from Mojang as fallback
            // This allows premium players on mixed servers to still show their skins
            if (!isMatch) {
                try {
                    const mojangProfile = await this.fetchMojangProfile(cleanRequestUuid);
                    if (mojangProfile) {
                        username = mojangProfile.name;
                        console.log(`[SkinServer] Fetched Mojang profile: ${username}`);
                        // For Mojang profiles, redirect to official session server
                        // to get properly signed textures
                        return res.redirect(`https://sessionserver.mojang.com/session/minecraft/profile/${cleanRequestUuid}?unsigned=false`);
                    }
                } catch (e) {
                    console.log(`[SkinServer] Mojang profile fetch failed, using fallback`);
                }
            }

            // Generate properties with our signature
            let responseProperties;
            if (isMatch) {
                responseProperties = this.generateAliasedSkinPayload(cleanRequestUuid, skinUuid, username, { model: skinModel });
            } else {
                // For unknown players, provide textures that point to our server
                // This allows our client to at least try to render something
                responseProperties = this.getTextureProperties(cleanRequestUuid, username);
            }

            const response: any = {
                id: cleanRequestUuid,
                name: username,
                properties: responseProperties
            };

            res.json(response);
        });

        // Proxy endpoint for Mojang session server (used by authlib-injector)
        // Format: /https/sessionserver.mojang.com/... 
        // Note: Express 5 requires named wildcard parameters
        this.app_express.get('/https/*proxyPath', async (req: Request, res: Response) => {
            // Extract the real URL from the path using the named parameter
            const proxyPath = (req.params as any).proxyPath || req.params[0] || '';
            const targetUrl = 'https://' + proxyPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');

            console.log(`[SkinServer] Proxy request: ${targetUrl}`);

            try {
                // Check if this is a profile request for the current user
                if (targetUrl.includes('sessionserver.mojang.com/session/minecraft/profile/')) {
                    const uuidMatch = targetUrl.match(/profile\/([a-f0-9-]+)/i);
                    if (uuidMatch) {
                        const requestedUuid = uuidMatch[1].replace(/-/g, '');
                        const currentUser = SkinServerManager.getCurrentUser();

                        if (currentUser) {
                            const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                            const cleanOfflineUuid = currentUser.offlineUuid?.replace(/-/g, '') || '';

                            if (requestedUuid === cleanRealUuid || requestedUuid === cleanOfflineUuid) {
                                // Return our custom profile instead of proxying to Mojang
                                console.log(`[SkinServer] Proxy: Returning custom profile for current user`);
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

                // Forward to Mojang for other requests
                const response = await new Promise<{ statusCode: number; data: string }>((resolve, reject) => {
                    https.get(targetUrl, (proxyRes) => {
                        let data = '';
                        proxyRes.on('data', chunk => data += chunk);
                        proxyRes.on('end', () => {
                            resolve({ statusCode: proxyRes.statusCode || 500, data });
                        });
                    }).on('error', reject);
                });

                res.status(response.statusCode);

                // Try to parse as JSON and forward
                try {
                    const json = JSON.parse(response.data);
                    res.json(json);
                } catch {
                    res.send(response.data);
                }
            } catch (err: any) {
                console.error(`[SkinServer] Proxy error:`, err.message);
                res.status(502).json({ error: "Proxy error", message: err.message });
            }
        });

        // ============================================
        // TEXTURE ENDPOINTS (skin/cape serving) - NEW UNIFIED APPROACH
        // ============================================

        // Skin Texture Endpoint - Direct serving with fallback
        this.app_express.get('/textures/skin/:uuid', async (req: Request, res: Response) => {
            let uuid = req.params.uuid as string;
            uuid = uuid.replace('.png', ''); // Remove .png extension if present

            console.log(`[SkinServer] Fetching skin for: ${uuid}`);

            // Check if this is the current user
            const currentUser = SkinServerManager.getCurrentUser();
            let targetUuid = uuid;

            if (currentUser) {
                const cleanUuid = uuid.replace(/-/g, '');
                const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                const cleanOfflineUuid = currentUser.offlineUuid?.replace(/-/g, '') || '';

                if (cleanUuid === cleanRealUuid || cleanUuid === cleanOfflineUuid) {
                    targetUuid = currentUser.uuid;
                }
            }

            // Try to fetch from Supabase
            const result = await this.fetchSkinFromSupabase(targetUuid);

            if (result.exists && result.data) {
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('Cache-Control', 'public, max-age=60');
                res.send(result.data);
            } else {
                // Return default Steve skin
                if (SkinServerManager.DEFAULT_STEVE_SKIN) {
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'public, max-age=300');
                    res.send(SkinServerManager.DEFAULT_STEVE_SKIN);
                } else {
                    // Fallback to mc-heads
                    const cleanUuid = targetUuid.replace(/-/g, '');
                    res.redirect(`https://mc-heads.net/skin/${cleanUuid}`);
                }
            }
        });

        // Cape Texture Endpoint
        this.app_express.get('/textures/cape/:uuid', async (req: Request, res: Response) => {
            let uuid = req.params.uuid as string;
            uuid = uuid.replace('.png', ''); // Remove .png extension if present

            console.log(`[SkinServer] Fetching cape for: ${uuid}`);

            // Check if this is the current user
            const currentUser = SkinServerManager.getCurrentUser();
            let targetUuid = uuid;

            if (currentUser) {
                const cleanUuid = uuid.replace(/-/g, '');
                const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                const cleanOfflineUuid = currentUser.offlineUuid?.replace(/-/g, '') || '';

                if (cleanUuid === cleanRealUuid || cleanUuid === cleanOfflineUuid) {
                    targetUuid = currentUser.uuid;
                }
            }

            // Try to fetch from Supabase
            const result = await this.fetchCapeFromSupabase(targetUuid);

            if (result.exists && result.data) {
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('Cache-Control', 'public, max-age=60');
                res.send(result.data);
            } else {
                // No cape - return 404
                res.status(404).send('Cape not found');
            }
        });

        // Legacy skin endpoint (backward compatibility)
        this.app_express.get('/skins/:filename', async (req: Request, res: Response) => {
            const filename = req.params.filename as string;
            const uuid = filename.replace('.png', '');
            res.redirect(`/textures/skin/${uuid}`);
        });

        // Legacy cape endpoint (backward compatibility)
        this.app_express.get('/capes/:filename', async (req: Request, res: Response) => {
            const filename = req.params.filename as string;
            const uuid = filename.replace('.png', '');
            res.redirect(`/textures/cape/${uuid}`);
        });

        // Legacy texture endpoint (some older clients/servers use this)
        this.app_express.get('/textures/:hash', (req: Request, res: Response) => {
            const hash = req.params.hash as string;
            res.redirect(`/textures/skin/${hash}`);
        });

        // ============================================
        // BATCH PROFILE ENDPOINTS (for multiplayer servers)
        // ============================================

        // Batch profile lookup by usernames (used by servers to get UUIDs)
        this.app_express.post('/api/profiles/minecraft', async (req: Request, res: Response) => {
            const usernames: string[] = req.body;

            console.log(`[SkinServer] Batch profile lookup for ${usernames?.length || 0} usernames`);

            if (!Array.isArray(usernames)) {
                return res.status(400).json({ error: "Expected array of usernames" });
            }

            const profiles: any[] = [];
            const currentUser = SkinServerManager.getCurrentUser();

            for (const username of usernames.slice(0, 10)) { // Limit to 10 for safety
                // Check if it's the current user
                if (currentUser && currentUser.name.toLowerCase() === username.toLowerCase()) {
                    profiles.push({
                        id: currentUser.uuid.replace(/-/g, ''),
                        name: currentUser.name
                    });
                    continue;
                }

                // Generate offline UUID for this username (for cracked server compatibility)
                const offlineUuid = SkinServerManager.getOfflineUuid(username);
                profiles.push({
                    id: offlineUuid.replace(/-/g, ''),
                    name: username
                });
            }

            res.json(profiles);
        });

        // Alternative endpoint path used by some implementations
        this.app_express.get('/api/profiles/minecraft', async (req: Request, res: Response) => {
            // Handle query parameter format: ?name=user1&name=user2
            let usernames = req.query.name;
            if (!usernames) {
                return res.json([]);
            }
            if (!Array.isArray(usernames)) {
                usernames = [usernames as string];
            }

            const profiles: any[] = [];
            const currentUser = SkinServerManager.getCurrentUser();

            for (const username of (usernames as string[]).slice(0, 10)) {
                if (currentUser && currentUser.name.toLowerCase() === username.toLowerCase()) {
                    profiles.push({
                        id: currentUser.uuid.replace(/-/g, ''),
                        name: currentUser.name
                    });
                    continue;
                }

                const offlineUuid = SkinServerManager.getOfflineUuid(username);
                profiles.push({
                    id: offlineUuid.replace(/-/g, ''),
                    name: username
                });
            }

            res.json(profiles);
        });

        // ============================================
        // SESSION/JOIN ENDPOINTS (for server authentication)
        // ============================================

        // Join server endpoint (called by client when connecting to a server)
        // This is CRITICAL for multiplayer - stores the session for hasJoined verification
        this.app_express.post('/sessionserver/session/minecraft/join', (req: Request, res: Response) => {
            const { accessToken, selectedProfile, serverId } = req.body;

            console.log(`[SkinServer] Join request: ${selectedProfile?.name || selectedProfile} -> server ${serverId?.substring(0, 8)}...`);

            // Validate required fields
            if (!selectedProfile || !serverId) {
                console.warn('[SkinServer] Join: Missing required fields');
                return res.status(400).json({ error: "Bad Request", errorMessage: "Missing required fields" });
            }

            // Extract profile ID (can be object or string)
            const profileId = typeof selectedProfile === 'object' ? selectedProfile.id : selectedProfile;
            const profileName = typeof selectedProfile === 'object' ? selectedProfile.name : null;

            // Store the join session for hasJoined verification
            // Key: serverId (servers use this to verify the join)
            const currentUser = SkinServerManager.getCurrentUser();
            const username = profileName || currentUser?.name || 'Unknown';

            const session: JoinSession = {
                accessToken: accessToken || '',
                selectedProfile: profileId?.replace(/-/g, '') || '',
                serverId: serverId,
                username: username,
                timestamp: Date.now()
            };

            // Store by composite key for accurate lookups
            const sessionKey = `${serverId}:${username.toLowerCase()}`;
            SkinServerManager.joinSessions.set(sessionKey, session);

            // Also store by serverId alone for fallback
            SkinServerManager.joinSessions.set(serverId, session);

            console.log(`[SkinServer] Join session stored for ${username} (key: ${sessionKey})`);

            // Clean up expired sessions periodically
            this.cleanupExpiredSessions();

            // Return 204 No Content on success (Mojang API behavior)
            res.status(204).send();
        });

        // Has joined endpoint (called by server to verify client joined)
        // This is the CRITICAL endpoint for multiplayer skin visibility!
        this.app_express.get('/sessionserver/session/minecraft/hasJoined', async (req: Request, res: Response) => {
            const username = req.query.username as string;
            const serverId = req.query.serverId as string;
            const ip = req.query.ip as string; // Optional IP for additional validation

            console.log(`[SkinServer] HasJoined check: ${username} on server ${serverId?.substring(0, 8)}...`);

            if (!username) {
                return res.status(400).json({ error: "Missing username" });
            }

            // First, check if we have a stored join session for this user/server
            const sessionKey = `${serverId}:${username.toLowerCase()}`;
            let session = SkinServerManager.joinSessions.get(sessionKey);

            // Fallback to serverId-only lookup
            if (!session) {
                session = SkinServerManager.joinSessions.get(serverId);
            }

            // Validate session exists and matches
            const currentUser = SkinServerManager.getCurrentUser();
            let uuid: string;
            let skinUuid: string;
            let skinModel: 'default' | 'slim' = 'default';
            let isValidSession = false;

            // Check if this is the current user AND we have a valid session
            if (currentUser && currentUser.name.toLowerCase() === username.toLowerCase()) {
                // Verify session if present
                if (session && (Date.now() - session.timestamp) < SkinServerManager.JOIN_SESSION_TTL) {
                    isValidSession = true;
                    console.log(`[SkinServer] Valid session found for ${username}`);
                } else {
                    // For the current user, allow even without session (they just joined via our launcher)
                    isValidSession = true;
                    console.log(`[SkinServer] Allowing current user ${username} without explicit session`);
                }

                uuid = currentUser.uuid;
                skinUuid = currentUser.uuid;
                skinModel = currentUser.skinModel || 'default';
            } else {
                // For other players, they need a valid session
                if (session && (Date.now() - session.timestamp) < SkinServerManager.JOIN_SESSION_TTL) {
                    isValidSession = true;
                    uuid = SkinServerManager.getOfflineUuid(username);
                    skinUuid = uuid;

                    // Check cache for registered Whoap player
                    const cached = SkinServerManager.getCachedPlayer(uuid);
                    if (cached) {
                        skinUuid = cached.realUuid;
                    }
                } else {
                    // No valid session - return empty response (Mojang behavior for failed hasJoined)
                    console.log(`[SkinServer] No valid session for ${username}, returning 204`);
                    return res.status(204).send();
                }
            }

            // Clean up the used session
            if (session) {
                SkinServerManager.joinSessions.delete(sessionKey);
                SkinServerManager.joinSessions.delete(serverId);
            }

            const cleanUuid = uuid.replace(/-/g, '');
            const properties = this.generateAliasedSkinPayload(cleanUuid, skinUuid, username, { model: skinModel });

            const response = {
                id: cleanUuid,
                name: username,
                properties: properties
            };

            console.log(`[SkinServer] HasJoined success for ${username}, UUID: ${cleanUuid}`);
            res.json(response);
        });

        // ============================================
        // AUTHENTICATION ENDPOINTS (Yggdrasil API)
        // ============================================

        // Authenticate endpoint
        this.app_express.post('/authserver/authenticate', (req: Request, res: Response) => {
            const { username, password } = req.body;
            const token = uuidv4();

            // Generate UUID (use offline UUID for consistency)
            const uuid = SkinServerManager.getOfflineUuid(username);
            const id = uuid.replace(/-/g, '');

            // Generate texture properties for this user
            const properties = this.getTextureProperties(id, username);

            console.log(`[SkinServer] Auth: ${username} -> ${id}`);

            res.json({
                accessToken: token,
                clientToken: req.body.clientToken || uuidv4(),
                selectedProfile: { id, name: username, properties },
                availableProfiles: [{ id, name: username, properties }]
            });
        });

        this.app_express.post('/authserver/validate', (req: Request, res: Response) => {
            res.status(204).send();
        });

        this.app_express.post('/authserver/invalidate', (req: Request, res: Response) => {
            res.status(204).send();
        });

        this.app_express.post('/authserver/signout', (req: Request, res: Response) => {
            res.status(204).send();
        });

        this.app_express.post('/authserver/refresh', (req: Request, res: Response) => {
            const selectedProfile = req.body.selectedProfile;
            if (selectedProfile) {
                selectedProfile.properties = this.getTextureProperties(selectedProfile.id, selectedProfile.name);
            }

            res.json({
                accessToken: req.body.accessToken || uuidv4(),
                clientToken: req.body.clientToken,
                selectedProfile: selectedProfile
            });
        });

        // ============================================
        // MINECRAFT SERVICES ENDPOINTS (Modern MC)
        // ============================================

        // MinecraftServices Profile Endpoint
        this.app_express.get('/minecraftservices/minecraft/profile', (req: Request, res: Response) => {
            const currentUser = SkinServerManager.getCurrentUser();

            console.log(`[SkinServer] MinecraftServices profile request for: ${currentUser?.name || 'NONE'}`);

            if (!currentUser) {
                res.status(404).json({ error: "NOT_FOUND", errorMessage: "Not Found" });
                return;
            }

            let uuid = currentUser.uuid;
            if (uuid.length === 32) {
                uuid = uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
            }
            const profileId = uuid.replace(/-/g, '');

            // Use Supabase URLs for better compatibility with third-party servers
            const skinUrl = `${this.SUPABASE_URL}/storage/v1/object/public/skins/${uuid}.png`;
            const capeUrl = `${this.SUPABASE_URL}/storage/v1/object/public/capes/${uuid}.png`;

            res.json({
                id: profileId,
                name: currentUser.name,
                skins: [{
                    id: profileId,
                    state: "ACTIVE",
                    url: skinUrl,
                    variant: currentUser.skinModel === 'slim' ? 'SLIM' : 'CLASSIC'
                }],
                capes: [{
                    id: profileId,
                    state: "ACTIVE",
                    url: capeUrl,
                    alias: "whoap"
                }]
            });
        });

        // Player certificates endpoint (for chat signing in 1.19+)
        this.app_express.get('/minecraftservices/player/certificates', (req: Request, res: Response) => {
            // Return empty certificates - disables chat signing but allows multiplayer
            res.json({
                keyPair: {
                    privateKey: "",
                    publicKey: ""
                },
                publicKeySignature: "",
                publicKeySignatureV2: "",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                refreshedAfter: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
            });
        });

        // ============================================
        // WHOAP-SPECIFIC ENDPOINTS (for Whoap users visibility)
        // ============================================

        // Register a Whoap player (called by launcher when seeing another Whoap user)
        this.app_express.post('/whoap/register-player', (req: Request, res: Response) => {
            const { uuid, name, realUuid } = req.body;

            if (uuid && name && realUuid) {
                SkinServerManager.registerPlayer(uuid, name, realUuid);
                res.json({ success: true });
            } else {
                res.status(400).json({ error: "Missing required fields" });
            }
        });

        // Get all registered Whoap players (for debugging)
        this.app_express.get('/whoap/players', (req: Request, res: Response) => {
            const players: any[] = [];
            SkinServerManager.playerCache.forEach((value, key) => {
                if (Date.now() - value.timestamp < SkinServerManager.CACHE_TTL) {
                    players.push({
                        uuid: key,
                        name: value.name,
                        realUuid: value.realUuid
                    });
                }
            });
            res.json(players);
        });

        // Clear texture cache endpoint (for debugging)
        this.app_express.post('/whoap/clear-cache', (req: Request, res: Response) => {
            SkinServerManager.skinCache.clear();
            SkinServerManager.capeCache.clear();
            console.log('[SkinServer] Cache cleared');
            res.json({ success: true });
        });

        // Health check endpoint
        this.app_express.get('/whoap/health', (req: Request, res: Response) => {
            const currentUser = SkinServerManager.currentUser;
            res.json({
                status: 'ok',
                currentUser: currentUser ? {
                    name: currentUser.name,
                    uuid: currentUser.uuid,
                    offlineUuid: currentUser.offlineUuid,
                    skinModel: currentUser.skinModel
                } : null,
                cachedPlayers: SkinServerManager.playerCache.size,
                cachedSkins: SkinServerManager.skinCache.size,
                cachedCapes: SkinServerManager.capeCache.size,
                activeSessions: SkinServerManager.joinSessions.size
            });
        });

        // Debug endpoint - get full texture payload for current user
        this.app_express.get('/whoap/debug/texture', (req: Request, res: Response) => {
            const currentUser = SkinServerManager.getCurrentUser();
            if (!currentUser) {
                return res.status(404).json({ error: "No current user" });
            }

            const cleanUuid = currentUser.uuid.replace(/-/g, '');
            const properties = this.generateAliasedSkinPayload(
                cleanUuid,
                currentUser.uuid,
                currentUser.name,
                { model: currentUser.skinModel || 'default' }
            );

            // Decode the texture payload for inspection
            const textureBase64 = properties[0].value;
            const textureJson = JSON.parse(Buffer.from(textureBase64, 'base64').toString('utf-8'));

            res.json({
                uuid: currentUser.uuid,
                offlineUuid: currentUser.offlineUuid,
                name: currentUser.name,
                skinModel: currentUser.skinModel,
                properties: properties,
                decodedTextures: textureJson,
                supabaseUrl: `${this.SUPABASE_URL}/storage/v1/object/public/skins/${currentUser.uuid}.png`
            });
        });

        // ============================================
        // PUBLIC KEY ENDPOINTS (for signature verification)
        // ============================================

        // Public key endpoint (used by servers to verify signatures)
        this.app_express.get('/publickey', (req: Request, res: Response) => {
            res.setHeader('Content-Type', 'text/plain');
            res.send(this.getPublicKey());
        });

        // Alternative public key paths
        this.app_express.get('/api/yggdrasil/publickey', (req: Request, res: Response) => {
            res.setHeader('Content-Type', 'text/plain');
            res.send(this.getPublicKey());
        });
    }

    // Cleanup expired join sessions periodically
    private cleanupExpiredSessions(): void {
        const now = Date.now();
        const expiredKeys: string[] = [];

        SkinServerManager.joinSessions.forEach((session, key) => {
            if (now - session.timestamp > SkinServerManager.JOIN_SESSION_TTL) {
                expiredKeys.push(key);
            }
        });

        expiredKeys.forEach(key => {
            SkinServerManager.joinSessions.delete(key);
        });

        if (expiredKeys.length > 0) {
            console.log(`[SkinServer] Cleaned up ${expiredKeys.length} expired sessions`);
        }
    }

    public start(): void {
        // Find an available port if default is taken
        const tryStart = (port: number) => {
            this.server = this.app_express.listen(port, '127.0.0.1', () => {
                this.port = port;
                console.log(`[SkinServer] ✓ Started on http://127.0.0.1:${port}`);
            }).on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    console.warn(`[SkinServer] Port ${port} in use, trying ${port + 1}`);
                    tryStart(port + 1);
                } else {
                    console.error('[SkinServer] Failed to start:', err);
                }
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
