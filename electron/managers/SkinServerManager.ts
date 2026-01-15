
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

export class SkinServerManager {
    private static instance: SkinServerManager;
    private static currentUser: { uuid: string; name: string; offlineUuid?: string } | null = null;

    // Cache for other players' profiles (Whoap users on multiplayer servers)
    private static playerCache: Map<string, CachedProfile> = new Map();
    private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

    private app_express;
    private server: any;
    private port = 3000;
    private key: NodeRSA;
    private keyPath: string;

    // Supabase configuration for fetching other Whoap users
    private readonly SUPABASE_PROJECT = 'ibtctzkqzezrtcglicjf';
    private readonly SUPABASE_URL = `https://${this.SUPABASE_PROJECT}.supabase.co`;

    public static getInstance(): SkinServerManager {
        return SkinServerManager.instance;
    }

    public static setCurrentUser(uuid: string, name: string) {
        // Calculate offline UUID for this user to support cracked servers
        const offlineUuid = SkinServerManager.getOfflineUuid(name);
        SkinServerManager.currentUser = { uuid, name, offlineUuid };
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
        this.keyPath = path.join(dataPath, 'skin-server-key-2048.pem');

        // Load or generate RSA key
        this.key = this.loadOrGenerateKey();

        this.setupRoutes();
        this.start();

        // SELF-TEST: Verify signature
        try {
            const testPayload = "eyJ0ZXN0IjoidmFsdWUifQ=="; // base64 of {"test":"value"}
            const signature = this.sign(testPayload);
            this.key.verify(Buffer.from(testPayload, 'utf-8'), signature, undefined, 'base64');
        } catch (e) {
            console.error(`[SkinServer] ✗ Self-test failed:`, e);
        }
    }

    private loadOrGenerateKey(): NodeRSA {
        try {
            if (fs.existsSync(this.keyPath)) {
                const keyData = fs.readFileSync(this.keyPath, 'utf-8');
                const key = new NodeRSA(keyData);
                return key;
            }
        } catch (err) {
            console.warn('[SkinServer] Failed to load existing key, generating new one:', err);
        }

        // Generate new key with 2048 bits (standard, 4096 might be too big/slow or rejected)
        const key = new NodeRSA({ b: 2048 });
        key.setOptions({ signingScheme: 'pkcs1-sha1' }); // authlib-injector expects SHA1withRSA

        // Save for future use
        try {
            fs.writeFileSync(this.keyPath, key.exportKey('private'));
        } catch (err) {
            console.error('[SkinServer] Failed to save RSA key:', err);
        }

        return key;
    }

    private getPublicKey(): string {
        // authlib-injector expects the public key in PEM format WITH headers
        // See: KeyUtils.parseSignaturePublicKey() expects "-----BEGIN PUBLIC KEY-----"
        return this.key.exportKey('public');
    }

    private sign(data: string): string {
        // Sign with SHA1 and PKCS1 padding (SHA1withRSA)
        this.key.setOptions({ signingScheme: 'pkcs1-sha1' });
        return this.key.sign(Buffer.from(data, 'utf-8'), 'base64');
    }

    private getTextureProperties(uuid: string, name: string, skinUuid?: string): any[] {
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

        // PROXY APPROACH: Serve from localhost to avoid domain issues
        const skinUrl = `http://localhost:${this.port}/skins/${formattedSkinUuid}.png`;
        const capeUrl = `http://localhost:${this.port}/capes/${formattedSkinUuid}.png`;

        const texturePayload = {
            timestamp: Date.now(),
            profileId: profileId,
            profileName: name,
            textures: {
                SKIN: {
                    url: skinUrl
                },
                CAPE: {
                    url: capeUrl
                }
            }
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

    // New method to handle aliased skin payloads
    private generateAliasedSkinPayload(requestedProfileId: string, realUuidForSkin: string, name: string): any[] {
        // Ensure UUID has dashes for the skin URL
        let formattedSkinUuid = realUuidForSkin;
        if (realUuidForSkin.length === 32) {
            formattedSkinUuid = realUuidForSkin.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }

        // PROXY APPROACH: Serve from localhost to avoid domain issues
        const skinUrl = `http://localhost:${this.port}/skins/${formattedSkinUuid}.png`;
        const capeUrl = `http://localhost:${this.port}/capes/${formattedSkinUuid}.png`;

        const texturePayload = {
            timestamp: Date.now(),
            profileId: requestedProfileId.replace(/-/g, ''), // Use the requested ID for the payload's profileId
            profileName: name,
            textures: {
                SKIN: {
                    url: skinUrl // Use the real UUID for the skin URL
                },
                CAPE: {
                    url: capeUrl // Use the real UUID for the cape URL
                }
            }
        };

        const textureBase64 = Buffer.from(JSON.stringify(texturePayload)).toString('base64');
        const signature = this.sign(textureBase64);

        return [{
            name: "textures",
            value: textureBase64,
            signature: signature
        }];
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
                    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImliddGN0emtxemV6cnRjZ2xpY2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzYxMDY2NjUsImV4cCI6MjA1MTY4MjY2NX0.example', // This would need to be the actual anon key
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
                    implementationVersion: "2.0.0",
                    feature: {
                        // Enable all features for maximum compatibility
                        non_email_login: true,
                        legacy_skin_api: true,
                        no_mojang_namespace: true,
                        enable_mojang_anti_features: false,
                        enable_profile_key: true,
                        username_check: false
                    }
                },
                skinDomains: [
                    "localhost",
                    "127.0.0.1",
                    ".localhost",
                    ".supabase.co",
                    "ibtctzkqzezrtcglicjf.supabase.co",
                    ".minecraft.net",
                    "textures.minecraft.net",
                    "mc-heads.net",
                    "api.whoap.com",
                    ".whoap.com"
                ],
                signaturePublickey: this.getPublicKey()
            };
            res.json(metadata);
        });

        // Authlib-injector specific metadata endpoint
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
        this.app_express.get('/sessionserver/session/minecraft/profile/:uuid', async (req: Request, res: Response) => {
            let { uuid } = req.params;
            if (Array.isArray(uuid)) uuid = uuid[0];

            // Validate UUID length
            if (uuid.length < 32) {
                return res.status(400).json({ error: "Invalid UUID" });
            }

            // Normalize UUID for comparison (remove dashes)
            const cleanRequestUuid = uuid.replace(/-/g, '');

            console.log(`[SkinServer] Profile request for UUID: ${cleanRequestUuid}`);

            // Check current user first
            const currentUser = SkinServerManager.getCurrentUser();
            let username = "Player_" + uuid.substring(0, 5);
            let skinUuid = cleanRequestUuid;
            let isMatch = false;

            if (currentUser) {
                const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                const cleanOfflineUuid = currentUser.offlineUuid ? currentUser.offlineUuid.replace(/-/g, '') : '';

                if (cleanRequestUuid === cleanRealUuid || cleanRequestUuid === cleanOfflineUuid) {
                    username = currentUser.name;
                    skinUuid = currentUser.uuid;
                    isMatch = true;
                }
            }

            // Check player cache for other Whoap users
            if (!isMatch) {
                const cachedPlayer = SkinServerManager.getCachedPlayer(cleanRequestUuid);
                if (cachedPlayer) {
                    username = cachedPlayer.name;
                    skinUuid = cachedPlayer.realUuid;
                    isMatch = true;
                }
            }

            // Generate properties
            let responseProperties;
            if (isMatch) {
                responseProperties = this.generateAliasedSkinPayload(cleanRequestUuid, skinUuid, username);
            } else {
                // For unknown players, still provide signed textures (may not have actual skin)
                responseProperties = this.getTextureProperties(cleanRequestUuid, username);
            }

            const response: any = {
                id: cleanRequestUuid,
                name: username,
                properties: responseProperties
            };

            res.json(response);
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
        this.app_express.post('/sessionserver/session/minecraft/join', (req: Request, res: Response) => {
            const { accessToken, selectedProfile, serverId } = req.body;

            console.log(`[SkinServer] Join request: ${selectedProfile?.name} -> server ${serverId?.substring(0, 8)}...`);

            // Store the join attempt for hasJoined verification
            const currentUser = SkinServerManager.getCurrentUser();
            if (currentUser && selectedProfile) {
                // In a full implementation, you'd store this for hasJoined validation
                // For now, we just accept all joins
            }

            // Return 204 No Content on success (Mojang API behavior)
            res.status(204).send();
        });

        // Has joined endpoint (called by server to verify client joined)
        this.app_express.get('/sessionserver/session/minecraft/hasJoined', (req: Request, res: Response) => {
            const username = req.query.username as string;
            const serverId = req.query.serverId as string;

            console.log(`[SkinServer] HasJoined check: ${username}`);

            if (!username) {
                return res.status(400).json({ error: "Missing username" });
            }

            // Look up the user
            const currentUser = SkinServerManager.getCurrentUser();
            let uuid: string;
            let skinUuid: string;

            if (currentUser && currentUser.name.toLowerCase() === username.toLowerCase()) {
                uuid = currentUser.uuid;
                skinUuid = currentUser.uuid;
            } else {
                // For other players, generate offline UUID
                uuid = SkinServerManager.getOfflineUuid(username);
                skinUuid = uuid;

                // Check cache
                const cached = SkinServerManager.getCachedPlayer(uuid);
                if (cached) {
                    skinUuid = cached.realUuid;
                }
            }

            const cleanUuid = uuid.replace(/-/g, '');
            const properties = this.generateAliasedSkinPayload(cleanUuid, skinUuid, username);

            res.json({
                id: cleanUuid,
                name: username,
                properties: properties
            });
        });

        // ============================================
        // TEXTURE ENDPOINTS (skin/cape serving)
        // ============================================

        // Skin Proxy Endpoint with fallback
        this.app_express.get('/skins/:filename', (req: Request, res: Response) => {
            const { filename } = req.params;
            const upstreamUrl = `${this.SUPABASE_URL}/storage/v1/object/public/skins/${filename}`;

            console.log(`[SkinServer] Fetching skin: ${filename}`);

            https.get(upstreamUrl, (upstreamRes) => {
                if (upstreamRes.statusCode === 200) {
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'public, max-age=60');
                    upstreamRes.pipe(res);
                } else {
                    // Fallback: Try to serve default Steve/Alex skin or return 404
                    res.status(404).send('Skin not found');
                }
            }).on('error', (err) => {
                console.error(`[SkinServer] ✗ Skin proxy error:`, err);
                res.status(500).send('Proxy error');
            });
        });

        // Cape Proxy Endpoint
        this.app_express.get('/capes/:filename', (req: Request, res: Response) => {
            const { filename } = req.params;
            const upstreamUrl = `${this.SUPABASE_URL}/storage/v1/object/public/capes/${filename}`;

            console.log(`[SkinServer] Fetching cape: ${filename}`);

            https.get(upstreamUrl, (upstreamRes) => {
                if (upstreamRes.statusCode === 200) {
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'public, max-age=60');
                    upstreamRes.pipe(res);
                } else {
                    // Silent fail for capes (most users don't have capes)
                    res.status(404).send('Cape not found');
                }
            }).on('error', (err) => {
                console.error(`[SkinServer] ✗ Cape proxy error:`, err);
                res.status(500).send('Proxy error');
            });
        });

        // Legacy texture endpoint (some older clients/servers use this)
        this.app_express.get('/textures/:hash', (req: Request, res: Response) => {
            // Redirect to skin endpoint
            res.redirect(`/skins/${req.params.hash}.png`);
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

            const skinUrl = `http://localhost:${this.port}/skins/${uuid}.png`;
            const capeUrl = `http://localhost:${this.port}/capes/${uuid}.png`;

            res.json({
                id: profileId,
                name: currentUser.name,
                skins: [{
                    id: profileId,
                    state: "ACTIVE",
                    url: skinUrl,
                    variant: "CLASSIC"
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

    public start() {
        this.server = this.app_express.listen(this.port, '127.0.0.1', () => {
        });
    }

    public getPort(): number {
        return this.port;
    }
}
