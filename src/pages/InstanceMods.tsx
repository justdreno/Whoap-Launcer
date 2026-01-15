import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import styles from './InstanceMods.module.css';
import { ChevronLeft, Search, Download, Trash2, WifiOff, Lock, Plus } from 'lucide-react';
import { Skeleton } from '../components/Skeleton';
import { ModVersionSelector } from '../components/ModVersionSelector';

interface InstanceModsProps {
    instanceId: string;
    isOnline?: boolean;
    onBack: () => void;
}

interface InstalledItem {
    name: string;
    path: string;
    size: number;
    isEnabled: boolean;
}

interface SearchItem {
    id: string;
    title: string;
    description: string;
    icon_url?: string;
    downloads: number;
}

type ContentType = 'mods' | 'resourcepacks' | 'shaderpacks';
type TabType = 'installed' | 'browse';

export const InstanceMods: React.FC<InstanceModsProps> = ({ instanceId, isOnline = true, onBack }) => {
    const [contentType, setContentType] = useState<ContentType>('mods');
    const [activeTab, setActiveTab] = useState<TabType>('installed');
    const [installedItems, setInstalledItems] = useState<InstalledItem[]>([]);
    const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [installedSearchQuery, setInstalledSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [versionSelectorMod, setVersionSelectorMod] = useState<SearchItem | null>(null);

    const { showToast, removeToast } = useToast();
    const confirm = useConfirm();
    const [instanceMeta, setInstanceMeta] = useState<{ version: string, loader: string } | null>(null);
    const [warningToastId, setWarningToastId] = useState<string | null>(null);

    // Get content configuration
    const getConfig = () => {
        const configs = {
            mods: {
                title: 'Mods',
                searchType: 'mod',
                fileExtension: '.jar',
                searchPlaceholder: 'Search for mods (e.g. JEI, Sodium)...',
                addLabel: 'Add Mods',
                ipcPrefix: 'mods',
                fileFilter: { name: 'Mods', extensions: ['jar'] },
                progressEvent: 'mods:install-progress'
            },
            resourcepacks: {
                title: 'Resource Packs',
                searchType: 'resourcepack',
                fileExtension: '.zip',
                searchPlaceholder: 'Search for resource packs...',
                addLabel: 'Add Resource Packs',
                ipcPrefix: 'resourcepacks',
                fileFilter: { name: 'Resource Packs', extensions: ['zip'] },
                progressEvent: 'resourcepacks:install-progress'
            },
            shaderpacks: {
                title: 'Shader Packs',
                searchType: 'shader',
                fileExtension: '.zip',
                searchPlaceholder: 'Search for shaderpacks...',
                addLabel: 'Add Shaderpacks',
                ipcPrefix: 'shaderpacks',
                fileFilter: { name: 'Shader Packs', extensions: ['zip'] },
                progressEvent: 'shaderpacks:install-progress'
            }
        };
        return configs[contentType];
    };

    const config = getConfig();

    // Initial Load
    useEffect(() => {
        loadInstanceDetails();
    }, [instanceId]);

    useEffect(() => {
        if (activeTab === 'installed') {
            loadInstalledItems();
        }
    }, [activeTab, contentType, instanceId]);

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Trigger search on debounced query change
    useEffect(() => {
        if (activeTab === 'browse') {
            if (debouncedQuery.trim()) {
                handleSearch(debouncedQuery);
            } else {
                loadFeaturedContent();
            }
        }
    }, [debouncedQuery, activeTab, contentType]);

    // Listen for download progress
    useEffect(() => {
        const handleProgress = (_: any, data: any) => {
            if (data.status === 'downloading') {
                setDownloadProgress(data.progress);
            }
        };
        window.ipcRenderer.on(config.progressEvent, handleProgress);
        return () => {
            window.ipcRenderer.off(config.progressEvent, handleProgress);
        };
    }, [config.progressEvent]);

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
                    else loader = 'fabric';
                }
                setInstanceMeta({ version: inst.version, loader: loader });
            }
        } catch (e) {
            console.error("Failed to load instance meta", e);
        }
    };

    const loadInstalledItems = async () => {
        setLoading(true);
        try {
            const list = await window.ipcRenderer.invoke(`${config.ipcPrefix}:list`, instanceId);
            setInstalledItems(list);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const loadFeaturedContent = async () => {
        setLoading(true);
        try {
            // Curated list of "Famous" mods/packs
            const featuredQueries = {
                mods: 'jei sodium iris appleSkin clumps modmenu',
                resourcepacks: 'patrix stay-true faithful bare-bones',
                shaderpacks: 'complementary-reimagined bsl seus'
            };
            const query = featuredQueries[contentType];
            const result = await window.ipcRenderer.invoke(`${config.ipcPrefix}:search-new`, query);
            if (result.success) {
                setSearchItems(result.results);
            }
        } catch (e) {
            console.error("Failed to load featured content", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async (query: string) => {
        if (!query.trim()) {
            loadFeaturedContent();
            return;
        }
        setLoading(true);
        try {
            const result = await window.ipcRenderer.invoke(`${config.ipcPrefix}:search-new`, query);
            if (result.success) {
                setSearchItems(result.results);
            } else {
                setSearchItems([]);
            }
        } catch (e) {
            console.error(e);
            setSearchItems([]);
        } finally {
            setLoading(false);
        }
    };

    const handleInstallClick = async (item: SearchItem) => {
        if (!instanceMeta) {
            showToast("Instance metadata not loaded.", "error");
            return;
        }

        // Don't set global loading here to avoid "refresh" feel (skeleton overlay)
        setInstallingId(item.id);
        try {
            // Upgrade: Try smart fetch first
            const result = await window.ipcRenderer.invoke('mods:get-smart-version', item.id, instanceMeta.version, instanceMeta.loader);

            if (result.success && result.isValid && !result.warning) {
                // Auto-select and install if no issues
                await handleVersionInstall(result.version, result.file, item);
            } else {
                // Show warning if version detect failed or snapshot detected
                if (result.warning) {
                    const id = showToast(result.warning, "warning", { persistent: true });
                    setWarningToastId(id);
                }
                // Fallback to manual selection
                setVersionSelectorMod(item);
            }
        } catch (e) {
            console.error("[InstanceMods] Smart install failed:", e);
            setVersionSelectorMod(item); // Fallback
        } finally {
            setInstallingId(null);
        }
    };

    const handleVersionInstall = async (version: any, file: any, overrideItem?: SearchItem) => {
        const item = overrideItem || versionSelectorMod;
        if (!item) return;

        // Confirmation (Already part of the existing logic, keeping it for safety)
        const shouldInstall = await confirm(
            `Install ${config.title.slice(0, -1)}?`,
            `Do you want to install ${item.title} (${file.filename})?`,
            { confirmLabel: 'Install', isDanger: false }
        );

        if (!shouldInstall) return;

        if (warningToastId) {
            removeToast(warningToastId);
            setWarningToastId(null);
        }

        setVersionSelectorMod(null);
        setInstallingId(item.id);
        setDownloadProgress(0);

        try {
            await window.ipcRenderer.invoke(`${config.ipcPrefix}:install-new`, instanceId, version.id, file.filename, file.url);
            showToast(`Successfully installed ${item.title}`, "success");
            loadInstalledItems();
        } catch (e) {
            console.error(e);
            showToast("Installation failed.", "error");
        } finally {
            setInstallingId(null);
            setDownloadProgress(0);
        }
    };

    const handleAddItems = async () => {
        setLoading(true);
        try {
            const result = await window.ipcRenderer.invoke(`${config.ipcPrefix}:add`, instanceId);
            if (result.success) {
                showToast(`${config.title} added successfully.`, "success");
                loadInstalledItems();
            } else if (result.error) {
                showToast(`Failed to add ${config.title.toLowerCase()}: ${result.error}`, "error");
            }
        } catch (e) {
            console.error(e);
            showToast(`Failed to add ${config.title.toLowerCase()}.`, "error");
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (item: InstalledItem) => {
        setInstalledItems(prev => prev.map(m =>
            m.name === item.name ? { ...m, isEnabled: !m.isEnabled } : m
        ));

        try {
            await window.ipcRenderer.invoke(`${config.ipcPrefix}:toggle`, instanceId, item.name);
        } catch (e) {
            console.error(`Failed to toggle ${contentType}`, e);
            setInstalledItems(prev => prev.map(m =>
                m.name === item.name ? { ...m, isEnabled: !m.isEnabled } : m
            ));
            showToast(`Failed to toggle ${contentType}`, "error");
        }
    };

    const handleDelete = async (item: InstalledItem) => {
        const shouldDelete = await confirm(
            `Delete ${config.title.slice(0, -1)}?`,
            `Delete ${item.name}?`,
            { confirmLabel: 'Delete', isDanger: true }
        );
        if (shouldDelete) {
            setInstalledItems(prev => prev.filter(m => m.name !== item.name));
            try {
                await window.ipcRenderer.invoke(`${config.ipcPrefix}:delete`, instanceId, item.name);
                showToast(`Deleted ${item.name}`, "success");
            } catch (e) {
                console.error(e);
                showToast(`Failed to delete ${contentType}`, "error");
                loadInstalledItems();
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
                    <h1 className={styles.pageTitle}>Manage Content</h1>
                    {instanceMeta && (
                        <div className={styles.instanceBadge}>
                            <span>Minecraft {instanceMeta.version}</span>
                            <div className={styles.loaderTag}>{instanceMeta.loader}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Content Type Tabs */}
            <div className={styles.contentTypeTabs}>
                <button
                    className={`${styles.contentTypeBtn} ${contentType === 'mods' ? styles.active : ''}`}
                    onClick={() => {
                        setContentType('mods');
                        setSearchQuery('');
                        setSearchItems([]);
                    }}
                >
                    Mods
                </button>
                <button
                    className={`${styles.contentTypeBtn} ${contentType === 'resourcepacks' ? styles.active : ''}`}
                    onClick={() => {
                        setContentType('resourcepacks');
                        setSearchQuery('');
                        setSearchItems([]);
                    }}
                >
                    Resource Packs
                </button>
                <button
                    className={`${styles.contentTypeBtn} ${contentType === 'shaderpacks' ? styles.active : ''}`}
                    onClick={() => {
                        setContentType('shaderpacks');
                        setSearchQuery('');
                        setSearchItems([]);
                    }}
                >
                    Shaderpacks
                </button>
            </div>

            {/* Browse/Installed Tabs */}
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
                        placeholder={config.searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            {activeTab === 'installed' && (
                <div className={styles.searchArea}>
                    <input
                        className={styles.searchInput}
                        placeholder={`Filter installed ${config.title.toLowerCase()}...`}
                        value={installedSearchQuery}
                        onChange={(e) => setInstalledSearchQuery(e.target.value)}
                    />
                    <button className={styles.addModBtn} onClick={handleAddItems} title={config.addLabel}>
                        <Plus size={20} />
                        <span>{config.addLabel}</span>
                    </button>
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
                        {installedItems.length === 0 && <div style={{ color: '#888', padding: 20 }}>No {config.title.toLowerCase()} installed.</div>}
                        {installedItems.filter(m => m.name.toLowerCase().includes(installedSearchQuery.toLowerCase())).map(item => (
                            <div key={item.name} className={styles.modItem}>
                                <div style={{ flex: 1 }}>
                                    <div className={styles.modName} style={{ opacity: item.isEnabled ? 1 : 0.5 }}>
                                        {item.name.replace('.disabled', '')}
                                    </div>
                                    <div className={styles.modMeta}>{item.isEnabled ? 'Enabled' : 'Disabled'} • {(item.size / 1024).toFixed(1)} KB</div>
                                </div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <button
                                        className={styles.actionBtn}
                                        onClick={() => handleToggle(item)}
                                        title={item.isEnabled ? "Disable" : "Enable"}
                                        style={{ color: item.isEnabled ? '#4CAF50' : '#888', background: item.isEnabled ? 'rgba(76, 175, 80, 0.1)' : undefined }}
                                    >
                                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
                                    </button>
                                    <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={() => handleDelete(item)} title="Delete">
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
                        {!loading && searchItems.length > 0 && (
                            <div className={styles.listHeader}>
                                {searchQuery ? `Search Results for "${searchQuery}"` : `Featured ${config.title}`}
                            </div>
                        )}
                        {searchItems.length === 0 && !loading && !searchQuery ? (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: 300,
                                color: '#666'
                            }}>
                                <Search size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
                                <h3 style={{ marginTop: 0 }}>Search {config.title}</h3>
                                <p>Enter a keyword to search Modrinth.</p>
                            </div>
                        ) : searchItems.length === 0 && !loading && debouncedQuery && searchQuery === debouncedQuery ? (
                            <div style={{ padding: 20, color: '#666' }}>No results found for "{searchQuery}".</div>
                        ) : (
                            searchItems.map(item => (
                                <div key={item.id} className={styles.modItem}>
                                    <img src={item.icon_url || 'https://placehold.co/48'} style={{ width: 48, height: 48, borderRadius: 8 }} alt={item.title} />
                                    <div style={{ flex: 1 }}>
                                        <div className={styles.modName}>{item.title}</div>
                                        <div className={styles.modMeta}>{item.description}</div>
                                        <div className={styles.modMeta}>
                                            <Download size={12} style={{ marginRight: 4 }} />
                                            {item.downloads} downloads
                                        </div>
                                    </div>
                                    <button
                                        className={styles.installBtn}
                                        onClick={() => handleInstallClick(item)}
                                        disabled={installingId === item.id}
                                    >
                                        {installingId === item.id ? `Installing ${downloadProgress}%` : 'Install'}
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
                    onClose={() => {
                        setVersionSelectorMod(null);
                        if (warningToastId) {
                            removeToast(warningToastId);
                            setWarningToastId(null);
                        }
                    }}
                    onInstall={handleVersionInstall}
                />
            )}
        </div>
    );
};
