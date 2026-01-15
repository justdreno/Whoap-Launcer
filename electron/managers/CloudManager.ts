import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Instance } from './InstanceManager';
import { ipcMain } from 'electron';

// Reusing credentials from src/lib/supabase.ts
// Ideally these should be in .env but for MVP consistency we match existing codebase
const SUPABASE_URL = 'https://tjtutxeqkbkjfawdyazc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqdHV0eGVxa2JramZhd2R5YXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyNzQ1MDAsImV4cCI6MjA4Mzg1MDUwMH0.eOEBUe7JcSTs4EqMmiWytq6JERzBQD1eSyuRBrx_9AQ';

export class CloudManager {
    public supabase: SupabaseClient;

    constructor() {
        this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        this.registerListeners();
    }

    static instance: CloudManager;
    static getInstance() {
        if (!CloudManager.instance) CloudManager.instance = new CloudManager();
        return CloudManager.instance;
    }

    private registerListeners() {
        ipcMain.handle('cloud:sync-instance', async (_, instance: Instance, userId: string) => {
            return await this.syncInstance(instance, userId);
        });

        ipcMain.handle('cloud:delete-instance', async (_, instanceName: string, userId: string) => {
            return await this.deleteInstance(instanceName, userId);
        });
    }

    async deleteInstance(instanceName: string, userId: string) {
        console.log(`[Cloud] Deleting instance ${instanceName}...`);
        try {
            // Check if exists first
            const { data: existing } = await this.supabase
                .from('instances')
                .select('id')
                .eq('user_id', userId)
                .eq('name', instanceName)
                .single();

            if (existing) {
                const { error } = await this.supabase
                    .from('instances')
                    .delete()
                    .eq('id', existing.id);

                if (error) throw error;
            }

            return { success: true };
        } catch (error) {
            console.error("[Cloud] Delete failed:", error);
            return { success: false, error: String(error) };
        }
    }

    async syncInstance(instance: Instance, userId: string, accessToken?: string) {
        console.log(`[Cloud] Syncing instance ${instance.name}...`);

        try {
            // RLS requires authenticated user.
            // If we have an accessToken (Supabase JWT), we can set it.
            // Note: 'authData.token' from Minecraft Auth is a Mojang token, NOT Supabase.
            // We need the Supabase session token.
            // LaunchProcess receives 'authData' which currently only has Mojang info.
            // We need to ensure we are passing the WHOAP/Supabase token if logged in.
            // If the user is Offline or Mojang-only, they might NOT have a Supabase token.
            // In that case, we can't sync to "instances" table protected by RLS.
            // We should check if we have a supabase token.

            // 1. Set Session if provided (Scope issue: singleton client)
            // Ideally we create a temporary client for this request context if we want to be safe,
            // or we assume single-user desktop app.

            // Wait, if authData.token is Mojang token, where is Supabase token?
            // Sidebar.tsx -> App.tsx -> User state has 'token'? 
            // When we login with Supabase, we get session.access_token.
            // When we launch, we pass 'authData' which LaunchProcess uses.
            // We need to verify what 'authData' is passed from frontend.
            // In Home.tsx: window.ipcRenderer.invoke('game:launch', ... user)
            // 'user' object in App.tsx: { name, uuid, token, type? }
            // If type is 'supabase', token is supabase token. 
            // If type is 'offline', no token.

            if (!accessToken) {
                console.warn("[Cloud] No access token provided for sync. Skipping.");
                return { success: false, error: "No auth token" };
            }

            // Set the token for this request
            const { error: authError } = await this.supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: '' // Not needed for single request usually if valid
            });

            if (authError) {
                // Fallback: maybe just use global headers if setSession fails without refresh token
                // Or create a client with the token header directly?
                // Let's try attempting the op.
            }

            const { data: existing } = await this.supabase
                .from('instances')
                .select('id')
                .eq('user_id', userId)
                .eq('name', instance.name)
                .single();

            const payload = {
                user_id: userId,
                name: instance.name,
                version: instance.version,
                loader: instance.loader || 'vanilla',
                is_favorite: instance.isFavorite || false,
                updated_at: new Date().toISOString()
            };

            if (existing) {
                const { error } = await this.supabase.from('instances').update(payload).eq('id', existing.id);
                if (error) throw error;
            } else {
                const { error } = await this.supabase.from('instances').insert(payload);
                if (error) throw error;
            }

            return { success: true };
        } catch (error) {
            console.error("[Cloud] Sync failed:", error);
            return { success: false, error: String(error) };
        }
    }
}
