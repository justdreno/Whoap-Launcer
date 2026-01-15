import React, { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import styles from './Home.module.css';
import { InstanceApi, Instance } from '../api/instances';
import { LaunchApi } from '../api/launch';
import { NetworkApi, ServerStatus } from '../api/network';
import { ChevronDown, Rocket, Clock, Layers, Star, Globe, Search, Wifi, WifiOff, Users as UsersIcon } from 'lucide-react';
import heroBg from '../assets/background.png';
import loginBg from '../assets/login_bg.png';
import { useToast } from '../context/ToastContext';
import { UserAvatar } from '../components/UserAvatar';
import { CreateInstanceModal } from '../components/CreateInstanceModal';

interface HomeProps {
    user: {
        name: string;
        uuid: string;
        token: string;
    };
}

export const Home: React.FC<HomeProps> = ({ user }) => {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
    const [showInstanceDropdown, setShowInstanceDropdown] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const { showToast } = useToast();

    // Launch State
    const [isLaunching, setIsLaunching] = useState(false);
    const [launchStatus, setLaunchStatus] = useState('');
    const [launchProgress, setLaunchProgress] = useState(0);

    // Server Status Widget State
    const [serverIp, setServerIp] = useState('');
    const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
    const [statusLoading, setStatusLoading] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            const list = await InstanceApi.list();
            setInstances(list);
            if (list.length > 0) {
                // Auto-select the most recently played instance
                const mostRecent = [...list].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0];
                setSelectedInstance(mostRecent);
            }
        };
        loadData();

        // Listen for launch progress
        const handleProgress = (_event: any, data: any) => {
            setLaunchStatus(data.status);
            if (data.total > 0) {
                setLaunchProgress((data.progress / data.total) * 100);
            }
        };
        window.ipcRenderer.on('launch:progress', handleProgress);

        return () => {
            // Cleanup listener if possible
        }
    }, []);

    const handleToggleFavorite = async (e: React.MouseEvent, inst: Instance) => {
        e.stopPropagation();
        await InstanceApi.toggleFavorite(inst.id);
        const list = await InstanceApi.list();
        setInstances(list);
    };

    const handleCreated = async () => {
        const list = await InstanceApi.list();
        setInstances(list);
        if (list.length > 0) {
            setSelectedInstance(list[0]);
        }
    };

    const handleLaunch = async () => {
        if (!selectedInstance || isLaunching) return;

        setIsLaunching(true);
        setLaunchStatus('Preparing launch...');
        setLaunchProgress(0);

        try {
            const result = await LaunchApi.launch(selectedInstance, user);
            if (!result.success) {
                showToast(`Launch Failed: ${result.error}`, 'error');
                setIsLaunching(false);
            } else {
                // Update Last Played
                await InstanceApi.updateLastPlayed(selectedInstance.id);
                // Refresh list to update times
                const list = await InstanceApi.list();
                setInstances(list);

                setLaunchStatus('Game running...');
                setTimeout(() => setIsLaunching(false), 5000);
            }
        } catch (e) {
            console.error(e);
            setIsLaunching(false);
            showToast('An unexpected error occurred during launch.', 'error');
        }
    };

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning,';
        if (hour < 18) return 'Good Afternoon,';
        return 'Good Evening,';
    };

    const formatDate = (dateStr: string) => {
        try {
            if (!dateStr) return 'Never';
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return 'Invalid';
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return 'Error';
        }
    };

    const getLoaderDisplay = (loader: string) => {
        const map: Record<string, string> = {
            'fabric': 'F',
            'forge': 'Fg',
            'vanilla': 'V'
        };
        return map[loader.toLowerCase()] || loader.charAt(0).toUpperCase();
    };

    const handleCheckStatus = async () => {
        if (!serverIp.trim()) return;
        setStatusLoading(true);
        try {
            const status = await NetworkApi.getServerStatus(serverIp.trim());
            setServerStatus(status);
        } catch (e) {
            console.error(e);
            showToast('Failed to fetch server status.', 'error');
        } finally {
            setStatusLoading(false);
        }
    };

    // Computed Lists
    const recentInstances = [...instances]
        .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
        // Deduplicate just in case
        .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
        .slice(0, 4);

    const mostRecentInstance = recentInstances.length > 0 ? recentInstances[0] : null;
    const activeInstance = selectedInstance || mostRecentInstance;

    // Skin preloading removed as UserAvatar handles it


    // Auto-select on first load


    return (
        <div className={styles.container}>
            <PageHeader
                title="Home"
                description={`Welcome back, ${user.name}. Ready for your next adventure?`}
            />

            {/* Hero Section */}
            <div className={styles.hero}>
                {/* Background Image with Fade */}
                <div className={styles.heroBg} style={{ backgroundImage: `url(${heroBg})` }}></div>
                <div className={styles.heroContent}>
                    <div className={styles.greeting}>{getGreeting()} {user.name}</div>

                    {/* Title Area with Dropdown */}
                    <div className={styles.titleRow}>
                        <div
                            className={styles.heroTitle}
                            onClick={() => !isLaunching && setShowInstanceDropdown(!showInstanceDropdown)}
                            style={{ cursor: 'pointer' }}
                        >
                            {activeInstance ? (
                                <>Ready to jump back into <span className={styles.profileHighlight}>{activeInstance.name}</span>?</>
                            ) : "Let's create your adventure."}
                        </div>
                        <div
                            style={{
                                background: 'rgba(255,255,255,0.1)',
                                borderRadius: '50%',
                                padding: 4,
                                cursor: 'pointer',
                                display: 'flex',
                                transition: 'all 0.2s',
                                transform: showInstanceDropdown ? 'rotate(180deg)' : 'rotate(0deg)'
                            }}
                            onClick={() => !isLaunching && setShowInstanceDropdown(!showInstanceDropdown)}
                        >
                            <ChevronDown size={20} color="white" />
                        </div>

                        {/* Instance Dropdown - Redesigned */}
                        {showInstanceDropdown && (
                            <div className={styles.instanceDropdown} style={{ top: 'calc(100% + 12px)', left: 0, width: 340 }}>
                                {instances.map(inst => (
                                    <div
                                        key={inst.id}
                                        className={styles.instanceOption}
                                        onClick={() => {
                                            setSelectedInstance(inst);
                                            setShowInstanceDropdown(false);
                                        }}
                                    >
                                        <div className={styles.loaderBadge}>
                                            {getLoaderDisplay(inst.loader)}
                                        </div>
                                        <div style={{ flex: 1, overflow: 'hidden' }}>
                                            <div className={styles.instanceName}>{inst.name}</div>
                                            <div style={{ fontSize: '11px', color: '#666', marginTop: 2 }}>
                                                {inst.version}
                                            </div>
                                        </div>
                                        <div onClick={(e) => handleToggleFavorite(e, inst)} style={{ flexShrink: 0 }}>
                                            <Star
                                                size={16}
                                                fill={inst.isFavorite ? "#ffaa00" : "none"}
                                                color={inst.isFavorite ? "#ffaa00" : "#666"}
                                                style={{ transition: 'all 0.2s' }}
                                            />
                                        </div>
                                    </div>
                                ))}
                                {instances.length === 0 && (
                                    <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                                        No profiles found
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {selectedInstance && (
                        <div className={styles.lastPlayed}>
                            <Clock size={14} color="#aaa" />
                            <span style={{ fontSize: '13px', color: '#ccc' }}>
                                Last played {selectedInstance.lastPlayed > 0 ? formatDate(new Date(selectedInstance.lastPlayed).toISOString()) : 'Never'}
                            </span>
                        </div>
                    )}

                    <div className={styles.actionContainer}>
                        <button
                            className={`${styles.playBtn} ${isLaunching ? styles.launching : ''}`}
                            onClick={async () => {
                                if (instances.length === 0) {
                                    setShowCreateModal(true);
                                    return;
                                }
                                console.log('Launch button clicked, selectedInstance:', selectedInstance);
                                if (selectedInstance) {
                                    await InstanceApi.updateLastPlayed(selectedInstance.id);
                                    handleLaunch();
                                }
                            }}
                            disabled={isLaunching || (!selectedInstance && instances.length > 0)}
                        >
                            {isLaunching ? (
                                <div className={styles.launchContent}>
                                    <div className={styles.statusText}>
                                        <span className={styles.statusTitle}>{launchStatus}</span>
                                        <span className={styles.statusPercent}>{Math.round(launchProgress)}%</span>
                                    </div>
                                    <div className={styles.progressBarBg}>
                                        <div
                                            className={styles.progressBarFill}
                                            style={{ width: `${launchProgress}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <Rocket size={20} style={{ marginRight: 8 }} />
                                    {instances.length === 0 ? 'CREATE PROFILE' : selectedInstance ? 'LAUNCH' : 'SELECT PROFILE'}
                                </>
                            )}
                        </button>
                    </div>
                    <UserAvatar
                        username={user.name}
                        uuid={user.uuid}
                        accountType={(user as any).type}
                        variant="body"
                        className={styles.heroImage}
                    />
                </div>
            </div>

            {/* Widgets Section */}
            <div className={styles.widgetsGrid}>
                {/* Stats Widget */}
                <div className={styles.statsRow}>
                    <div className={styles.statCard}>
                        <div className={styles.statIcon}><Layers /></div>
                        <div className={styles.statInfo}>
                            <div className={styles.statValue}>{instances.length}</div>
                            <div className={styles.statLabel}>Total Profiles</div>
                        </div>
                    </div>
                    <div className={styles.statCard}>
                        <div className={styles.statIcon}><Star /></div>
                        <div className={styles.statInfo}>
                            <div className={styles.statValue}>{instances.filter(i => i.isFavorite).length}</div>
                            <div className={styles.statLabel}>Favorites</div>
                        </div>
                    </div>
                    <div className={styles.statCard}>
                        <div className={styles.statIcon}><Globe /></div>
                        <div className={styles.statInfo}>
                            <div className={styles.statValue}>{instances.filter(i => i.isImported).length}</div>
                            <div className={styles.statLabel}>Imported</div>
                        </div>
                    </div>
                </div>

            </div>

            {/* Server Status Widget - New Hero Style */}
            <div className={styles.serverWidgetHero}>
                <div className={styles.heroBg} style={{ backgroundImage: `url(${loginBg})` }}></div>
                <div className={styles.serverWidgetContent}>
                    <div className={styles.widgetHeader}>
                        <div className={styles.greeting}>Server Monitoring</div>
                        <div className={styles.titleRow}>
                            <div className={styles.heroTitle}>
                                Check <span className={styles.profileHighlight}>Any Server</span> Status
                            </div>
                            {serverStatus && (
                                <div className={`${styles.statusChip} ${serverStatus.online ? styles.online : styles.offline}`}>
                                    {serverStatus.online ? <Wifi size={14} /> : <WifiOff size={14} />}
                                    {serverStatus.online ? 'Online' : 'Offline'}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={styles.serverActionRow}>
                        <div className={styles.serverInputGroup}>
                            <input
                                type="text"
                                placeholder="Enter server IP (e.g. play.hypixel.net)"
                                value={serverIp}
                                onChange={(e) => setServerIp(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCheckStatus()}
                                className={styles.serverInputHero}
                            />
                            <button
                                onClick={handleCheckStatus}
                                className={styles.checkBtnHero}
                                disabled={statusLoading}
                            >
                                {statusLoading ? <div className={styles.spinner}></div> : <Search size={20} />}
                            </button>
                        </div>

                        {serverStatus && serverStatus.online && (
                            <div className={styles.statusResultHero}>
                                {serverStatus.icon && (
                                    <img src={serverStatus.icon} className={styles.serverIconHero} alt="Server Icon" />
                                )}
                                <div className={styles.serverInfoHero}>
                                    <div className={styles.serverMotdHero}>{serverStatus.motd}</div>
                                    <div className={styles.serverDetailsHero}>
                                        <span>
                                            <UsersIcon size={14} style={{ marginRight: 4 }} />
                                            <strong>{serverStatus.players?.online}</strong> / {serverStatus.players?.max}
                                        </span>
                                        <span className={styles.verBadgeHero}>{serverStatus.version}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {!serverStatus && !statusLoading && (
                            <div className={styles.serverPlaceholderHero}>
                                <Globe size={18} style={{ opacity: 0.5 }} />
                                <span>Enter an IP to ping the server</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Recent Profiles - Full Width */}
            <div>
                <div className={styles.sectionTitle}><Clock size={18} /> Recent Profiles</div>
                <div className={styles.grid}>
                    {recentInstances.map(inst => (
                        <div
                            key={inst.id}
                            className={styles.miniCard}
                            style={selectedInstance?.id === inst.id ? { borderColor: '#ff8800', background: 'rgba(255, 136, 0, 0.1)' } : {}}
                            onClick={() => setSelectedInstance(inst)}
                        >
                            <div className={styles.miniIcon}>
                                {getLoaderDisplay(inst.loader)}
                            </div>
                            <div className={styles.miniInfo}>
                                <div className={styles.miniName}>{inst.name}</div>
                                <div className={styles.miniVer}>{inst.version} • {inst.loader}</div>
                            </div>
                            <div onClick={(e) => handleToggleFavorite(e, inst)} style={{ cursor: 'pointer' }}>
                                <Star size={14} fill={inst.isFavorite ? "#ffaa00" : "none"} color={inst.isFavorite ? "#ffaa00" : "#666"} />
                            </div>
                        </div>
                    ))}
                    {instances.length === 0 && <div style={{ color: '#666' }}>No profiles yet.</div>}
                </div>
            </div>


            {
                showCreateModal && (
                    <CreateInstanceModal
                        onClose={() => setShowCreateModal(false)}
                        onCreated={handleCreated}
                    />
                )
            }
        </div >
    );
};