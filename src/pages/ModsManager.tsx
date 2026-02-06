import React, { useState, useEffect } from 'react';
import styles from './ModsManager.module.css';
import { Instance, InstanceApi } from '../api/instances';
import { Search, Cuboid, ChevronRight, Package, Box } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { InstanceMods } from './InstanceMods';
import { Skeleton } from '../components/Skeleton';

interface ModsManagerProps {
    user: any;
}

export const ModsManager: React.FC<ModsManagerProps> = () => {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        loadInstances();
    }, []);

    const loadInstances = async () => {
        setLoading(true);
        try {
            const list = await InstanceApi.list();
            // Filter only moddable instances (exclude generic types if needed, currently allowing all known loaders)
            const moddable = list.filter(i =>
                ['fabric', 'forge', 'neoforge', 'quilt'].includes(i.loader?.toLowerCase())
            );
            setInstances(moddable);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (selectedId) {
        return (
            <InstanceMods
                instanceId={selectedId}
                onBack={() => {
                    setSelectedId(null);
                    loadInstances();
                }}
            />
        );
    }

    const filtered = instances.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const getLoaderColor = (loader: string) => {
        switch (loader.toLowerCase()) {
            case 'fabric': return '#eebda8';
            case 'forge': return '#dfb37c';
            case 'neoforge': return '#ff8c00';
            case 'quilt': return '#b174db';
            default: return '#888';
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.topSection}>
                <PageHeader
                    title="Mods"
                    description="Manage mods for your instances."
                />

                <div className={styles.searchWrapper}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className={styles.searchInput}
                        placeholder="Search instances..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.grid}>
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className={styles.cardSkeleton}>
                            <Skeleton width="100%" height={140} style={{ borderRadius: 20 }} />
                        </div>
                    ))
                ) : filtered.length === 0 ? (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>
                            <Box size={48} strokeWidth={1} />
                        </div>
                        <h3>No Moddable Instances</h3>
                        <p>Create a Fabric, Forge, or Quilt profile to verify mods.</p>
                    </div>
                ) : (
                    filtered.map(inst => (
                        <div key={inst.id} className={styles.card} onClick={() => setSelectedId(inst.id)}>
                            <div className={styles.cardBg} />

                            <div className={styles.cardContent}>
                                <div className={styles.cardHeader}>
                                    <div
                                        className={styles.loaderBadge}
                                        style={{
                                            backgroundColor: `${getLoaderColor(inst.loader)}20`,
                                            color: getLoaderColor(inst.loader),
                                            borderColor: `${getLoaderColor(inst.loader)}40`
                                        }}
                                    >
                                        <Cuboid size={12} strokeWidth={2.5} />
                                        {inst.loader}
                                    </div>
                                    <span className={styles.version}>{inst.version}</span>
                                </div>

                                <div className={styles.instanceInfo}>
                                    <h3 className={styles.instanceName}>{inst.name}</h3>
                                    <div className={styles.actionRow}>
                                        <span className={styles.manageLabel}>
                                            <Package size={14} /> Manage Mods
                                        </span>
                                        <div className={styles.arrowBtn}>
                                            <ChevronRight size={16} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
