import { supabase } from '../lib/supabase';

export interface NewsItem {
    id: string;
    title: string;
    content: string;
    image_url: string;
    color?: string;
    link_url?: string;
    date: string;
}

export interface ChangelogItem {
    id: string;
    version: string;
    description: string;
    type: 'release' | 'beta' | 'hotfix';
    date: string;
}

export const ContentManager = {
    fetchNews: async (): Promise<NewsItem[]> => {
        const { data, error } = await supabase
            .from('news')
            .select('*')
            //.eq('published', true) // Show all for now, or use published
            .or(`published.eq.true,published.is.null`) // Handle legacy/missing
            .order('created_at', { ascending: false })
            .limit(10); // Increased limit

        if (error) {
            console.error("News Fetch Error:", error);
            return [];
        }

        return data.map((row: any) => ({
            id: row.id,
            title: row.title,
            content: row.content,
            image_url: row.image_url,
            color: row.color, // Map new color field
            link_url: row.link_url,
            date: row.created_at
        }));
    },

    fetchChangelogs: async (): Promise<ChangelogItem[]> => {
        const { data, error } = await supabase
            .from('changelogs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error("Changelog Fetch Error:", error);
            return [];
        }

        return data.map((row: any) => ({
            id: row.id,
            version: row.version,
            description: row.description,
            type: row.type,
            date: row.created_at
        }));
    },

    createChangelog: async (changelog: Omit<ChangelogItem, 'id' | 'date'>): Promise<ChangelogItem | null> => {
        const { data, error } = await supabase
            .from('changelogs')
            .insert({
                version: changelog.version,
                description: changelog.description,
                type: changelog.type
            })
            .select()
            .single();

        if (error) {
            console.error("Changelog Creation Error:", error);
            return null;
        }

        return {
            id: data.id,
            version: data.version,
            description: data.description,
            type: data.type,
            date: data.created_at
        };
    },

    deleteChangelog: async (id: string): Promise<boolean> => {
        const { error } = await supabase
            .from('changelogs')
            .delete()
            .eq('id', id);

        if (error) {
            console.error("Changelog Deletion Error:", error);
            return false;
        }

        return true;
    }
};
