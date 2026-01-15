import React, { useState, useEffect } from 'react';
import styles from './ModsManager.module.css';
import { Instance, InstanceApi } from '../api/instances';
import { Search, ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { InstanceMods } from './InstanceMods';
import { Skeleton } from '../components/Skeleton';

interface ModsManagerProps {
    user: any;
    isOnline?: boolean;
}

export const ModsManager: React.FC<ModsManagerProps> = ({ isOnline = true }) => {
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
            const moddable = list.filter(i =>
                ['fabric', 'forge', 'neoforge', 'quilt'].includes(i.loader.toLowerCase())
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
                isOnline={isOnline}
                onBack={() => {
                    setSelectedId(null);
                    loadInstances();
                }}
            />
        );
    }

    const filtered = instances.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className={styles.container}>
            <PageHeader
                title="Mods"
                description="Find and manage individual mods for your instances."
            />

            <div className={styles.header}>
                <div className={styles.searchBox}>
                    <Search size={18} color="#666" />
                    <input
                        placeholder="Search profiles..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.grid}>
                {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className={styles.cardSkeleton}>
                            <Skeleton width="100%" height={100} style={{ borderRadius: 16 }} />
                        </div>
                    ))
                ) : filtered.length === 0 ? (
                    <div className={styles.emptyState}>
                        <h3>No Moddable Instances Found</h3>
                        <p>Create a Fabric, Forge, or Quilt profile to manage mods.</p>
                    </div>
                ) : (
                    filtered.map(inst => (
                        <div key={inst.id} className={styles.card} onClick={() => setSelectedId(inst.id)}>
                            <div className={styles.cardHeader}>
                                <div className={styles.loaderBadge} data-loader={inst.loader}>
                                    {inst.loader}
                                </div>
                                <div className={styles.version}>{inst.version}</div>
                            </div>
                            <div className={styles.cardBody}>
                                <div className={styles.instName}>{inst.name}</div>
                                <div className={styles.meta}>Click to manage mods</div>
                            </div>
                            <div className={styles.hoverOverlay}>
                                <span>Manage Mods</span>
                                <ExternalLink size={16} />
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
