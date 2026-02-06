import { useState, useEffect } from 'react';
import styles from './Settings.module.css';
import { Skeleton } from '../components/Skeleton';
import { PageHeader } from '../components/PageHeader';
import {
    FolderOpen,
    RotateCcw,
    Coffee,
    Cpu,
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
            setProcessing(prev => prev ? { ...prev, subMessage: data.status, progress: data.progress } : null);
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
                const account = AccountManager.getActive();
                if (account?.type === 'whoap') {
                    try {
                        const cloudSettings = await CloudManager.fetchSettings(account.uuid);
                        if (cloudSettings) {
                            Object.assign(cfg, cloudSettings);
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
            const account = AccountManager.getActive();
            if (account?.type === 'whoap') {
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
            setShowVersionScanner(true);
        }
    };

    const handleReset = async (mode: 'database' | 'full') => {
        localStorage.clear();
        await window.ipcRenderer.invoke('app:reset', mode);
    };

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
                <PageHeader title="Settings" description="Configure your launcher preferences, paths, and performance." />
                <div className={styles.content}>
                    <Skeleton width="100%" height={120} />
                    <Skeleton width="100%" height={120} style={{ marginTop: 20 }} />
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
            {saving && <div className={styles.savingBadge}><RefreshCw size={12} className={styles.spin} /> Saving...</div>}

            <div className={styles.content}>
                {/* Paths Section */}
                <section className={styles.section}>
                    <h3><FolderOpen size={18} /> Launcher Paths</h3>
                    <div className={styles.settingRow}>
                        <div className={styles.labelCol}>
                            <span className={styles.label}>Game Data Path</span>
                            <span className={styles.hint}>Where game assets and libraries are stored.</span>
                        </div>
                        <div className={styles.controlCol}>
                            <div className={styles.pathBox}>{config.gamePath}</div>
                            <button className={styles.btn} onClick={handleChangeGamePath}><FolderOpen size={16} /> Browse</button>
                        </div>
                    </div>
                </section>

                {/* Memory Section */}
                <section className={styles.section}>
                    <h3><Cpu size={18} /> Memory Allocation</h3>
                    <div className={styles.settingRow}>
                        <div className={styles.labelCol}>
                            <span className={styles.label}>Minimum RAM</span>
                        </div>
                        <div className={styles.sliderCol}>
                            <span className={styles.rangeValue}>{config.minRam} MB</span>
                            <input type="range" min="512" max={config.maxRam} step="256" value={config.minRam} onChange={(e) => updateConfig('minRam', parseInt(e.target.value))} className={styles.slider} />
                        </div>
                    </div>
                    <div className={styles.settingRow}>
                        <div className={styles.labelCol}>
                            <span className={styles.label}>Maximum RAM</span>
                        </div>
                        <div className={styles.sliderCol}>
                            <span className={styles.rangeValue}>{config.maxRam} MB ({(config.maxRam / 1024).toFixed(1)} GB)</span>
                            <input type="range" min={config.minRam} max="16384" step="256" value={config.maxRam} onChange={(e) => updateConfig('maxRam', parseInt(e.target.value))} className={styles.slider} />
                        </div>
                    </div>
                </section>

                {/* Java Section */}
                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <h3><Coffee size={18} /> Java Runtime</h3>
                        <button className={styles.resetAllBtn} onClick={handleResetAllJava}><RotateCcw size={14} /> Reset All</button>
                    </div>
                    {JAVA_VERSIONS.map(version => (
                        <div key={version} className={styles.settingRow}>
                            <div className={styles.labelCol}>
                                <span className={styles.label}>Java {version}</span>
                            </div>
                            <div className={styles.controlCol}>
                                <div className={`${styles.pathBox} ${!config.javaPaths?.[version] ? styles.autoPath : ''}`}>
                                    {config.javaPaths?.[version] || <><RefreshCw size={14} /> Auto-detect</>}
                                </div>
                                <button className={styles.iconBtn} onClick={() => handleSelectJava(version)}><FolderOpen size={16} /></button>
                                {config.javaPaths?.[version] && (
                                    <button className={styles.dangerIconBtn} onClick={() => handleResetJava(version)}><RotateCcw size={16} /></button>
                                )}
                            </div>
                        </div>
                    ))}
                </section>

                {/* Launch Behavior Section */}
                <section className={styles.section}>
                    <h3><Monitor size={18} /> Launch Behavior</h3>
                    <div className={styles.settingRow}>
                        <div className={styles.labelCol}>
                            <span className={styles.label}>When game starts</span>
                        </div>
                        <div className={styles.radioGroup}>
                            <label className={`${styles.radioOption} ${config.launchBehavior === 'hide' ? styles.selected : ''}`}>
                                <input type="radio" name="launchBehavior" value="hide" checked={config.launchBehavior === 'hide'} onChange={() => updateConfig('launchBehavior', 'hide')} />
                                <EyeOff size={16} /> Hide
                            </label>
                            <label className={`${styles.radioOption} ${config.launchBehavior === 'minimize' ? styles.selected : ''}`}>
                                <input type="radio" name="launchBehavior" value="minimize" checked={config.launchBehavior === 'minimize'} onChange={() => updateConfig('launchBehavior', 'minimize')} />
                                <Minimize2 size={16} /> Minimize
                            </label>
                            <label className={`${styles.radioOption} ${config.launchBehavior === 'keep' ? styles.selected : ''}`}>
                                <input type="radio" name="launchBehavior" value="keep" checked={config.launchBehavior === 'keep'} onChange={() => updateConfig('launchBehavior', 'keep')} />
                                <Monitor size={16} /> Keep Open
                            </label>
                        </div>
                    </div>
                    <div className={styles.settingRow}>
                        <div className={styles.labelCol}>
                            <span className={styles.label}>Show Game Console</span>
                            <span className={styles.hint}>Display log output when game launches.</span>
                        </div>
                        <label className={styles.toggle}>
                            <input type="checkbox" checked={config.showConsoleOnLaunch} onChange={(e) => updateConfig('showConsoleOnLaunch', e.target.checked)} />
                            <span className={styles.toggleSlider}></span>
                        </label>
                    </div>
                </section>

                {/* Updates Section */}
                <section className={styles.section}>
                    <h3><Download size={18} /> Software Updates</h3>
                    <div className={styles.updateRow}>
                        {updateStatus === 'idle' && updateInfo?.version === 'latest' && (
                            <div className={styles.updateStatus}><CheckCircle size={18} color="#10b981" /> You're up to date!</div>
                        )}
                        {updateStatus === 'available' && (
                            <div className={styles.updateStatus} style={{ color: '#f59e0b' }}><Download size={18} /> Version {updateInfo?.version} available</div>
                        )}
                        {updateStatus === 'downloading' && (
                            <div className={styles.updateStatus}><RefreshCw size={18} className={styles.spin} /> Downloading...</div>
                        )}
                        {updateStatus === 'ready' && (
                            <div className={styles.updateStatus} style={{ color: '#10b981' }}><CheckCircle size={18} /> Ready to install!</div>
                        )}
                        {updateStatus === 'error' && (
                            <div className={styles.updateStatus} style={{ color: '#ef4444' }}><AlertTriangle size={18} /> {updateInfo?.error}</div>
                        )}

                        <div className={styles.updateActions}>
                            {(updateStatus === 'idle' || updateStatus === 'error') && (
                                <button className={styles.btn} onClick={checkForUpdates}>Check for Updates</button>
                            )}
                            {updateStatus === 'checking' && <button className={styles.btn} disabled>Checking...</button>}
                            {updateStatus === 'available' && <button className={styles.primaryBtn} onClick={downloadUpdate}>Download</button>}
                            {updateStatus === 'ready' && <button className={styles.primaryBtn} onClick={installUpdate}>Restart & Install</button>}
                        </div>
                    </div>
                </section>

                {/* Danger Zone */}
                <section className={`${styles.section} ${styles.dangerSection}`}>
                    <h3><Trash2 size={18} /> Danger Zone</h3>
                    <div className={styles.settingRow}>
                        <div className={styles.labelCol}>
                            <span className={styles.label}>Reset Launcher</span>
                            <span className={styles.hint}>Clear all settings and restart fresh.</span>
                        </div>
                        <button className={styles.dangerBtn} onClick={() => setShowResetModal(true)}>Reset Launcher</button>
                    </div>
                    <div className={styles.settingRow}>
                        <div className={styles.labelCol}>
                            <span className={styles.label}>Scan External Versions</span>
                            <span className={styles.hint}>Import versions from TLauncher or other launchers.</span>
                        </div>
                        <button className={styles.btn} onClick={() => setShowVersionScanner(true)}><FolderSearch size={16} /> Scan</button>
                    </div>
                </section>
            </div>

            {/* Reset Modal */}
            {showResetModal && (
                <div className={styles.modalOverlay} onClick={() => setShowResetModal(false)}>
                    <div className={styles.modal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <AlertTriangle size={24} color="#ef4444" />
                            <h3>Reset Launcher</h3>
                            <button className={styles.closeBtn} onClick={() => setShowResetModal(false)}><X size={18} /></button>
                        </div>
                        <div className={styles.modalBody}>
                            <p>Choose reset mode:</p>
                            <div className={styles.resetOption} onClick={() => handleReset('database')}>
                                <strong>Clear Settings Only</strong>
                                <span>Clears configurations and accounts. Game files are kept.</span>
                            </div>
                            <div className={`${styles.resetOption} ${styles.dangerOption}`} onClick={() => handleReset('full')}>
                                <strong>Full Reset</strong>
                                <span>Deletes everything including instances.</span>
                            </div>
                        </div>
                        <button className={styles.cancelBtn} onClick={() => setShowResetModal(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {showVersionScanner && (
                <VersionScannerModal onClose={() => setShowVersionScanner(false)} onImport={handleVersionImport} />
            )}

            {processing && (
                <ProcessingModal message={processing.message} subMessage={processing.subMessage} progress={processing.progress} />
            )}
        </div>
    );
};
