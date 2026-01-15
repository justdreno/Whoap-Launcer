import React, { useState, useEffect } from 'react';
import styles from './ModpackBrowser.module.css';
import { Search, Download } from 'lucide-react';
import { Skeleton } from '../components/Skeleton';
import { PageHeader } from '../components/PageHeader';
import { ModpackInstallModal } from '../components/ModpackInstallModal';

interface Modpack {
    id: string;
    title: string;
    description: string;
    imageUrl: string;
    downloads: number;
    platform: 'modrinth' | 'curseforge';
    versions: string[];
}

export const ModpackBrowser: React.FC = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [packs, setPacks] = useState<Modpack[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedPack, setSelectedPack] = useState<Modpack | null>(null);

    useEffect(() => {
        loadPopularPacks();
    }, []);

    const loadPopularPacks = async () => {
        setLoading(true);
        try {
            const result = await window.ipcRenderer.invoke('modpack:search', '', 'modrinth', 'downloads');
            if (result.success) {
                setPacks(result.results.map((p: any) => ({
                    id: p.id,
                    title: p.title,
                    description: p.description,
                    imageUrl: p.icon_url || 'https://placehold.co/100x100?text=No+Icon',
                    downloads: p.downloads,
                    platform: 'modrinth',
                    versions: []
                })));
            }
        } catch (e) {
            console.error("Failed to load popular packs", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            loadPopularPacks();
            return;
        }
        setLoading(true);
        try {
            const result = await window.ipcRenderer.invoke('modpack:search', searchQuery, 'modrinth', 'relevance');
            if (result.success) {
                setPacks(result.results.map((p: any) => ({
                    id: p.id,
                    title: p.title,
                    description: p.description,
                    imageUrl: p.icon_url || 'https://placehold.co/100x100?text=No+Icon',
                    downloads: p.downloads,
                    platform: 'modrinth',
                    versions: []
                })));
            } else {
                setPacks([]);
            }
        } catch (error) {
            console.error("Search failed", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <PageHeader
                title="Modpacks"
                description="Discover and install new modpacks from the community."
            />

            <div className={styles.header}>
                <form className={styles.searchBar} onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
                    <Search className={styles.searchIcon} size={20} onClick={handleSearch} style={{ cursor: 'pointer' }} />
                    <input
                        type="text"
                        placeholder="Search modpacks..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <button type="submit" className={styles.searchBtn}>Search</button>
                </form>
            </div>

            <div className={styles.grid}>
                {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className={styles.packCard}>
                            <div className={styles.packImage}><Skeleton width="100%" height="100%" /></div>
                            <div className={styles.packInfo}>
                                <Skeleton width="80%" height={20} style={{ marginBottom: 8 }} />
                                <Skeleton width="100%" height={14} style={{ marginBottom: 4 }} />
                                <Skeleton width="60%" height={14} />
                            </div>
                        </div>
                    ))
                ) : (
                    packs.map(pack => (
                        <div key={pack.id} className={styles.packCard} onClick={() => setSelectedPack(pack)}>
                            <div className={styles.packImage}>
                                <img src={pack.imageUrl} alt={pack.title} />
                                <div className={styles.packOverlay}>
                                    <button className={styles.installBtn}><Download size={20} /></button>
                                </div>
                            </div>
                            <div className={styles.packInfo}>
                                <h3 className={styles.packTitle}>{pack.title}</h3>
                                <p className={styles.packDesc}>{pack.description}</p>
                                <div className={styles.packMeta}>
                                    <span className={styles.downloads}>
                                        <Download size={14} />
                                        {pack.downloads.toLocaleString()}
                                    </span>
                                    <button className={styles.installBtnSmall} onClick={(e) => { e.stopPropagation(); setSelectedPack(pack); }}>
                                        <Download size={14} /> Install
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {selectedPack && (
                <ModpackInstallModal
                    modpack={selectedPack}
                    onClose={() => setSelectedPack(null)}
                    onInstallStarted={() => { }}
                />
            )}
        </div>
    );
};
