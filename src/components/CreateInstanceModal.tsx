import React, { useState, useEffect } from 'react';
import { InstanceApi } from '../api/instances';
import { VersionsApi, MinecraftVersion } from '../api/versions';
import styles from './CreateInstanceModal.module.css';
import { CustomSelect } from './common/CustomSelect';
import { X } from 'lucide-react';

interface CreateInstanceModalProps {
    onClose: () => void;
    onCreated: () => void;
}

type LoaderType = 'vanilla' | 'fabric' | 'forge';
type VersionFilter = 'release' | 'snapshot' | 'all';

export const CreateInstanceModal: React.FC<CreateInstanceModalProps> = ({ onClose, onCreated }) => {
    const [name, setName] = useState('');
    const [version, setVersion] = useState('');
    const [loader, setLoader] = useState<LoaderType>('vanilla');
    const [versionFilter, setVersionFilter] = useState<VersionFilter>('release');
    const [versions, setVersions] = useState<MinecraftVersion[]>([]);
    const [loading, setLoading] = useState(false);
    const [fetchingVersions, setFetchingVersions] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fabricLoaders, setFabricLoaders] = useState<{ id: string; stable: boolean }[]>([]);
    const [selectedLoaderVersion, setSelectedLoaderVersion] = useState('');
    const [loadingFabric, setLoadingFabric] = useState(false);

    useEffect(() => {
        const loadVersions = async () => {
            setFetchingVersions(true);
            try {
                const data = await VersionsApi.getVanilla();
                setVersions(data.versions);
                // Default to latest release
                if (data.latest?.release) {
                    setVersion(data.latest.release);
                }
            } catch (e) {
                console.error(e);
                setError("Failed to load versions.");
            } finally {
                setFetchingVersions(false);
            }
        };
        loadVersions();
    }, []);

    useEffect(() => {
        const fetchFabric = async () => {
            if (loader === 'fabric' && version) {
                setLoadingFabric(true);
                setSelectedLoaderVersion(''); // Reset selection
                try {
                    console.log(`[CreateInstance] Fetching loaders for ${version}`);
                    const loaders = await InstanceApi.getFabricLoaders(version);
                    console.log(`[CreateInstance] Loaders found:`, loaders);
                    setFabricLoaders(loaders);
                    if (loaders.length > 0) {
                        const stable = loaders.find(l => l.stable);
                        setSelectedLoaderVersion(stable ? stable.id : loaders[0].id);
                    } else {
                        console.warn(`[CreateInstance] No loaders found for ${version}`);
                    }
                } catch (e) {
                    console.error("[CreateInstance] Failed to fetch loaders:", e);
                    setError("Failed to fetch Fabric loaders. Check console.");
                } finally {
                    setLoadingFabric(false);
                }
            }
        };
        fetchFabric();
    }, [loader, version]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !version) return;

        setLoading(true);
        setError(null);
        try {
            const result = await InstanceApi.create(name, version, loader, selectedLoaderVersion);
            if (result.success) {
                onCreated();
                onClose();
            } else {
                setError(result.error || "Failed to create instance.");
            }
        } catch (e) {
            setError("An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    };

    // Filter versions based on selected filter
    const filteredVersions = versions.filter(v => {
        if (versionFilter === 'release') return v.type === 'release';
        if (versionFilter === 'snapshot') return v.type === 'snapshot';
        return true; // 'all'
    });

    const versionOptions = filteredVersions.slice(0, 50).map(v => ({
        value: v.id,
        label: `${v.type === 'release' ? '' : `[${v.type}] `}${v.id}`
    }));

    const loaderOptions = [
        { value: 'vanilla', label: 'Vanilla' },
        { value: 'fabric', label: 'Fabric' },
        { value: 'forge', label: 'Forge (Coming Soon)' }
    ];

    const filterOptions = [
        { value: 'release', label: 'Releases' },
        { value: 'snapshot', label: 'Snapshots' },
        { value: 'all', label: 'All Versions' }
    ];

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h2>Create New Profile</h2>
                    <button onClick={onClose} className={styles.closeIcon}><X size={20} /></button>
                </div>

                <form onSubmit={handleCreate}>
                    <div className={styles.formGroup}>
                        <label>Profile Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="My Survival World"
                            autoFocus
                            className={styles.input}
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Mod Loader</label>
                        <CustomSelect
                            value={loader}
                            onChange={(v) => setLoader(v as LoaderType)}
                            options={loaderOptions}
                            placeholder="Select loader"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Version Filter</label>
                        <CustomSelect
                            value={versionFilter}
                            onChange={(v) => setVersionFilter(v as VersionFilter)}
                            options={filterOptions}
                            placeholder="Filter versions"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Game Version</label>
                        {fetchingVersions ? (
                            <div className={styles.loadingVersions}>Loading versions...</div>
                        ) : (
                            <CustomSelect
                                value={version}
                                onChange={setVersion}
                                options={versionOptions}
                                placeholder="Select a version"
                            />
                        )}
                    </div>

                    {loader === 'fabric' && (
                        <div className={styles.formGroup}>
                            <label>Fabric Loader Version</label>
                            {loadingFabric ? (
                                <div className={styles.loadingVersions}>Fetching loaders...</div>
                            ) : (
                                <CustomSelect
                                    value={selectedLoaderVersion}
                                    onChange={setSelectedLoaderVersion}
                                    options={fabricLoaders.map(l => ({
                                        value: l.id,
                                        label: `${l.id} ${l.stable ? '(Stable)' : ''}`
                                    }))}
                                    placeholder="Select loader version"
                                />
                            )}
                        </div>
                    )}

                    {error && <div className={styles.error}>{error}</div>}

                    <div className={styles.actions}>
                        <button type="button" onClick={onClose} className={styles.cancelBtn}>Cancel</button>
                        <button type="submit" className={styles.createBtn} disabled={loading || !name || fetchingVersions}>
                            {loading ? 'Creating...' : 'Create Profile'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

