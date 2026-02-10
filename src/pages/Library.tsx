
import React, { useState, useEffect } from 'react';
import { Package, Layers, Sparkles, Globe, ChevronDown, Check } from 'lucide-react';
import { ModsManager } from './ModsManager';
import { ResourcePacksManager } from './ResourcePacksManager';
import { ShaderPacksManager } from './ShaderPacksManager';
import { ModpackBrowser } from './ModpackBrowser';
import { PageHeader } from '../components/PageHeader';
import { Instance, InstanceApi } from '../api/instances';
import styles from './Library.module.css';

// Ideally use proper User type
interface LibraryProps {
    user?: any;
    isOnline?: boolean;
}

type TabId = 'modpacks' | 'mods' | 'resourcepacks' | 'shaderpacks';

export const Library: React.FC<LibraryProps> = () => {
    const [activeTab, setActiveTab] = useState<TabId>('modpacks');
    const [instances, setInstances] = useState<Instance[]>([]);
    const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
    const [showInstanceDropdown, setShowInstanceDropdown] = useState(false);

    useEffect(() => {
        loadInstances();
    }, []);

    const loadInstances = async () => {
        try {
            const list = await InstanceApi.list();
            setInstances(list);
            // Default to first instance if none selected and list not empty
            if (list.length > 0 && !selectedInstanceId) {
                // Try to find a recently played one or just first
                setSelectedInstanceId(list[0].id);
            }
        } catch (e) {
            console.error("Failed to load instances in Library", e);
        }
    };

    const selectedInstance = instances.find(i => i.id === selectedInstanceId);

    const tabs = [
        { id: 'modpacks', label: 'Modpacks', icon: Globe },
        { id: 'mods', label: 'Mods', icon: Package },
        { id: 'resourcepacks', label: 'Resource Packs', icon: Layers },
        { id: 'shaderpacks', label: 'Shader Packs', icon: Sparkles },
    ] as const;

    const showInstanceSelector = activeTab !== 'modpacks';

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <PageHeader title="Library" description="Manage your content and addons." />

                    {showInstanceSelector && (
                        <div className={styles.instanceSelectorWrapper}>
                            <div
                                className={styles.instanceSelector}
                                onClick={() => setShowInstanceDropdown(!showInstanceDropdown)}
                            >
                                <div className={styles.selectorLabel}>active instance</div>
                                <div className={styles.selectorValue}>
                                    {selectedInstance ? selectedInstance.name : 'Select Instance'}
                                    <ChevronDown size={14} style={{ opacity: 0.5 }} />
                                </div>
                            </div>

                            {showInstanceDropdown && (
                                <>
                                    <div className={styles.dropdownBackdrop} onClick={() => setShowInstanceDropdown(false)} />
                                    <div className={styles.instanceDropdown}>
                                        {instances.length === 0 ? (
                                            <div className={styles.dropdownEmpty}>No instances found</div>
                                        ) : (
                                            instances.map(inst => (
                                                <div
                                                    key={inst.id}
                                                    className={`${styles.dropdownItem} ${inst.id === selectedInstanceId ? styles.selectedItem : ''}`}
                                                    onClick={() => {
                                                        setSelectedInstanceId(inst.id);
                                                        setShowInstanceDropdown(false);
                                                    }}
                                                >
                                                    <span>{inst.name}</span>
                                                    {inst.id === selectedInstanceId && <Check size={14} color="#ffaa00" />}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className={styles.tabBar}>
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                className={`${styles.tabBtn} ${isActive ? styles.active : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                <Icon size={16} />
                                <span>{tab.label}</span>
                                {isActive && <div className={styles.indicator} />}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className={styles.content}>
                {activeTab === 'modpacks' && <ModpackBrowser hideHeader={true} />}
                {activeTab === 'mods' && <ModsManager hideHeader={true} instanceId={selectedInstanceId} />}
                {activeTab === 'resourcepacks' && <ResourcePacksManager hideHeader={true} instanceId={selectedInstanceId} />}
                {activeTab === 'shaderpacks' && <ShaderPacksManager hideHeader={true} instanceId={selectedInstanceId} />}
            </div>
        </div>
    );
};
