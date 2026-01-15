import React, { useRef } from 'react';
import styles from './Sidebar.module.css';
import { Home, Folder, Settings, LogOut, Globe, Package, Newspaper, Users, Code, ShieldAlert, User } from 'lucide-react';
import logo from '../assets/logo.png';
import { supabase } from '../lib/supabase';
import { UserAvatar } from './UserAvatar';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    user: {
        name: string;
        uuid: string;
        token: string;
        role?: 'developer' | 'admin' | 'user' | 'other';
    };
    onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, user, onLogout }) => {
    // Get real-time role from Supabase Auth Context
    const { role: realtimeRole } = useAuth();

    // Role Configuration
    // Prioritize real-time role, fallback to prop (for offline/initial state)
    const role = (realtimeRole || user.role || 'user') as 'developer' | 'admin' | 'user' | 'other';
    const roleConfig = {
        developer: { label: 'Developer', color: '#00a8ff', icon: Code },
        admin: { label: 'Admin', color: '#ff4757', icon: ShieldAlert },
        user: { label: 'Member', color: '#7f8c8d', icon: User },
        other: { label: 'Guest', color: '#7f8c8d', icon: User }
    };
    const currentRole = roleConfig[role] || roleConfig.user;
    const RankIcon = currentRole.icon;

    const tabs = [
        { id: 'home', label: 'Home', icon: Home },
        { id: 'profiles', label: 'Profiles', icon: Folder },
        { id: 'mods', label: 'Mods', icon: Package },
        { id: 'modpacks', label: 'Modpacks', icon: Globe },
        { id: 'friends', label: 'Friends', icon: Users, beta: true },
        { id: 'news', label: 'News', icon: Newspaper },
        { id: 'settings', label: 'Settings', icon: Settings },
        // Admin tab - only visible to developers/admins
        ...(role === 'developer' || role === 'admin' ? [{ id: 'admin', label: 'Admin', icon: ShieldAlert }] : []),
    ];

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSkinUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !user.uuid) return;

        // Basic validation
        if (file.type !== 'image/png') {
            alert('Please select a PNG file.');
            return;
        }

        try {
            console.log('Uploading skin for', user.uuid);
            const { error } = await supabase.storage
                .from('skins')
                .upload(`${user.uuid}.png`, file, {
                    upsert: true,
                    contentType: 'image/png',
                    cacheControl: '3600'
                });

            if (error) {
                console.error('Upload error:', error);
                alert('Failed to upload skin: ' + error.message);
            } else {
                alert('Skin uploaded successfully! It will appear in-game next launch.');
                // Optional: Force reload logic could go here
            }
        } catch (err) {
            console.error('Upload exception:', err);
            alert('An unexpected error occurred.');
        } finally {
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className={styles.sidebar}>
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".png"
                onChange={handleSkinUpload}
            />
            <div className={styles.logoArea}>
                <img src={logo} alt="Whoap" className={styles.logoImg} />
                <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: '2px' }}>
                    <span className={styles.logoText}>Whoap</span>
                    <span className={styles.logoRank} style={{ color: currentRole.color }}>{currentRole.label}</span>
                </div>
            </div>

            <nav className={styles.nav}>
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                            onClick={() => onTabChange(tab.id)}
                        >
                            <span className={styles.icon}>
                                <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                            </span>
                            <span className={styles.label}>
                                {tab.label}
                                {tab.beta && <span className={styles.betaBadge}>BETA</span>}
                            </span>
                            {isActive && <div className={styles.activeIndicator} />}
                        </button>
                    );
                })}
            </nav>

            <div
                className={`${styles.userProfile} ${activeTab === 'profile' ? styles.activeProfile : ''}`}
                onClick={() => onTabChange('profile')}
                style={{ cursor: 'pointer' }}
            >
                <div
                    className={styles.avatarHead}
                    onClick={(e) => {
                        e.stopPropagation(); // Prevent tab change
                        fileInputRef.current?.click();
                    }}
                    title="Click to upload custom skin"
                    style={{ cursor: 'pointer' }}
                >
                    <UserAvatar
                        username={user.name}
                        uuid={user.uuid}
                        accountType={(user as any).type}
                        className={styles.sidebarAvatar}
                    />
                </div>
                <div className={styles.userInfo}>
                    <div className={styles.userName}>{user.name}</div>

                    {/* Rank Display */}
                    <div className={styles.userRole} style={{ color: currentRole.color }}>
                        <RankIcon size={12} strokeWidth={2.5} />
                        {currentRole.label}
                    </div>
                </div>
                {onLogout && (
                    <button className={styles.logoutBtn} onClick={(e) => { e.stopPropagation(); onLogout(); }} title="Logout">
                        <LogOut size={18} />
                    </button>
                )}
            </div>
        </div>
    );
};
