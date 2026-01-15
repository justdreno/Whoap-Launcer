import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import styles from './InstanceMods.module.css';
import { ChevronLeft, Search, Download, Trash2, WifiOff, Lock } from 'lucide-react';
import { Skeleton } from '../components/Skeleton';
import { ModVersionSelector } from '../components/ModVersionSelector';

interface InstanceModsProps {
    instanceId: string;
    isOnline?: boolean;
    onBack: () => void;
}

interface InstalledMod {
    name: string;
    path: string;
    size: number;
    isEnabled: boolean;
}

interface SearchMod {
    id: string;
    title: string;
    description: string;
    icon_url?: string;
    downloads: number;
}

export const InstanceMods: React.FC<InstanceModsProps> = ({ instanceId, isOnline = true, onBack }) => {
    const [activeTab, setActiveTab] = useState<'installed' | 'browse'>('installed');
    const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
    const [searchMods, setSearchMods] = useState<SearchMod[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [installedSearchQuery, setInstalledSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [versionSelectorMod, setVersionSelectorMod] = useState<SearchMod | null>(null);

    const { showToast } = useToast();
    const confirm = useConfirm();
    // Instance metadata for filtering
    const [instanceMeta, setInstanceMeta] = useState<{ version: string, loader: string } | null>(null);

    // Initial Load
    useEffect(() => {
        loadInstanceDetails();
        if (activeTab === 'installed') {
            loadInstalledMods();
        }
    }, [activeTab, instanceId]);

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Trigger search on debounced query change
    useEffect(() => {
        if (activeTab === 'browse' && debouncedQuery.trim()) {
            handleSearch(debouncedQuery);
        }
    }, [debouncedQuery, activeTab]);

    // Listen for download progress
    useEffect(() => {
        const handleProgress = (_: any, data: any) => {
            if (data.status === 'downloading') {
                setDownloadProgress(data.progress);
            }
        };
        window.ipcRenderer.on('mods:install-progress', handleProgress);
        return () => {
            window.ipcRenderer.off('mods:install-progress', handleProgress);
        };
    }, []);

    const loadInstanceDetails = async () => {
        try {
            const { InstanceApi } = await import('../api/instances');
            const list = await InstanceApi.list();
            const inst = list.find(i => i.id === instanceId);
            if (inst) {
                let loader: string = inst.loader;
                if (loader === 'vanilla' || !loader) {
                    const v = inst.version.toLowerCase();
                    if (v.includes('neoforge')) loader = 'neoforge';
                    else if (v.includes('forge')) loader = 'forge';
                    else if (v.includes('quilt')) loader = 'quilt';
                    else if (v.includes('fabric')) loader = 'fabric';
                    else loader = 'fabric'; // Default fallback
                }
                setInstanceMeta({ version: inst.version, loader: loader });
            }
        } catch (e) {
            console.error("Failed to load instance meta", e);
        }
    };

    const loadInstalledMods = async () => {
        setLoading(true);
        try {
            const list = await window.ipcRenderer.invoke('mods:list', instanceId);
            setInstalledMods(list);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async (query: string) => {
        if (!query.trim()) return;
        setLoading(true);
        try {
            const result = await window.ipcRenderer.invoke('mods:search-new', query);
            if (result.success) {
                setSearchMods(result.results);
            } else {
                setSearchMods([]);
            }
        } catch (e) {
            console.error(e);
            setSearchMods([]);
        } finally {
            setLoading(false);
        }
    };

    const handleInstallClick = (mod: SearchMod) => {
        if (!instanceMeta) {
            showToast("Instance metadata not loaded.", "error");
            return;
        }
        setVersionSelectorMod(mod);
    };

    const handleVersionInstall = async (version: any, file: any) => {
        const mod = versionSelectorMod;
        if (!mod) return;

        setVersionSelectorMod(null);
        setInstallingId(mod.id);
        setDownloadProgress(0);

        try {
            await window.ipcRenderer.invoke('mods:install-new', instanceId, version.id, file.filename, file.url);
            showToast(`Successfully installed ${mod.title}`, "success");
            loadInstalledMods();
        } catch (e) {
            console.error(e);
            showToast("Installation failed.", "error");
        } finally {
            setInstallingId(null);
            setDownloadProgress(0);
        }
    };

    const handleToggle = async (mod: InstalledMod) => {
        setInstalledMods(prev => prev.map(m =>
            m.name === mod.name ? { ...m, isEnabled: !m.isEnabled } : m
        ));

        try {
            await window.ipcRenderer.invoke('mods:toggle', instanceId, mod.name);
        } catch (e) {
            console.error("Failed to toggle mod", e);
            setInstalledMods(prev => prev.map(m =>
                m.name === mod.name ? { ...m, isEnabled: !m.isEnabled } : m
            ));
            showToast("Failed to toggle mod", "error");
        }
    };

    const handleDelete = async (mod: InstalledMod) => {
        const shouldDelete = await confirm('Delete Mod?', `Delete ${mod.name}?`, { confirmLabel: 'Delete', isDanger: true });
        if (shouldDelete) {
            setInstalledMods(prev => prev.filter(m => m.name !== mod.name));
            try {
                await window.ipcRenderer.invoke('mods:delete', instanceId, mod.name);
                showToast(`Deleted ${mod.name}`, "success");
            } catch (e) {
                console.error(e);
                showToast("Failed to delete mod", "error");
                loadInstalledMods();
            }
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <button className={styles.backBtn} onClick={onBack} title="Back">
                    <ChevronLeft size={24} />
                </button>
                <div className={styles.titleArea}>
                    <h1 className={styles.pageTitle}>Manage Mods</h1>
                    {instanceMeta && (
                        <div className={styles.instanceBadge}>
                            <span>Minecraft {instanceMeta.version}</span>
                            <div className={styles.loaderTag}>{instanceMeta.loader}</div>
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.tabs}>
                <button
                    className={`${styles.tabBtn} ${activeTab === 'installed' ? styles.active : ''}`}
                    onClick={() => setActiveTab('installed')}
                >
                    Installed
                </button>
                <button
                    className={`${styles.tabBtn} ${activeTab === 'browse' ? styles.active : ''}`}
                    onClick={() => setActiveTab('browse')}
                >
                    Browse Modrinth
                </button>
            </div>

            {activeTab === 'browse' && (
                <div className={styles.searchArea}>
                    <input
                        className={styles.searchInput}
                        placeholder="Search for mods (e.g. JEI, Sodium)..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            {activeTab === 'installed' && (
                <div className={styles.searchArea}>
                    <input
                        className={styles.searchInput}
                        placeholder="Filter installed mods..."
                        value={installedSearchQuery}
                        onChange={(e) => setInstalledSearchQuery(e.target.value)}
                    />
                </div>
            )}

            <div className={styles.content}>
                {loading ? (
                    <div className={styles.loading}>
                        <Skeleton width="100%" height={60} />
                        <div style={{ height: 12 }} />
                        <Skeleton width="100%" height={60} />
                    </div>
                ) : activeTab === 'installed' ? (
                    <div className={styles.modList}>
                        {installedMods.length === 0 && <div style={{ color: '#888', padding: 20 }}>No mods installed.</div>}
                        {installedMods.filter(m => m.name.toLowerCase().includes(installedSearchQuery.toLowerCase())).map(mod => (
                            <div key={mod.name} className={styles.modItem}>
                                <div style={{ flex: 1 }}>
                                    <div className={styles.modName} style={{ opacity: mod.isEnabled ? 1 : 0.5 }}>
                                        {mod.name.replace('.disabled', '')}
                                    </div>
                                    <div className={styles.modMeta}>{mod.isEnabled ? 'Enabled' : 'Disabled'} • {(mod.size / 1024).toFixed(1)} KB</div>
                                </div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <button
                                        className={styles.actionBtn}
                                        onClick={() => handleToggle(mod)}
                                        title={mod.isEnabled ? "Disable" : "Enable"}
                                        style={{ color: mod.isEnabled ? '#4CAF50' : '#888', background: mod.isEnabled ? 'rgba(76, 175, 80, 0.1)' : undefined }}
                                    >
                                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
                                    </button>
                                    <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={() => handleDelete(mod)} title="Delete">
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : !isOnline ? (
                    <div className={styles.offlineLock}>
                        <div className={styles.lockIcon}>
                            <WifiOff size={40} />
                        </div>
                        <h3>Internet Connection Required</h3>
                        <p>Browsing Modrinth requires an active internet connection.</p>
                        <div className={styles.lockBadge}>
                            <Lock size={12} />
                            <span>Feature Locked</span>
                        </div>
                    </div>
                ) : (
                    <div className={styles.modList}>
                        {searchMods.length === 0 && !loading && !searchQuery ? (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: 300,
                                color: '#666'
                            }}>
                                <Search size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
                                <h3 style={{ marginTop: 0 }}>Search Mods</h3>
                                <p>Enter a keyword to search Modrinth.</p>
                            </div>
                        ) : searchMods.length === 0 && !loading && debouncedQuery && searchQuery === debouncedQuery ? (
                            <div style={{ padding: 20, color: '#666' }}>No results found for "{searchQuery}".</div>
                        ) : (
                            searchMods.map(mod => (
                                <div key={mod.id} className={styles.modItem}>
                                    <img src={mod.icon_url || 'https://placehold.co/48'} style={{ width: 48, height: 48, borderRadius: 8 }} alt={mod.title} />
                                    <div style={{ flex: 1 }}>
                                        <div className={styles.modName}>{mod.title}</div>
                                        <div className={styles.modMeta}>{mod.description}</div>
                                        <div className={styles.modMeta}>
                                            <Download size={12} style={{ marginRight: 4 }} />
                                            {mod.downloads} downloads
                                        </div>
                                    </div>
                                    <button
                                        className={styles.installBtn}
                                        onClick={() => handleInstallClick(mod)}
                                        disabled={installingId === mod.id}
                                    >
                                        {installingId === mod.id ? `Installing ${downloadProgress}%` : 'Install'}
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {versionSelectorMod && instanceMeta && (
                <ModVersionSelector
                    mod={versionSelectorMod}
                    instanceMeta={instanceMeta}
                    onClose={() => setVersionSelectorMod(null)}
                    onInstall={handleVersionInstall}
                />
            )}
        </div>
    );
};
