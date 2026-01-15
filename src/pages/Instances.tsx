import React, { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Settings, RefreshCw, FolderOpen } from 'lucide-react';
import { Instance, InstanceApi } from '../api/instances';
import { CreateInstanceModal } from '../components/CreateInstanceModal';
import { InstanceSettingsModal } from '../components/InstanceSettingsModal';
import { ProcessingModal } from '../components/ProcessingModal';
import styles from './Instances.module.css';
import { AccountManager } from '../utils/AccountManager';
import { CloudManager } from '../utils/CloudManager';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../context/ToastContext';

interface InstancesProps {
    onSelectInstance?: (instance: Instance) => void;
}

export const Instances: React.FC<InstancesProps> = ({ onSelectInstance }) => {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [loading, setLoading] = useState(true);
    const [settingsInstance, setSettingsInstance] = useState<Instance | null>(null);
    const [processing, setProcessing] = useState<{ message: string; subMessage?: string; progress?: number } | null>(null);
    const { showToast } = useToast();

    const loadInstances = async () => {
        setLoading(true);
        try {
            const localList = await InstanceApi.list();
            let finalInstances = [...localList];

            const activeAccount = AccountManager.getActive();
            if (activeAccount && activeAccount.type === 'whoap') {
                const cloudInstances = await CloudManager.fetchInstances(activeAccount.uuid);
                cloudInstances.forEach(cloudInst => {
                    if (!finalInstances.find(local => local.name === cloudInst.name)) {
                        finalInstances.push({
                            ...cloudInst,
                            created: Date.now(),
                            lastPlayed: 0
                        });
                    }
                });
            }

            setInstances(finalInstances);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleCreated = async () => {
        await loadInstances();

        const activeAccount = AccountManager.getActive();
        if (activeAccount && activeAccount.type === 'whoap') {
            const list = await InstanceApi.list();
            for (const inst of list) {
                await CloudManager.saveInstance(inst, activeAccount.uuid);
            }
        }
    };

    useEffect(() => {
        loadInstances();

        const handleProgress = (_: any, data: any) => {
            setProcessing(prev => prev ? { ...prev, subMessage: data.status, progress: data.progress } : null);
        };
        window.ipcRenderer.on('instance:import-progress', handleProgress);
        return () => {
            window.ipcRenderer.off('instance:import-progress', handleProgress);
        };
    }, []);

    return (
        <div className={styles.container}>
            <PageHeader
                title="Profiles"
                description="Manage your Minecraft instances and versions."
            />

            <div className={styles.header}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
                    <button className={styles.refreshBtn} onClick={loadInstances} title="Refresh List">
                        <RefreshCw size={20} />
                    </button>
                    <button className={styles.createBtn} onClick={async () => {
                        setProcessing({ message: 'Importing Instance...', subMessage: 'Initializing...', progress: 0 });
                        try {
                            const res = await InstanceApi.import();
                            if (res.success) {
                                showToast('Instance imported successfully!', 'success');
                                loadInstances();
                            }
                            else if (res.error) showToast(res.error, 'error');
                        } finally {
                            setProcessing(null);
                        }
                    }}>
                        Import .zip
                    </button>
                    <button className={styles.createBtn} onClick={() => setShowCreateModal(true)}>
                        + New Profile
                    </button>
                </div>
            </div>

            <div className={styles.grid}>
                {loading ? (
                    // Skeleton Grid
                    Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className={styles.instanceCard} style={{ cursor: 'default' }}>
                            <div className={styles.instanceIcon}>
                                <Skeleton width="100%" height="100%" style={{ borderRadius: 12 }} />
                            </div>
                            <div className={styles.instanceInfo} style={{ width: '100%' }}>
                                <Skeleton width="70%" height={16} style={{ marginBottom: 6 }} />
                                <Skeleton width="40%" height={12} />
                            </div>
                        </div>
                    ))
                ) : instances.length === 0 ? (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}><FolderOpen size={64} color="#666" /></div>
                        <h3>No profiles found</h3>
                        <p>Create a new profile or import one to start playing.</p>
                        <button className={styles.createBtnBig} onClick={() => setShowCreateModal(true)}>
                            Create Profile
                        </button>
                    </div>
                ) : (
                    instances.map(instance => (
                        <div key={instance.id} className={styles.instanceCard} onClick={() => onSelectInstance?.(instance)}>
                            <div className={styles.instanceIcon}>
                                <img src="https://assets.ppy.sh/beatmaps/1/covers/list.jpg" alt="Icon" style={{ display: 'none' }} />
                                {instance.name.charAt(0).toUpperCase()}
                            </div>
                            <div className={styles.instanceInfo}>
                                <div className={styles.instanceName}>{instance.name}</div>
                                <div className={styles.instanceMeta}>
                                    {instance.version} • {instance.loader}
                                </div>
                            </div>
                            <div className={styles.playOverlay}>
                                <button
                                    className={styles.actionBtn}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSettingsInstance(instance);
                                    }}
                                    title="Settings"
                                    style={{
                                        background: 'rgba(255, 255, 255, 0.2)',
                                        backdropFilter: 'blur(10px)',
                                        borderRadius: '50%',
                                        width: 48,
                                        height: 48,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        cursor: 'pointer',
                                        color: 'white',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <Settings size={24} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {showCreateModal && (
                <CreateInstanceModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={handleCreated}
                />
            )}

            {settingsInstance && (
                <InstanceSettingsModal
                    instance={settingsInstance}
                    onClose={() => setSettingsInstance(null)}
                    onUpdate={loadInstances}
                    onProcessing={(msg, sub) => setProcessing({ message: msg, subMessage: sub })}
                    onProcessingEnd={() => setProcessing(null)}
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
