import React, { useState, useEffect } from 'react';
import styles from './ModBrowser.module.css';
import { Search, Download, Check, AlertTriangle, Package, CheckCircle, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import ReactMarkdown from 'react-markdown';

interface ModBrowserProps {
    instanceId: string;
    version: string;
    loader: string;
    onClose: () => void;
}

interface Mod {
    project_id: string;
    title: string;
    description: string;
    icon_url?: string;
    author: string;
    downloads: number;
    categories?: string[];
}

interface InstallStatus {
    modName: string;
    status: 'pending' | 'downloading' | 'installed' | 'skipped' | 'failed';
    error?: string;
}

export const ModBrowser: React.FC<ModBrowserProps> = ({ instanceId, version, loader, onClose }) => {
    const [query, setQuery] = useState('');
    const [mods, setMods] = useState<Mod[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMod, setSelectedMod] = useState<Mod | null>(null);
    const [activeVersion, setActiveVersion] = useState<any | null>(null);
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState<string>('');
    const [installedMods, setInstalledMods] = useState<Set<string>>(new Set());
    const [loadingVersion, setLoadingVersion] = useState(false);
    const { showToast } = useToast();

    // Load installed mods
    useEffect(() => {
        loadInstalledMods();
    }, [instanceId]);

    const loadInstalledMods = async () => {
        try {
            const list = await window.ipcRenderer.invoke('mods:list', instanceId);
            // Extract mod names (without .jar extension) as a simple check
            const names = new Set<string>(list.map((m: any) => m.name.replace(/\.jar$|\.disabled$/i, '').toLowerCase()));
            setInstalledMods(names);
        } catch (e) {
            console.error('Failed to load installed mods', e);
        }
    };

    const isModInstalled = (modTitle: string) => {
        // Simple heuristic: check if any installed mod name contains the mod title
        const titleLower = modTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const name of installedMods) {
            const nameLower = name.replace(/[^a-z0-9]/g, '');
            if (nameLower.includes(titleLower) || titleLower.includes(nameLower)) {
                return true;
            }
        }
        return false;
    };

    // Initial load
    useEffect(() => {
        searchMods('');
    }, []);

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            searchMods(query);
        }, 400);
        return () => clearTimeout(timer);
    }, [query]);

    // Cleanup Progress Listener
    useEffect(() => {
        const handleProgress = (_: any, status: InstallStatus) => {
            if (status.status === 'downloading') setProgress(`Downloading ${status.modName}...`);
            else if (status.status === 'installed') setProgress(`Installed ${status.modName}`);
            else if (status.status === 'failed') showToast(`Failed: ${status.modName}`, 'error');
        };
        window.ipcRenderer.on('mods:install-progress', handleProgress);
        return () => window.ipcRenderer.off('mods:install-progress', handleProgress);
    }, []);

    const searchMods = async (q: string) => {
        setLoading(true);
        try {
            const res = await window.ipcRenderer.invoke('mods:search', q, { version, loader });
            setMods(res.hits || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectMod = async (mod: Mod) => {
        setSelectedMod(mod);
        setActiveVersion(null);
        setLoadingVersion(true);
        try {
            const versions = await window.ipcRenderer.invoke('mods:get-versions', mod.project_id, { version, loader });
            if (versions.length > 0) {
                setActiveVersion(versions[0]);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingVersion(false);
        }
    };

    const handleInstall = async () => {
        if (!activeVersion) return;
        setInstalling(true);
        setProgress('Resolving dependencies...');

        try {
            const res = await window.ipcRenderer.invoke('mods:install', instanceId, activeVersion.id);
            if (res.success) {
                showToast(`Installed ${selectedMod?.title} and dependencies!`, 'success');
                setSelectedMod(null);
            } else {
                showToast(res.error || 'Install failed', 'error');
            }
        } catch (e: any) {
            showToast(e.message, 'error');
        } finally {
            setInstalling(false);
            setProgress('');
            loadInstalledMods(); // Refresh installed list
        }
    };

    const formatDownloads = (n: number) => {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
        return n.toString();
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.titleArea}>
                        <h2>Mod Browser</h2>
                        <div className={styles.tags}>
                            <span className={styles.loaderTag}>{loader}</span>
                            <span className={styles.versionTag}>{version}</span>
                        </div>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose}><X size={20} /></button>
                </div>

                <div className={styles.body}>
                    {/* Left Panel - Search & List */}
                    <div className={styles.leftPanel}>
                        <div className={styles.searchWrapper}>
                            <Search size={18} className={styles.searchIcon} />
                            <input
                                className={styles.searchInput}
                                placeholder="Search mods..."
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className={styles.modList}>
                            {loading ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className={styles.skeletonCard}>
                                        <div className={styles.skeletonIcon} />
                                        <div className={styles.skeletonText}>
                                            <div className={styles.skeletonLine} style={{ width: '70%' }} />
                                            <div className={styles.skeletonLine} style={{ width: '40%' }} />
                                        </div>
                                    </div>
                                ))
                            ) : mods.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <Search size={32} strokeWidth={1.5} />
                                    <p>No mods found</p>
                                </div>
                            ) : (
                                mods.map(mod => {
                                    const installed = isModInstalled(mod.title);
                                    return (
                                        <div
                                            key={mod.project_id}
                                            className={`${styles.modCard} ${selectedMod?.project_id === mod.project_id ? styles.selected : ''} ${installed ? styles.installed : ''}`}
                                            onClick={() => handleSelectMod(mod)}
                                        >
                                            <img
                                                src={mod.icon_url || 'https://cdn.modrinth.com/data/AANobbMI/icon.png'}
                                                alt=""
                                                className={styles.modIcon}
                                            />
                                            <div className={styles.modInfo}>
                                                <div className={styles.modName}>{mod.title}</div>
                                                <div className={styles.modAuthor}>by {mod.author}</div>
                                            </div>
                                            {installed ? (
                                                <div className={styles.installedBadge}>
                                                    <CheckCircle size={14} />
                                                    Installed
                                                </div>
                                            ) : (
                                                <div className={styles.modDownloads}>
                                                    <Download size={12} />
                                                    {formatDownloads(mod.downloads)}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Right Panel - Details */}
                    <div className={styles.rightPanel}>
                        {selectedMod ? (
                            <div className={styles.detailView}>
                                {/* Mod Header */}
                                <div className={styles.detailHeader}>
                                    <img
                                        src={selectedMod.icon_url || 'https://cdn.modrinth.com/data/AANobbMI/icon.png'}
                                        className={styles.detailIcon}
                                    />
                                    <div className={styles.detailMeta}>
                                        <h1>{selectedMod.title}</h1>
                                        <div className={styles.stats}>
                                            <span><Download size={14} /> {formatDownloads(selectedMod.downloads)} downloads</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Version Status */}
                                <div className={`${styles.versionStatus} ${loadingVersion ? styles.loadingStatus : (activeVersion ? (isModInstalled(selectedMod.title) ? styles.installedStatus : styles.compatible) : styles.incompatible)}`}>
                                    {loadingVersion ? (
                                        <>
                                            <div className={styles.smallSpinner} />
                                            <span>Checking compatibility...</span>
                                        </>
                                    ) : activeVersion ? (
                                        isModInstalled(selectedMod.title) ? (
                                            <>
                                                <CheckCircle size={16} />
                                                <span>Already installed • Version: <strong>{activeVersion.version_number}</strong></span>
                                            </>
                                        ) : (
                                            <>
                                                <Check size={16} />
                                                <span>Compatible version: <strong>{activeVersion.version_number}</strong></span>
                                            </>
                                        )
                                    ) : (
                                        <>
                                            <AlertTriangle size={16} />
                                            <span>No compatible version for {version} ({loader})</span>
                                        </>
                                    )}
                                </div>

                                {/* Description */}
                                <div className={styles.descSection}>
                                    <h3>Description</h3>
                                    <div className={styles.descContent}>
                                        <ReactMarkdown>{selectedMod.description}</ReactMarkdown>
                                    </div>
                                </div>

                                {/* Dependencies */}
                                {activeVersion && activeVersion.dependencies && activeVersion.dependencies.length > 0 && (
                                    <div className={styles.depsSection}>
                                        <h3><Package size={14} /> Dependencies ({activeVersion.dependencies.length})</h3>
                                        <div className={styles.depsList}>
                                            {activeVersion.dependencies.map((d: any, i: number) => (
                                                <div
                                                    key={i}
                                                    className={`${styles.depItem} ${d.dependency_type === 'required' ? styles.required : styles.optional}`}
                                                >
                                                    <span className={styles.depType}>
                                                        {d.dependency_type === 'required' ? 'Required' : 'Optional'}
                                                    </span>
                                                    <span className={styles.depId}>
                                                        {d.project_id ? `Project: ${d.project_id.substring(0, 8)}...` : 'Unknown'}
                                                    </span>
                                                    <span className={styles.depAuto}>Auto-install</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Install Button */}
                                <div className={styles.installArea}>
                                    {installing ? (
                                        <button className={styles.installBtn} disabled>
                                            <div className={styles.spinner} />
                                            <span>{progress || 'Installing...'}</span>
                                        </button>
                                    ) : isModInstalled(selectedMod.title) ? (
                                        <button className={`${styles.installBtn} ${styles.installedBtn}`} disabled>
                                            <CheckCircle size={18} />
                                            <span>Already Installed</span>
                                        </button>
                                    ) : (
                                        <button
                                            className={styles.installBtn}
                                            onClick={handleInstall}
                                            disabled={!activeVersion}
                                        >
                                            <Download size={18} />
                                            <span>Install Mod</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className={styles.placeholder}>
                                <div className={styles.placeholderIcon}>
                                    <Package size={48} strokeWidth={1} />
                                </div>
                                <p>Select a mod to view details</p>
                                <span>Browse and install mods from Modrinth</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
