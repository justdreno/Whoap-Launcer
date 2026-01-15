import axios from 'axios';

export interface ModrinthProject {
    id: string;
    slug: string;
    title: string;
    description: string;
    icon_url?: string;
    gallery?: string[]; // Array of image URLs
    client_side: string;
    server_side: string;
    downloads: number;
    categories: string[];
}

export interface ModrinthVersion {
    id: string;
    name: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
    files: {
        url: string;
        filename: string;
        primary: boolean;
        hashes: {
            sha1: string;
            sha512: string;
        };
    }[];
}

const API_BASE = 'https://api.modrinth.com/v2';

export class ModrinthApi {
    /**
     * Search for projects (mods or modpacks)
     */
    static async searchProjects(query: string, type: 'mod' | 'modpack' | 'resourcepack' | 'shader', limit = 20, index = 'relevance'): Promise<ModrinthProject[]> {
        try {
            const facets = [
                [`project_type:${type}`]
            ];

            const params: any = {
                query,
                limit,
                index,
                facets: JSON.stringify(facets)
            };

            const response = await axios.get(`${API_BASE}/search`, { params });

            return response.data.hits.map((hit: any) => ({
                id: hit.project_id,
                slug: hit.slug,
                title: hit.title,
                description: hit.description,
                icon_url: hit.icon_url,
                client_side: hit.client_side,
                server_side: hit.server_side,
                downloads: hit.downloads,
                categories: hit.categories
            }));
        } catch (error) {
            console.error('[ModrinthApi] Search failed:', error);
            throw error;
        }
    }

    /**
     * Search for modpacks on Modrinth
     * @deprecated Use searchProjects instead
     */
    static async searchModpacks(query: string, limit = 20): Promise<ModrinthProject[]> {
        return this.searchProjects(query, 'modpack', limit);
    }

    /**
     * Get versions for a specific project
     */
    static async getProjectVersions(projectIdOrSlug: string, loaders?: string[], gameVersions?: string[]): Promise<ModrinthVersion[]> {
        try {
            const params: any = {};
            if (loaders) params.loaders = JSON.stringify(loaders);
            if (gameVersions) params.game_versions = JSON.stringify(gameVersions);

            const response = await axios.get(`${API_BASE}/project/${projectIdOrSlug}/version`, { params });

            return response.data.map((ver: any) => ({
                id: ver.id,
                name: ver.name,
                version_number: ver.version_number,
                game_versions: ver.game_versions,
                loaders: ver.loaders,
                files: ver.files
            }));
        } catch (error) {
            console.error('[ModrinthApi] Search failed:', error);
            throw error;
        }
    }
}
