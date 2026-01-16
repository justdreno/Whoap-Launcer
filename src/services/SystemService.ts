import { supabase } from '../lib/supabase';

export interface SystemConfig {
    version: string;
}

export const SystemService = {
    /**
     * Fetches the current application version from the system_config table.
     * Falls back to a default value if fetch fails.
     */
    getAppVersion: async (): Promise<string> => {
        try {
            const { data, error } = await supabase
                .from('system_config')
                .select('value')
                .eq('key', 'app_version')
                .single();

            if (error || !data) {
                console.warn('Failed to fetch version from DB, using fallback', error);
                return '1.0.0'; // Fallback
            }

            return (data.value as SystemConfig).version;
        } catch (err) {
            console.error('Error fetching version:', err);
            return '1.0.0';
        }
    },

    /**
     * Updates the application version in the system_config table.
     * Only works if the current user has admin/developer role.
     */
    updateAppVersion: async (newVersion: string, userId: string): Promise<boolean> => {
        try {
            const { error } = await supabase
                .from('system_config')
                .update({
                    value: { version: newVersion },
                    updated_by: userId,
                    updated_at: new Date().toISOString()
                })
                .eq('key', 'app_version');

            if (error) {
                console.error('Failed to update version:', error);
                return false;
            }

            return true;
        } catch (err) {
            console.error('Error updating version:', err);
            return false;
        }
    }
};
