import React, { useState, useEffect } from 'react';
import styles from './ModpackBrowser.module.css';
import { Search, Download, Upload, ChevronRight, Package, Users, Calendar, Loader2, Layers, ChevronDown, X, ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { InstanceApi } from '../api/instances';
import { ProcessingModal } from '../components/ProcessingModal';
import { useToast } from '../context/ToastContext';
import { Skeleton } from '../components/Skeleton';
import ReactMarkdown from 'react-markdown';

interface Modpack {
    project_id: string;
    slug: string;
    title: string;
    description: string;
    categories: string[];
    versions: string[];
    downloads: number;
    follows: number;
    icon_url?: string;
    author: string;
    date_modified: string;
    featured_gallery?: string;
}

interface ModpackVersion {
    id: string;
    version_number: string;
    name: string;
    game_versions: string[];
    loaders: string[];
    downloads: number;
    date_published: string;
    files: any[];
}

interface ModpackBrowserProps {
    isOnline?: boolean;
}

export const ModpackBrowser: React.FC<ModpackBrowserProps> = () => {
    const [query, setQuery] = useState('');
    const [modpacks, setModpacks] = useState<Modpack[]>([]);
    const [loading, setLoading] = useState(true);

    // Selection State
    const [selectedPack, setSelectedPack] = useState<Modpack | null>(null);
    const [packDetails, setPackDetails] = useState<any>(null);
    const [versions, setVersions] = useState<ModpackVersion[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<ModpackVersion | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [showVersionDropdown, setShowVersionDropdown] = useState(false);

    // Install State
    const [installing, setInstalling] = useState(false);
    const [installProgress, setInstallProgress] = useState<{ message: string; progress: number } | null>(null);

    // Web View State
    const [viewingUrl, setViewingUrl] = useState<string | null>(null);

    const { showToast } = useToast();

    // Initial load
    useEffect(() => {
        loadFeatured();
    }, []);

    // Progress listener
    useEffect(() => {
        const handler = (_: any, data: { status: string; progress: number }) => {
            setInstallProgress({ message: data.status, progress: data.progress });
        };
        window.ipcRenderer.on('modpack:install-progress', handler);
        return () => { window.ipcRenderer.off('modpack:install-progress', handler); };
    }, []);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (query.trim()) {
                searchModpacks(query);
            } else {
                loadFeatured();
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [query]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = () => setShowVersionDropdown(false);
        if (showVersionDropdown) {
            document.addEventListener('click', handleClick);
            return () => document.removeEventListener('click', handleClick);
        }
    }, [showVersionDropdown]);

    const loadFeatured = async () => {
        setLoading(true);
        try {
            const res = await window.ipcRenderer.invoke('modpack:get-featured');
            if (res.success) {
                setModpacks(res.hits);
                if (res.hits.length > 0 && !selectedPack) {
                    handleSelectPack(res.hits[0]);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const searchModpacks = async (q: string) => {
        setLoading(true);
        try {
            const res = await window.ipcRenderer.invoke('modpack:search', q, { limit: 20 });
            if (res.success) {
                setModpacks(res.hits);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectPack = async (pack: Modpack) => {
        if (selectedPack?.project_id === pack.project_id) return;

        setSelectedPack(pack);
        setLoadingDetails(true);
        setPackDetails(null);
        setVersions([]);
        setSelectedVersion(null);

        try {
            const [projectRes, versionsRes] = await Promise.all([
                window.ipcRenderer.invoke('modpack:get-project', pack.project_id),
                window.ipcRenderer.invoke('modpack:get-versions', pack.project_id)
            ]);

            if (projectRes.success) setPackDetails(projectRes.project);
            if (versionsRes.success) {
                setVersions(versionsRes.versions);
                if (versionsRes.versions.length > 0) {
                    setSelectedVersion(versionsRes.versions[0]);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingDetails(false);
        }
    };

    const handleInstall = async () => {
        if (!selectedPack || !selectedVersion) return;

        setInstalling(true);
        setInstallProgress({ message: 'Preparing installation...', progress: 0 });

        try {
            const res = await window.ipcRenderer.invoke('modpack:install', {
                versionId: selectedVersion.id,
                projectId: selectedPack.project_id,
                projectName: selectedPack.title,
                iconUrl: selectedPack.icon_url
            });

            if (res.success) {
                showToast(`${selectedPack.title} installed successfully!`, 'success');
            } else {
                showToast(res.error || 'Installation failed', 'error');
            }
        } catch (e: any) {
            showToast(e.message || 'Installation failed', 'error');
        } finally {
            setInstalling(false);
            setInstallProgress(null);
        }
    };

    const handleImportFile = async () => {
        setInstalling(true);
        setInstallProgress({ message: 'Importing modpack...', progress: 0 });
        try {
            const res = await InstanceApi.import();
            if (res.success) {
                showToast('Modpack imported successfully!', 'success');
            } else if (res.error) {
                showToast(res.error, 'error');
            }
        } catch (e: any) {
            showToast(e.message || 'Import failed', 'error');
        } finally {
            setInstalling(false);
            setInstallProgress(null);
        }
    };

    const formatNumber = (n: number) => {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
        return n.toString();
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <PageHeader
                    title="Modpacks"
                    description="Browse and install modpacks from Modrinth."
                />
                <button className={styles.importBtn} onClick={handleImportFile}>
                    <Upload size={18} />
                    <span>Import File</span>
                </button>
            </div>

            <div className={styles.content}>
                {/* Left Panel: Search & List */}
                <div className={styles.leftPanel}>
                    <div className={styles.searchWrapper}>
                        <Search size={18} className={styles.searchIcon} />
                        <input
                            className={styles.searchInput}
                            placeholder="Search modpacks..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>

                    <div className={styles.packList}>
                        {loading && modpacks.length === 0 ? (
                            Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className={styles.skeletonCard}>
                                    <Skeleton width={48} height={48} style={{ borderRadius: 10, flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <Skeleton width="70%" height={16} />
                                        <Skeleton width="50%" height={12} style={{ marginTop: 6 }} />
                                    </div>
                                </div>
                            ))
                        ) : modpacks.length === 0 ? (
                            <div className={styles.emptyState}>
                                <Package size={40} strokeWidth={1} />
                                <p>No modpacks found</p>
                            </div>
                        ) : (
                            modpacks.map(pack => (
                                <div
                                    key={pack.project_id}
                                    className={`${styles.packCard} ${selectedPack?.project_id === pack.project_id ? styles.selected : ''}`}
                                    onClick={() => handleSelectPack(pack)}
                                >
                                    <div className={styles.packIcon}>
                                        {pack.icon_url ? (
                                            <img src={pack.icon_url} alt={pack.title} />
                                        ) : (
                                            <Layers size={22} />
                                        )}
                                    </div>
                                    <div className={styles.packInfo}>
                                        <div className={styles.packTitle}>{pack.title}</div>
                                        <div className={styles.packMeta}>by {pack.author} • {formatNumber(pack.downloads)}</div>
                                    </div>
                                    {selectedPack?.project_id === pack.project_id && (
                                        <ChevronRight size={16} className={styles.selectedArrow} />
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right Panel: Details */}
                <div className={styles.rightPanel}>
                    {selectedPack ? (
                        <div className={styles.detailContainer}>
                            {/* Header with Icon & Title */}
                            <div className={styles.detailHeader}>
                                <div className={styles.detailIcon}>
                                    {selectedPack.icon_url ? (
                                        <img src={selectedPack.icon_url} alt={selectedPack.title} />
                                    ) : (
                                        <Layers size={40} />
                                    )}
                                </div>
                                <div className={styles.detailTitleArea}>
                                    <h1>{selectedPack.title}</h1>
                                    <p className={styles.detailAuthor}>by {packDetails?.team || selectedPack.author}</p>
                                </div>
                            </div>

                            {/* Stats Row */}
                            <div className={styles.statsRow}>
                                <div className={styles.statItem}>
                                    <Download size={18} />
                                    <div>
                                        <span className={styles.statValue}>{formatNumber(selectedPack.downloads)}</span>
                                        <span className={styles.statLabel}>Downloads</span>
                                    </div>
                                </div>
                                <div className={styles.statItem}>
                                    <Users size={18} />
                                    <div>
                                        <span className={styles.statValue}>{formatNumber(selectedPack.follows)}</span>
                                        <span className={styles.statLabel}>Followers</span>
                                    </div>
                                </div>
                                <div className={styles.statItem}>
                                    <Calendar size={18} />
                                    <div>
                                        <span className={styles.statValue}>{formatDate(selectedPack.date_modified)}</span>
                                        <span className={styles.statLabel}>Updated</span>
                                    </div>
                                </div>
                            </div>

                            {/* Install Section */}
                            <div className={styles.installSection}>
                                <div className={styles.versionSelector} onClick={(e) => { e.stopPropagation(); setShowVersionDropdown(!showVersionDropdown); }}>
                                    <span>
                                        {loadingDetails ? 'Loading...' : selectedVersion ? `${selectedVersion.version_number} (${selectedVersion.game_versions[0]})` : 'Select Version'}
                                    </span>
                                    <ChevronDown size={16} />

                                    {showVersionDropdown && versions.length > 0 && (
                                        <div
                                            className={styles.versionDropdown}
                                            onClick={e => e.stopPropagation()}
                                            onWheel={(e) => e.stopPropagation()}
                                        >
                                            <div className={styles.versionSearchContainer}>
                                                <Search size={14} className={styles.versionSearchIcon} />
                                                <input
                                                    autoFocus
                                                    className={styles.versionSearchInput}
                                                    placeholder="Search version..."
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={(e) => {
                                                        const val = e.target.value.toLowerCase();
                                                        const items = document.querySelectorAll(`.${styles.versionOption}`);
                                                        items.forEach((item: any) => {
                                                            const text = item.innerText.toLowerCase();
                                                            item.style.display = text.includes(val) ? 'flex' : 'none';
                                                        });
                                                    }}
                                                />
                                            </div>
                                            <div className={styles.versionScrollArea}>
                                                {versions.map(ver => (
                                                    <div
                                                        key={ver.id}
                                                        className={`${styles.versionOption} ${selectedVersion?.id === ver.id ? styles.activeOption : ''}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedVersion(ver);
                                                            setShowVersionDropdown(false);
                                                        }}
                                                    >
                                                        <span className={styles.optionVersion}>{ver.version_number}</span>
                                                        <span className={styles.optionMeta}>{ver.game_versions[0]} • {ver.loaders[0]}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button
                                    className={styles.installButton}
                                    disabled={!selectedVersion || installing}
                                    onClick={handleInstall}
                                >
                                    {installing ? (
                                        <Loader2 className={styles.spinner} size={18} />
                                    ) : (
                                        <Download size={18} />
                                    )}
                                    <span>{installing ? 'Installing...' : 'Install'}</span>
                                </button>
                            </div>

                            {/* Description */}
                            <div className={styles.descriptionSection}>
                                <h3>About this modpack</h3>
                                <div className={styles.markdownContent}>
                                    {loadingDetails ? (
                                        <div className={styles.descLoading}>
                                            <Skeleton width="100%" height={16} />
                                            <Skeleton width="80%" height={16} />
                                            <Skeleton width="90%" height={16} />
                                        </div>
                                    ) : (
                                        <ReactMarkdown
                                            components={{
                                                a: ({ node, ...props }) => (
                                                    <a
                                                        {...props}
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            if (props.href) setViewingUrl(props.href);
                                                        }}
                                                        style={{ cursor: 'pointer', color: '#ffaa00', textDecoration: 'underline' }}
                                                    />
                                                )
                                            }}
                                        >
                                            {packDetails?.body || selectedPack.description}
                                        </ReactMarkdown>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className={styles.noSelection}>
                            <Package size={64} strokeWidth={1} />
                            <h2>Select a Modpack</h2>
                            <p>Choose a modpack from the list to view details.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Progress Overlay */}
            {installing && installProgress && (
                <ProcessingModal
                    message="Installing Modpack"
                    subMessage={installProgress.message}
                    progress={installProgress.progress}
                />
            )}

            {/* Web View Overlay */}
            {viewingUrl && (
                <div className={styles.webOverlay}>
                    <iframe src={viewingUrl} className={styles.webFrame} title="External Content" />

                    <div className={styles.webDock}>
                        <div className={styles.dockInfo}>
                            <ExternalLink size={16} />
                            <span className={styles.dockUrl}>{viewingUrl}</span>
                        </div>
                        <button className={styles.dockCloseBtn} onClick={() => setViewingUrl(null)}>
                            <X size={18} />
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
