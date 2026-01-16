import React, { useRef, useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import styles from './Profile.module.css';
import { SkinViewer, WalkingAnimation } from 'skinview3d';
import { Trash2, Pause, Play, RotateCcw, Shield, Gift, Code, Heart, Bug, LucideIcon } from 'lucide-react';
import { Badge } from '../components/Badge';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabase';
import { ProfileService, Badge as BadgeType } from '../services/ProfileService';

// Icon mapping for dynamic badge rendering
const iconMap: Record<string, LucideIcon> = {
    Shield, Gift, Code, Heart, Bug
};

interface ProfileProps {
    user: {
        name: string;
        uuid: string;
        token: string;
        type: 'microsoft' | 'offline' | 'whoap';
    };
}

export const Profile: React.FC<ProfileProps> = ({ user }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewerRef = useRef<SkinViewer | null>(null);
    const [skinUrl, setSkinUrl] = useState(`https://mc-heads.net/skin/${user.name}`);
    const [capeUrl, setCapeUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSlim, setIsSlim] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [showElytra, setShowElytra] = useState(false);
    const [playtime, setPlaytime] = useState(0);
    const [badges, setBadges] = useState<BadgeType[]>([]);
    const [badgesLoading, setBadgesLoading] = useState(true);
    const { showToast } = useToast();

    // Initialize skin viewer
    useEffect(() => {
        const init = async () => {
            if (canvasRef.current && !viewerRef.current) {
                viewerRef.current = new SkinViewer({
                    canvas: canvasRef.current,
                    width: 280,
                    height: 380,
                });

                viewerRef.current.animation = new WalkingAnimation();
                viewerRef.current.autoRotate = true;
                viewerRef.current.autoRotateSpeed = 0.8;

                await Promise.all([loadCapeFromStorage(), loadSkinFromStorage()]);

                // Load both onto the viewer and wait
                const loadPromises: Promise<any>[] = [];
                loadPromises.push(viewerRef.current.loadSkin(skinUrl, { model: isSlim ? 'slim' : 'default' }));
                if (capeUrl) {
                    loadPromises.push(viewerRef.current.loadCape(capeUrl));
                }

                await Promise.all(loadPromises);
                setIsLoading(false);
            }
        };
        init();

        return () => {
            if (viewerRef.current) {
                viewerRef.current.dispose();
                viewerRef.current = null;
            }
        };
    }, []);

    useEffect(() => { loadPlaytime(); }, []);

    // Real-time Badges Subscription
    useEffect(() => {
        loadBadges();

        const channel = supabase
            .channel('public:user_badges')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'user_badges',
                    filter: `user_id=eq.${user.uuid}`
                },
                (payload) => {
                    console.log('[Profile] Badges changed:', payload);
                    loadBadges();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user.uuid]);

    const loadBadges = async () => {
        setBadgesLoading(true);
        const userBadges = await ProfileService.getUserBadges(user.uuid);
        setBadges(userBadges);
        setBadgesLoading(false);
    };

    useEffect(() => {
        if (viewerRef.current) {
            viewerRef.current.loadSkin(skinUrl, { model: isSlim ? 'slim' : 'default' });
        }
    }, [skinUrl, isSlim]);

    useEffect(() => {
        if (viewerRef.current && capeUrl) {
            viewerRef.current.loadCape(capeUrl);
        }
    }, [capeUrl]);

    const loadCapeFromStorage = async () => {
        try {
            const { data } = supabase.storage.from('capes').getPublicUrl(`${user.uuid}.png`);
            const response = await fetch(data.publicUrl, { method: 'HEAD' });
            if (response.ok) {
                setCapeUrl(data.publicUrl + '?t=' + Date.now());
            }
        } catch (e) { console.log('No cape found'); }
    };

    const loadSkinFromStorage = async () => {
        try {
            const { data } = supabase.storage.from('skins').getPublicUrl(`${user.uuid}.png`);
            const response = await fetch(data.publicUrl, { method: 'HEAD' });
            if (response.ok) {
                setSkinUrl(data.publicUrl + '?t=' + Date.now());
            }
        } catch (e) { console.log('No custom skin found'); }
    };

    const loadPlaytime = async () => {
        try {
            const { data } = await supabase.from('user_stats').select('playtime_minutes').eq('user_id', user.uuid).single();
            if (data) setPlaytime(data.playtime_minutes);
        } catch (e) { console.log('No playtime data'); }
    };

    const formatPlaytime = (minutes: number) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    };

    const handleSkinUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (user.type !== 'whoap') {
            showToast('Only Whoap accounts can upload skins', 'warning');
            return;
        }
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.name.endsWith('.png')) { showToast('Only .png files allowed', 'error'); return; }

        // Sanity check: Ensure we have a session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            showToast('Session expired. Please re-login.', 'error');
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        setSkinUrl(objectUrl);

        setIsUploading(true);
        try {
            const { error } = await supabase.storage.from('skins').upload(`${user.uuid}.png`, file, {
                upsert: true,
                cacheControl: '0'
            });

            if (error) {
                console.error("[Profile] Skin upload error details:", error);
                throw error;
            }

            showToast('Skin uploaded!', 'success');
        } catch (e: any) {
            showToast(`Upload failed: ${e.message}`, 'error');
            console.error("[Profile] Upload failed trace:", e);
        }
        finally { setIsUploading(false); }
    };

    const handleCapeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (user.type !== 'whoap') {
            showToast('Only Whoap accounts can upload capes', 'warning');
            return;
        }
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.name.endsWith('.png')) { showToast('Only .png files allowed', 'error'); return; }

        // Sanity check: Ensure we have a session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            showToast('Session expired. Please re-login.', 'error');
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        setCapeUrl(objectUrl);

        setIsUploading(true);
        try {
            const { error } = await supabase.storage.from('capes').upload(`${user.uuid}.png`, file, {
                upsert: true,
                cacheControl: '0'
            });

            if (error) {
                console.error("[Profile] Cape upload error details:", error);
                throw error;
            }

            showToast('Cape uploaded!', 'success');
        } catch (e: any) {
            showToast(`Upload failed: ${e.message}`, 'error');
            console.error("[Profile] Upload failed trace:", e);
        }
        finally { setIsUploading(false); }
    };

    const handleDeleteSkin = () => {
        if (user.type !== 'whoap') return;
        setSkinUrl(`https://mc-heads.net/skin/${user.name}`);
        showToast('Skin reset to default', 'info');
    };

    const handleDeleteCape = () => {
        if (user.type !== 'whoap') return;
        setCapeUrl(null);
        if (viewerRef.current) viewerRef.current.loadCape(null);
        showToast('Cape removed', 'info');
    };

    const toggleElytra = () => {
        if (viewerRef.current && capeUrl) {
            const newState = !showElytra;
            setShowElytra(newState);
            // skinview3d supports elytra via playerObject
            if (viewerRef.current.playerObject) {
                viewerRef.current.playerObject.backEquipment = newState ? 'elytra' : 'cape';
            }
        }
    };

    const toggleAnimation = () => {
        if (viewerRef.current) {
            if (isPaused) {
                viewerRef.current.animation = new WalkingAnimation();
                viewerRef.current.autoRotate = true;
            } else {
                viewerRef.current.animation = null;
                viewerRef.current.autoRotate = false;
            }
            setIsPaused(!isPaused);
        }
    };

    return (
        <div className={styles.container}>
            <PageHeader
                title="Profile"
                description="Manage your skins, capes, and view your achievements."
            />

            <div className={styles.layout}>
                {/* Left Panel - Controls */}
                <div className={styles.controlsPanel}>
                    {/* In-game Profile Section */}
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>In-game profile</div>
                        <div className={styles.field}>
                            <label className={styles.fieldLabel}>Username</label>
                            <div className={styles.usernameDisplay}>{user.name}</div>
                        </div>
                        <div className={styles.field}>
                            <label className={styles.fieldLabel}>Whoap UUID</label>
                            <div className={styles.uuidDisplay} onClick={() => {
                                navigator.clipboard.writeText(user.uuid);
                                showToast('UUID copied to clipboard', 'success');
                            }} title="Click to copy">
                                {user.uuid}
                            </div>
                        </div>

                        <div className={styles.fieldHint}>
                            Playtime: {formatPlaytime(playtime)}
                        </div>
                    </section>

                    {/* Achievement Badges Section */}
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>Badges</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {badgesLoading ? (
                                <span style={{ color: '#666', fontSize: '0.85rem' }}>Loading badges...</span>
                            ) : badges.length > 0 ? (
                                badges.map(badge => (
                                    <Badge
                                        key={badge.id}
                                        icon={iconMap[badge.icon] || Shield}
                                        name={badge.name}
                                        description={badge.description}
                                        color={badge.color}
                                    />
                                ))
                            ) : (
                                <span style={{ color: '#666', fontSize: '0.85rem' }}>No badges earned yet</span>
                            )}
                        </div>
                    </section>

                    {/* Appearance Customization Section */}
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>In-game appearance customization</div>

                        {/* Skin Upload */}
                        <div className={styles.uploadRow}>
                            <div className={styles.uploadLabel}>Skin</div>
                            <div className={styles.uploadControls}>
                                <label className={`${styles.chooseBtn} ${isUploading || user.type !== 'whoap' ? styles.disabled : ''}`} title={user.type !== 'whoap' ? 'Whoap account required' : ''}>
                                    {isUploading ? 'Uploading...' : 'Choose Skin'}
                                    <input type="file" accept=".png" onChange={handleSkinUpload} hidden disabled={isUploading || user.type !== 'whoap'} />
                                </label>
                                <button className={styles.deleteBtn} onClick={handleDeleteSkin} disabled={isUploading || user.type !== 'whoap'}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>

                        {user.type !== 'whoap' && (
                            <div className={styles.accountNotice}>
                                <Shield size={12} /> Whoap account required for custom skins/capes
                            </div>
                        )}

                        {/* Cape Upload */}
                        <div className={styles.uploadRow}>
                            <div className={styles.uploadLabel}>Cape</div>
                            <div className={styles.uploadControls}>
                                <label className={`${styles.chooseBtn} ${user.type !== 'whoap' ? styles.disabled : ''}`} title={user.type !== 'whoap' ? 'Whoap account required' : ''}>
                                    Choose Cape
                                    <input type="file" accept=".png" onChange={handleCapeUpload} hidden disabled={user.type !== 'whoap'} />
                                </label>
                                <button className={styles.deleteBtn} onClick={handleDeleteCape} disabled={user.type !== 'whoap'}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Slim Toggle */}
                        <div className={styles.slimToggle}>
                            <input
                                type="checkbox"
                                id="slimModel"
                                checked={isSlim}
                                onChange={() => setIsSlim(!isSlim)}
                                className={styles.checkbox}
                            />
                            <label htmlFor="slimModel" className={styles.slimLabel}>
                                <strong>Slim</strong> (Alex)
                            </label>
                        </div>
                    </section>
                </div>

                {/* Right Panel - 3D Preview */}
                <div className={styles.previewPanel}>
                    <div className={styles.canvasContainer}>
                        {isLoading && (
                            <div className={styles.loadingOverlay}>
                                <div className={styles.spinner}></div>
                                <span style={{ color: '#888', fontSize: '12px' }}>Loading 3D Model...</span>
                            </div>
                        )}
                        <canvas ref={canvasRef} className={styles.skinCanvas} style={{ opacity: isLoading ? 0.3 : 1 }} />
                    </div>
                    <div className={styles.previewControls}>
                        <button className={styles.controlBtn} onClick={toggleAnimation} title={isPaused ? 'Play' : 'Pause'}>
                            {isPaused ? <Play size={16} /> : <Pause size={16} />}
                        </button>
                        <button className={styles.controlBtn} onClick={() => {
                            if (viewerRef.current) viewerRef.current.autoRotateSpeed *= -1;
                        }} title="Reverse rotation">
                            <RotateCcw size={16} />
                        </button>
                    </div>
                    <div className={styles.elytraToggle}>
                        <input
                            type="checkbox"
                            id="showElytra"
                            checked={showElytra}
                            onChange={toggleElytra}
                            className={styles.checkbox}
                            disabled={!capeUrl}
                        />
                        <label htmlFor="showElytra" className={styles.elytraLabel}>
                            Show Elytra
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
};
