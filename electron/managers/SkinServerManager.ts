
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import NodeRSA from 'node-rsa';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';

export class SkinServerManager {
    private static instance: SkinServerManager;
    private static currentUser: { uuid: string; name: string; offlineUuid?: string } | null = null;

    private app_express;
    private server: any;
    private port = 3000;
    private key: NodeRSA;
    private keyPath: string;

    public static setCurrentUser(uuid: string, name: string) {
        // Calculate offline UUID for this user to support cracked servers
        const offlineUuid = SkinServerManager.getOfflineUuid(name);
        SkinServerManager.currentUser = { uuid, name, offlineUuid };

        console.log(`[SkinServer] Current user set: ${name}`);
        console.log(`[SkinServer] - Real UUID: ${uuid}`);
        console.log(`[SkinServer] - Offline UUID: ${offlineUuid}`);
    }

    public static getCurrentUser() {
        return SkinServerManager.currentUser;
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
            const isValid = this.key.verify(Buffer.from(testPayload, 'utf-8'), signature, undefined, 'base64');
            console.log(`[SkinServer] Self-test signature verification: ${isValid ? 'PASSED' : 'FAILED'}`);
            console.log(`[SkinServer] Public Key Header: ${this.getPublicKey().split('\n')[0]}`);
        } catch (e) {
            console.error(`[SkinServer] Self-test failed:`, e);
        }
    }

    private loadOrGenerateKey(): NodeRSA {
        try {
            if (fs.existsSync(this.keyPath)) {
                const keyData = fs.readFileSync(this.keyPath, 'utf-8');
                const key = new NodeRSA(keyData);
                console.log('[SkinServer] Loaded existing RSA key');
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
            console.log('[SkinServer] Generated and saved new RSA key');
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

    private getTextureProperties(uuid: string, name: string): any[] {
        // Ensure UUID has dashes for the skin URL
        let formattedUuid = uuid;
        if (uuid.length === 32) {
            formattedUuid = uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }

        // Ensure UUID has NO dashes for profileId in payload
        const profileId = uuid.replace(/-/g, '');

        // PROXY APPROACH: Serve from localhost to avoid domain issues
        const skinUrl = `http://localhost:${this.port}/skins/${formattedUuid}.png`;
        const capeUrl = `http://localhost:${this.port}/capes/${formattedUuid}.png`;

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

    // New method to generate offline UUID
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

    private setupRoutes() {
        this.app_express.use(express.json());

        // CORS headers for cross-origin requests
        this.app_express.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            next();
        });

        // DEBUG LOGGING MIDDLEWARE
        this.app_express.use((req, res, next) => {
            console.log(`[SkinServer] ${req.method} ${req.url}`);
            console.log(`[SkinServer] Current User:`, SkinServerManager.currentUser?.name || 'None');
            next();
        });

        // Root Metadata - Primary endpoint for authlib-injector
        this.app_express.get('/', (req: Request, res: Response) => {
            const metadata = {
                meta: {
                    serverName: "Whoap Skin Server",
                    implementationName: "whoap-api",
                    implementationVersion: "1.0.0"
                },
                skinDomains: [
                    "localhost",
                    "127.0.0.1",
                    ".supabase.co",
                    "tjtutxeqkbkjfawdyazc.supabase.co",
                    ".minecraft.net",
                    "textures.minecraft.net",
                    "mc-heads.net",
                    "api.whoap.com"
                ],
                signaturePublickey: this.getPublicKey()
            };
            console.log(`[SkinServer] Serving root metadata. Current user: ${SkinServerManager.currentUser?.name || 'None'}`);
            res.json(metadata);
        });

        // Authlib-injector metadata endpoint
        this.app_express.get('/authlib-injector/yggdrasil', (req: Request, res: Response) => {
            const metadata = {
                meta: {
                    serverName: "Whoap Skin Server",
                    implementationName: "whoap-api",
                    implementationVersion: "1.0.0"
                },
                skinDomains: [
                    "localhost",
                    "127.0.0.1",
                    ".supabase.co",
                    "tjtutxeqkbkjfawdyazc.supabase.co",
                    ".minecraft.net",
                    "textures.minecraft.net",
                    "mc-heads.net",
                    "api.whoap.com"
                ],
                signaturePublickey: this.getPublicKey()
            };
            res.json(metadata);
        });

        // Profile Endpoint
        this.app_express.get('/sessionserver/session/minecraft/profile/:uuid', (req: Request, res: Response) => {
            let { uuid } = req.params;
            if (Array.isArray(uuid)) uuid = uuid[0]; // Ensure it's a string

            // Validate UUID length (simple check to avoid errors if random garbage is passed)
            if (uuid.length < 32) {
                return res.status(400).json({ error: "Invalid UUID" });
            }

            // Mock User Data
            // If we have a tracked user with this UUID, use their name
            const currentUser = SkinServerManager.getCurrentUser();
            let username = "Player_" + uuid.substring(0, 5);
            // let targetUuid = uuid; // This was the requested UUID, now handled by cleanRequestUuid

            // Normalize UUID for comparison (remove dashes)
            const cleanRequestUuid = uuid.replace(/-/g, '');

            let isMatch = false;

            if (currentUser) {
                const cleanRealUuid = currentUser.uuid.replace(/-/g, '');
                const cleanOfflineUuid = currentUser.offlineUuid ? currentUser.offlineUuid.replace(/-/g, '') : '';

                if (cleanRequestUuid === cleanRealUuid) {
                    console.log(`[SkinServer] Match found for REAL UUID: ${cleanRequestUuid}`);
                    username = currentUser.name;
                    // For the skin mapping, we use the REAL UUID as the key because that's what the file is named
                    // targetUuid = currentUser.uuid; // No longer needed directly here
                    isMatch = true;
                } else if (cleanRequestUuid === cleanOfflineUuid) {
                    console.log(`[SkinServer] Match found for OFFLINE UUID: ${cleanRequestUuid}`);
                    username = currentUser.name;
                    // CRITICAL: Even though they asked for the offline UUID, we must serve the skin 
                    // associated with the REAL UUID (because that's the filename we have).
                    // BUT, the 'profileId' in the response MUST match what they requested (the offline UUID).
                    // targetUuid = currentUser.uuid; // Use real UUID for skin filename lookup
                    isMatch = true;
                }
            }

            // IMPORTANT: The ID in the profile response MUST match the requested ID (cleanRequestUuid).
            // But the skin URL inside 'properties' will be generated based on targetUuid (the real one).

            // Generate properties using shared helper
            // We pass targetUuid (Real UUID) because that's what matches the filename on Supabase
            // const properties = this.getTextureProperties(targetUuid, username); // Old logic

            // However, the signature inside properties authenticates the profileId.
            // Wait, getTextureProperties uses the UUID passed to it as the profileId.
            // If we pass Real UUID, the profileId in the signed payload will be Real UUID.
            // If the game requested Offline UUID, and we return a profile with Real UUID, it might reject it.

            // CORRECT LOGIC:
            // 1. The profileId in the response JSON must be the REQUESTED UUID (cleanRequestUuid).
            // 2. The profileId in the SIGNED TEXTURE PAYLOAD must match the profileId in the response (so, REQUESTED UUID).
            // 3. The skin URL inside the texture payload should point to the REAL skin file (Real UUID).

            // Let's modify getTextureProperties signature or logic to handle this separation.
            // Or just instantiate a specific payload here.

            let responseProperties;

            if (isMatch && currentUser) {
                // Custom logic for match to ensure correct aliasing
                responseProperties = this.generateAliasedSkinPayload(cleanRequestUuid, currentUser.uuid, username);
            } else {
                // Fallback / standard logic
                // If no match, or no current user, we just serve a generic profile for the requested UUID.
                // The skin URL will be based on the requested UUID, which might not exist.
                responseProperties = this.getTextureProperties(cleanRequestUuid, username);
            }

            // Log what we're doing
            if (responseProperties && responseProperties.length > 0) {
                const propertiesDecoded = JSON.parse(Buffer.from(responseProperties[0].value, 'base64').toString());
                console.log(`[SkinServer] Serving profile for ${username} (${cleanRequestUuid})`);
                console.log(`[SkinServer] - Payload:`, JSON.stringify(propertiesDecoded, null, 2));
            }

            const response: any = {
                id: cleanRequestUuid,
                name: username,
                properties: responseProperties
            };

            res.json(response);
        });

        // Skin Proxy Endpoint
        this.app_express.get('/skins/:filename', (req: Request, res: Response) => {
            const { filename } = req.params;
            const SUPABASE_PROJECT = 'tjtutxeqkbkjfawdyazc';
            const upstreamUrl = `https://${SUPABASE_PROJECT}.supabase.co/storage/v1/object/public/skins/${filename}`;

            console.log(`[SkinServer] =======================================`);
            console.log(`[SkinServer] Skin Request: ${filename}`);
            console.log(`[SkinServer] Fetching from: ${upstreamUrl}`);
            console.log(`[SkinServer] =======================================`);

            https.get(upstreamUrl, (upstreamRes) => {
                console.log(`[SkinServer] Supabase response status: ${upstreamRes.statusCode}`);

                if (upstreamRes.statusCode === 200) {
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                    upstreamRes.pipe(res);
                    console.log(`[SkinServer] ✓ Skin served successfully: ${filename}`);
                } else {
                    console.log(`[SkinServer] ✗ Skin not found on Supabase!`);
                    console.log(`[SkinServer] ✗ Please upload your skin via the Profile page`);
                    console.log(`[SkinServer] ✗ URL checked: ${upstreamUrl}`);
                    res.status(404).send('Skin not found');
                }
            }).on('error', (err) => {
                console.error(`[SkinServer] ✗ Proxy error:`, err);
                res.status(500).send('Proxy error');
            });
        });

        // Cape Proxy Endpoint
        this.app_express.get('/capes/:filename', (req: Request, res: Response) => {
            const { filename } = req.params;
            const SUPABASE_PROJECT = 'tjtutxeqkbkjfawdyazc';
            const upstreamUrl = `https://${SUPABASE_PROJECT}.supabase.co/storage/v1/object/public/capes/${filename}`;

            console.log(`[SkinServer] Proxying cape: ${filename} from ${upstreamUrl}`);

            https.get(upstreamUrl, (upstreamRes) => {
                if (upstreamRes.statusCode === 200) {
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                    upstreamRes.pipe(res);
                    console.log(`[SkinServer] ✓ Cape served successfully: ${filename}`);
                } else {
                    // Silent fail for capes (most users don't have capes)
                    res.status(404).send('Cape not found');
                }
            }).on('error', (err) => {
                console.error(`[SkinServer] ✗ Cape Proxy error:`, err);
                res.status(500).send('Proxy error');
            });
        });

        // Auth Stub
        this.app_express.post('/authserver/authenticate', (req: Request, res: Response) => {
            const { username } = req.body;
            const token = uuidv4();
            const id = uuidv4().replace(/-/g, ''); // 32-char UUID

            // Generate texture properties for this user
            const properties = this.getTextureProperties(id, username);

            res.json({
                accessToken: token,
                clientToken: req.body.clientToken || uuidv4(),
                selectedProfile: { id, name: username, properties },
                availableProfiles: [{ id, name: username, properties }]
            });
        });

        this.app_express.post('/authserver/validate', (req: Request, res: Response) => res.status(204).send());
        this.app_express.post('/authserver/invalidate', (req: Request, res: Response) => res.status(204).send());
        this.app_express.post('/authserver/signout', (req: Request, res: Response) => res.status(204).send());

        this.app_express.post('/authserver/refresh', (req: Request, res: Response) => {
            const selectedProfile = req.body.selectedProfile;
            if (selectedProfile) {
                // enhance profile with properties if missing or just overwrite to be sure
                selectedProfile.properties = this.getTextureProperties(selectedProfile.id, selectedProfile.name);
            }

            res.json({
                accessToken: req.body.accessToken,
                clientToken: req.body.clientToken,
                selectedProfile: selectedProfile
            });
        });

        // MinecraftServices Profile Endpoint - This is what modern Minecraft uses to get the player's own skin
        // Redirected from api.minecraftservices.com/minecraft/profile
        this.app_express.get('/minecraftservices/minecraft/profile', (req: Request, res: Response) => {
            const currentUser = SkinServerManager.getCurrentUser();
            console.log(`[SkinServer] =======================================`);
            console.log(`[SkinServer] MinecraftServices profile request`);
            console.log(`[SkinServer] Current user: ${currentUser?.name || 'NONE - THIS IS THE PROBLEM!'}`);
            console.log(`[SkinServer] =======================================`);

            if (!currentUser) {
                console.log('[SkinServer] ✗ No current user set, returning 404');
                res.status(404).json({ error: "NOT_FOUND", errorMessage: "Not Found" });
                return;
            }

            let uuid = currentUser.uuid;
            // Ensure UUID has dashes
            if (uuid.length === 32) {
                uuid = uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
            }
            // Remove dashes for profileId
            const profileId = uuid.replace(/-/g, '');

            const skinUrl = `http://localhost:${this.port}/skins/${uuid}.png`;
            const capeUrl = `http://localhost:${this.port}/capes/${uuid}.png`;

            console.log(`[SkinServer] ✓ Returning MinecraftServices profile for ${currentUser.name}`);
            console.log(`[SkinServer] - Skin URL: ${skinUrl}`);
            console.log(`[SkinServer] - Cape URL: ${capeUrl}`);

            // Return profile in MinecraftServices format
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
    }

    public start() {
        this.server = this.app_express.listen(this.port, '127.0.0.1', () => {
            console.log(`[SkinServer] Running on http://127.0.0.1:${this.port}`);
        });
    }
}
