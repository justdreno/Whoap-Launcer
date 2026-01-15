import { useState, useEffect } from 'react';
import styles from './Settings.module.css';
import { Skeleton } from '../components/Skeleton';
import { PageHeader } from '../components/PageHeader';
import {
    FolderOpen,
    RotateCcw,
    Coffee,
    Cpu,
    Rocket,
    EyeOff,
    Minimize2,
    Monitor,
    RefreshCw,
    Trash2,
    AlertTriangle,
    FolderSearch,
    X,
    Download,
    CheckCircle
} from 'lucide-react';
import { VersionScannerModal } from '../components/VersionScannerModal';
import { AccountManager } from '../utils/AccountManager';
import { CloudManager } from '../utils/CloudManager';
import { useToast } from '../context/ToastContext';
import { ProcessingModal } from '../components/ProcessingModal';

interface JavaPaths {
    [version: string]: string;
}

interface Config {
    gamePath: string;
    instancesPath: string;
    minRam: number;
    maxRam: number;
    javaPaths: JavaPaths;
    launchBehavior: 'hide' | 'minimize' | 'keep';
    showConsoleOnLaunch: boolean;
}

const JAVA_VERSIONS = ['8', '11', '16', '17', '21'];

export const Settings = () => {
    const [config, setConfig] = useState<Config | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showResetModal, setShowResetModal] = useState(false);
    const [showVersionScanner, setShowVersionScanner] = useState(false);
    const { showToast } = useToast();

    // Update states
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'>('idle');
    const [updateInfo, setUpdateInfo] = useState<{ version?: string; error?: string } | null>(null);
    const [processing, setProcessing] = useState<{ message: string; subMessage?: string; progress?: number } | null>(null);

    useEffect(() => {
        const handleProgress = (_: any, data: any) => {
            setProcessing(prev => prev ? { ...prev, subMessage: data.status, progress: data.progress } : { message: 'Importing...', subMessage: data.status, progress: data.progress });
        };
        window.ipcRenderer.on('instance:import-progress', handleProgress);
        return () => {
            window.ipcRenderer.off('instance:import-progress', handleProgress);
        };
    }, []);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const cfg = await window.ipcRenderer.invoke('config:get');

                // Cloud Sync: Fetch & Merge
                const account = AccountManager.getActive();
                if (account?.type === 'whoap') {
                    try {
                        const cloudSettings = await CloudManager.fetchSettings(account.uuid);
                        if (cloudSettings) {
                            console.log("Applied cloud settings:", cloudSettings);
                            Object.assign(cfg, cloudSettings);
                            // Persist merged changes to local store
                            for (const [key, value] of Object.entries(cloudSettings)) {
                                await window.ipcRenderer.invoke('config:set', key, value);
                            }
                        }
                    } catch (err) {
                        console.error("Cloud sync failed on load:", err);
                    }
                }

                setConfig(cfg);
            } catch (error) {
                console.error("Failed to load config", error);
            } finally {
                setLoading(false);
            }
        };
        loadConfig();
    }, []);

    const updateConfig = async (key: keyof Config, value: any) => {
        if (!config) return;
        setSaving(true);
        try {
            await window.ipcRenderer.invoke('config:set', key, value);
            const newConfig = { ...config, [key]: value };
            setConfig(newConfig);

            // Cloud Sync: Save
            const account = AccountManager.getActive();
            if (account?.type === 'whoap') {
                // Fire and forget
                CloudManager.saveSettings(newConfig, account.uuid).catch(console.error);
            }
        } catch (e) {
            console.error("Failed to save setting", e);
        } finally {
            setSaving(false);
        }
    };

    const handleChangeGamePath = async () => {
        const result = await window.ipcRenderer.invoke('config:set-game-path');
        if (result.success && config) {
            setConfig({ ...config, gamePath: result.path });
            // Offer to scan for versions after changing path
            setShowVersionScanner(true);
        }
    };

    const handleReset = async (mode: 'database' | 'full') => {
        localStorage.clear();
        await window.ipcRenderer.invoke('app:reset', mode);
    };

    // Removed broken import and re-declared component here in previous invalid edit.
    // Restoring correct flow.

    const handleVersionImport = async (versions: any[]) => {
        if (versions.length === 0) return;

        setProcessing({ message: 'Importing Versions', subMessage: 'Initializing...', progress: 0 });
        try {
            const versionIds = versions.map(v => v.id);
            const result = await window.ipcRenderer.invoke('instance:import-external', versionIds);

            if (result.success) {
                const successCount = result.results.filter((r: any) => r.success).length;
                const failCount = result.results.length - successCount;

                if (failCount === 0) {
                    showToast(`Successfully imported ${successCount} versions!`, 'success');
                } else if (successCount > 0) {
                    showToast(`Imported ${successCount} versions (${failCount} failed)`, 'warning');
                } else {
                    showToast('Failed to import versions.', 'error');
                }
            } else {
                showToast(result.error || 'Import failed', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('An error occurred during import', 'error');
        } finally {
            setProcessing(null);
        }
    };

    const handleSelectJava = async (version: string) => {
        const result = await window.ipcRenderer.invoke('config:select-java', version);
        if (result.success && config) {
            const newPaths = { ...(config.javaPaths || {}), [version]: result.path };
            setConfig({ ...config, javaPaths: newPaths });
        }
    };

    const handleResetJava = async (version: string) => {
        await window.ipcRenderer.invoke('config:reset-java', version);
        if (config) {
            const newPaths = { ...(config.javaPaths || {}) };
            delete newPaths[version];
            setConfig({ ...config, javaPaths: newPaths });
        }
    };

    const handleResetAllJava = async () => {
        await window.ipcRenderer.invoke('config:reset-java');
        if (config) {
            setConfig({ ...config, javaPaths: {} });
        }
    };

    // Update handlers
    const checkForUpdates = async () => {
        setUpdateStatus('checking');
        setUpdateInfo(null);
        try {
            const result = await window.ipcRenderer.invoke('update:check');
            if (result.success && result.updateInfo) {
                setUpdateStatus('available');
                setUpdateInfo({ version: result.updateInfo.version });
            } else if (result.success) {
                setUpdateStatus('idle');
                setUpdateInfo({ version: 'latest' });
            } else {
                setUpdateStatus('error');
                setUpdateInfo({ error: result.error || 'Check failed' });
            }
        } catch (e: any) {
            setUpdateStatus('error');
            setUpdateInfo({ error: e.message });
        }
    };

    const downloadUpdate = async () => {
        setUpdateStatus('downloading');
        try {
            await window.ipcRenderer.invoke('update:download');
            setUpdateStatus('ready');
        } catch (e: any) {
            setUpdateStatus('error');
            setUpdateInfo({ error: e.message });
        }
    };

    const installUpdate = () => {
        window.ipcRenderer.invoke('update:install');
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <PageHeader
                    title="Settings"
                    description="Configure your launcher preferences, paths, and performance."
                />
                <div className={styles.header} style={{ marginBottom: 0 }}>
                    {saving && <span className={styles.savingBadge}>Saving...</span>}
                </div>

                <div className={styles.section}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <Skeleton width={18} height={18} />
                        <Skeleton width={180} height={24} />
                    </div>
                </div>
            </div>
        );
    }
    if (!config) return <div className={styles.container}>Failed to load settings.</div>;

    return (
        <div className={styles.container}>
            <PageHeader
                title="Settings"
                description="Configure your launcher preferences, paths, and performance."
            />

            <div className={styles.header} style={{ marginBottom: 0 }}>
                {saving && <span className={styles.savingBadge}>Saving...</span>}
            </div>

            {/* Paths Section */}
            <div className={styles.section}>
                <h2><FolderOpen size={18} className={styles.sectionIcon} /> Launcher Paths</h2>
                <p className={styles.description}>
                    Configure where the launcher stores game assets. Point to your <code>.minecraft</code> folder to use TLauncher downloads.
                </p>

                <div className={styles.settingRow}>
                    <div className={styles.settingLabel}>Game Data Path</div>
                    <div className={styles.settingControl}>
                        <div className={styles.pathDisplay}>{config.gamePath}</div>
                        <button className={styles.browseBtn} onClick={handleChangeGamePath}>
                            <FolderOpen size={16} /> Browse
                        </button>
                    </div>
                </div>
            </div>

            {/* Memory Section */}
            <div className={styles.section}>
                <h2><Cpu size={18} className={styles.sectionIcon} /> Memory Allocation</h2>
                <p className={styles.description}>
                    Set the RAM limits for Minecraft. More RAM helps with modpacks.
                </p>

                <div className={styles.settingRow}>
                    <div className={styles.settingLabel}>Minimum RAM: {config.minRam} MB</div>
                    <input
                        type="range"
                        min="512"
                        max={config.maxRam}
                        step="256"
                        value={config.minRam}
                        onChange={(e) => updateConfig('minRam', parseInt(e.target.value))}
                        className={styles.slider}
                    />
                </div>

                <div className={styles.settingRow}>
                    <div className={styles.settingLabel}>Maximum RAM: {config.maxRam} MB ({(config.maxRam / 1024).toFixed(1)} GB)</div>
                    <input
                        type="range"
                        min={config.minRam}
                        max="16384"
                        step="256"
                        value={config.maxRam}
                        onChange={(e) => updateConfig('maxRam', parseInt(e.target.value))}
                        className={styles.slider}
                    />
                </div>
            </div>

            {/* Java Section */}
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2><Coffee size={18} className={styles.sectionIcon} /> Java Runtime</h2>
                    <button className={styles.resetAllBtn} onClick={handleResetAllJava}>
                        <RotateCcw size={14} /> Reset All
                    </button>
                </div>
                <p className={styles.description}>
                    Configure Java paths for different versions. Leave blank to auto-detect.
                </p>

                {JAVA_VERSIONS.map(version => (
                    <div key={version} className={styles.settingRow}>
                        <div className={styles.settingLabel}>Java {version}</div>
                        <div className={styles.settingControl}>
                            <div className={styles.pathDisplay}>
                                {config.javaPaths?.[version] ? config.javaPaths[version] : (
                                    <span className={styles.autoDetect}><RefreshCw size={14} /> Auto-detect</span>
                                )}
                            </div>
                            <button className={styles.browseBtn} onClick={() => handleSelectJava(version)}>
                                <FolderOpen size={16} />
                            </button>
                            {config.javaPaths?.[version] && (
                                <button className={styles.resetBtn} onClick={() => handleResetJava(version)}>
                                    <RotateCcw size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Launch Behavior Section */}
            <div className={styles.section}>
                <h2><Rocket size={18} className={styles.sectionIcon} /> Launch Behavior</h2>
                <p className={styles.description}>
                    What happens to the launcher when you start a game?
                </p>

                <div className={styles.settingRow}>
                    <div className={styles.radioGroup}>
                        <label className={`${styles.radioOption} ${config.launchBehavior === 'hide' ? styles.selected : ''}`}>
                            <input
                                type="radio"
                                name="launchBehavior"
                                value="hide"
                                checked={config.launchBehavior === 'hide'}
                                onChange={() => updateConfig('launchBehavior', 'hide')}
                            />
                            <EyeOff size={16} /> Hide to Tray
                        </label>
                        <label className={`${styles.radioOption} ${config.launchBehavior === 'minimize' ? styles.selected : ''}`}>
                            <input
                                type="radio"
                                name="launchBehavior"
                                value="minimize"
                                checked={config.launchBehavior === 'minimize'}
                                onChange={() => updateConfig('launchBehavior', 'minimize')}
                            />
                            <Minimize2 size={16} /> Minimize
                        </label>
                        <label className={`${styles.radioOption} ${config.launchBehavior === 'keep' ? styles.selected : ''}`}>
                            <input
                                type="radio"
                                name="launchBehavior"
                                value="keep"
                                checked={config.launchBehavior === 'keep'}
                                onChange={() => updateConfig('launchBehavior', 'keep')}
                            />
                            <Monitor size={16} /> Keep Open
                        </label>
                    </div>
                </div>

                <div className={styles.settingRow}>
                    <label className={styles.toggle}>
                        <input
                            type="checkbox"
                            checked={config.showConsoleOnLaunch}
                            onChange={(e) => updateConfig('showConsoleOnLaunch', e.target.checked)}
                        />
                        <span className={styles.toggleSlider}></span>
                        Show Game Console on Launch
                    </label>
                </div>
            </div>

            {/* Software Updates Section */}
            <div className={styles.section}>
                <h2><Download size={18} className={styles.sectionIcon} /> Software Updates</h2>
                <p className={styles.description}>
                    Check for new versions of the Whoap Launcher.
                </p>

                <div className={styles.settingRow} style={{ alignItems: 'center', gap: 16 }}>
                    {updateStatus === 'idle' && updateInfo?.version === 'latest' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981' }}>
                            <CheckCircle size={18} /> You're up to date!
                        </div>
                    )}
                    {updateStatus === 'available' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b' }}>
                            <Download size={18} /> Version {updateInfo?.version} is available!
                        </div>
                    )}
                    {updateStatus === 'downloading' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3b82f6' }}>
                            <RefreshCw size={18} className={styles.spinning} /> Downloading update...
                        </div>
                    )}
                    {updateStatus === 'ready' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981' }}>
                            <CheckCircle size={18} /> Update ready to install!
                        </div>
                    )}
                    {updateStatus === 'error' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444' }}>
                            <AlertTriangle size={18} /> {updateInfo?.error || 'Update check failed'}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                    {(updateStatus === 'idle' || updateStatus === 'error') && (
                        <button className={styles.browseBtn} onClick={checkForUpdates}>
                            Check for Updates
                        </button>
                    )}
                    {updateStatus === 'checking' && (
                        <button className={styles.browseBtn} disabled>
                            Checking...
                        </button>
                    )}
                    {updateStatus === 'available' && (
                        <button className={styles.browseBtn} onClick={downloadUpdate} style={{ background: '#f59e0b', color: 'black' }}>
                            Download Update
                        </button>
                    )}
                    {updateStatus === 'ready' && (
                        <button className={styles.browseBtn} onClick={installUpdate} style={{ background: '#10b981', color: 'white' }}>
                            Restart & Install
                        </button>
                    )}
                </div>
            </div>

            {/* Danger Zone */}
            <div className={styles.section} style={{ borderColor: '#ff4444', marginTop: 40 }}>
                <h2 style={{ color: '#ff4444', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Trash2 size={18} /> Danger Zone
                </h2>
                <p className={styles.description}>Reset the application to clear configurations and start fresh.</p>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
                    <button
                        className={styles.browseBtn}
                        style={{ background: '#ff4444', color: 'white', border: 'none', padding: '10px 20px', fontSize: '1em' }}
                        onClick={() => setShowResetModal(true)}
                    >
                        Reset Launcher
                    </button>

                    <button
                        className={styles.browseBtn}
                        style={{ background: '#333', color: 'white', border: '1px solid #555', padding: '10px 20px', fontSize: '1em' }}
                        onClick={() => setShowVersionScanner(true)}
                    >
                        <FolderSearch size={16} style={{ marginRight: 8 }} />
                        Scan Versions
                    </button>
                </div>
            </div>

            {/* Reset Confirmation Modal */}
            {showResetModal && (
                <div className={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && setShowResetModal(false)}>
                    <div className={styles.resetModal}>
                        <div className={styles.resetModalHeader}>
                            <AlertTriangle size={24} color="#ff4444" />
                            <h3>Reset Launcher</h3>
                            <button className={styles.modalCloseBtn} onClick={() => setShowResetModal(false)}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className={styles.resetModalContent}>
                            <p>Choose how you want to reset the launcher:</p>

                            <div className={styles.resetOption} onClick={() => handleReset('database')}>
                                <div className={styles.resetOptionTitle}>Clear Settings Only</div>
                                <div className={styles.resetOptionDesc}>
                                    Clears configurations, accounts, and preferences.
                                    <strong> Game files and instances are kept</strong> - you can re-import them after restart.
                                </div>
                            </div>

                            <div className={styles.resetOption} style={{ borderColor: '#ff4444' }} onClick={() => handleReset('full')}>
                                <div className={styles.resetOptionTitle} style={{ color: '#ff4444' }}>Full Reset</div>
                                <div className={styles.resetOptionDesc}>
                                    <strong>Deletes everything</strong> including launcher-created instances.
                                    TLauncher/external versions are not affected.
                                </div>
                            </div>
                        </div>

                        <div className={styles.resetModalFooter}>
                            <button className={styles.cancelBtn} onClick={() => setShowResetModal(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Version Scanner Modal */}
            {showVersionScanner && (
                <VersionScannerModal
                    onClose={() => setShowVersionScanner(false)}
                    onImport={handleVersionImport}
                />
            )}

            {processing && (
                <ProcessingModal
                    message={processing.message}
                    subMessage={processing.subMessage}
                    progress={processing.progress}
                />
            )}
        </div>
    );
};
