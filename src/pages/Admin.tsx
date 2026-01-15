import React, { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import styles from './Admin.module.css';
import { Shield, Users, Newspaper, Award, Plus, Trash2, Ban, UserCheck, Save, LayoutDashboard } from 'lucide-react';
import { ProfileService, UserProfile, Badge as BadgeType } from '../services/ProfileService';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useConfirm, usePrompt } from '../context/ConfirmContext';
import { useAuth } from '../context/AuthContext';
import { CustomSelect } from '../components/CustomSelect';

interface AdminProps {
    user: {
        name: string;
        uuid: string;
        role?: string;
    };
}

interface NewsItem {
    id: string;
    title: string;
    content: string;
    category: string;
    published: boolean;
    created_at: string;
    image_url?: string;
    color?: string;
    version?: string;
}

export const Admin: React.FC<AdminProps> = ({ user: propUser }) => {
    const { role: authRole, profile: authProfile } = useAuth();
    // Use auth context profile if available (realtime), otherwise prop
    const user = {
        name: authProfile?.username || propUser.name,
        uuid: authProfile?.id || propUser.uuid,
        role: authRole || propUser.role
    };

    // State definitions
    const [activeSection, setActiveSection] = useState<'badges' | 'users' | 'news'>('badges');
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();
    const confirm = useConfirm();
    const prompt = usePrompt();

    // Data State
    const [badges, setBadges] = useState<BadgeType[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [news, setNews] = useState<NewsItem[]>([]);

    // Form State
    const [newBadge, setNewBadge] = useState({ name: '', description: '', icon: 'Shield', color: '#ff9f43' });
    const [showBadgeForm, setShowBadgeForm] = useState(false);

    const [newNews, setNewNews] = useState({ title: '', content: '', category: 'update', image_url: '', color: '#ff8800', version: '' });
    const [showNewsForm, setShowNewsForm] = useState(false);

    const [grantForm, setGrantForm] = useState({ userId: '', badgeId: '' });

    // Permissions Check
    useEffect(() => {
        const check = async () => {
            // Instant check from context
            if (authRole === 'admin' || authRole === 'developer') {
                setIsAdmin(true);
                await loadData();
                setLoading(false);
                return;
            }

            // Fallback fetch (e.g. if context is slow or initial load)
            const adminStatus = await ProfileService.isAdmin(user.uuid);
            setIsAdmin(adminStatus);
            if (adminStatus) await loadData();
            setLoading(false);
        };
        check();
    }, [user.uuid, authRole]);

    const loadData = async () => {
        const [badgesData, usersData] = await Promise.all([
            ProfileService.getAllBadges(),
            ProfileService.getAllUsers()
        ]);
        setBadges(badgesData);
        setUsers(usersData);
        await loadNews();
    };

    const loadNews = async () => {
        const { data } = await supabase.from('news').select('*').order('created_at', { ascending: false });
        setNews(data || []);
    };

    // --- Badge Handlers ---
    const handleCreateBadge = async () => {
        if (!newBadge.name || !newBadge.description) return showToast('Fill all fields', 'error');

        if (await confirm('Create Badge', `Are you sure you want to create "${newBadge.name}"?`)) {
            const result = await ProfileService.createBadge(newBadge);
            if (result) {
                showToast('Badge created!', 'success');
                setBadges([...badges, result]);
                setNewBadge({ name: '', description: '', icon: 'Shield', color: '#ff9f43' });
                setShowBadgeForm(false);
            } else {
                showToast('Failed to create badge', 'error');
            }
        }
    };

    const handleGrantBadge = async () => {
        if (!grantForm.userId || !grantForm.badgeId) return showToast('Select user and badge', 'error');

        const badgeName = badges.find(b => b.id === grantForm.badgeId)?.name;
        const userName = users.find(u => u.id === grantForm.userId)?.username;

        if (await confirm('Grant Badge', `Grant "${badgeName}" to ${userName}?`)) {
            const success = await ProfileService.grantBadge(grantForm.userId, grantForm.badgeId, user.uuid);
            if (success) {
                showToast('Badge granted!', 'success');
                setGrantForm({ userId: '', badgeId: '' });
            } else {
                showToast('Failed to grant', 'error');
            }
        }
    };

    // --- User Handlers ---
    const handleBanUser = async (userId: string, currentBanned: boolean) => {
        if (currentBanned) {
            // Unban
            if (await confirm('Unban User', 'Are you sure you want to unban this user?')) {
                const success = await ProfileService.setUserBan(userId, false);
                if (success) {
                    showToast('User unbanned', 'success');
                    setUsers(users.map(u => u.id === userId ? { ...u, banned: false, ban_reason: undefined } : u));
                }
            }
        } else {
            // Ban
            const reason = await prompt('Ban User', 'Please enter a reason for the ban:', {
                inputConfig: { placeholder: 'Violation of terms...', defaultValue: 'Violation of rules' },
                isDanger: true,
                confirmLabel: 'Ban User'
            });

            if (reason) {
                const success = await ProfileService.setUserBan(userId, true, reason);
                if (success) {
                    showToast('User banned', 'success');
                    setUsers(users.map(u => u.id === userId ? { ...u, banned: true, ban_reason: reason } : u));
                }
            }
        }
    };

    const handleRoleChange = async (userId: string, newRole: 'user' | 'admin' | 'developer') => {
        const userName = users.find(u => u.id === userId)?.username;
        if (await confirm('Change Role', `Change ${userName}'s role to ${newRole}? This grants powerful permissions.`, { isDanger: newRole !== 'user' })) {
            const success = await ProfileService.setUserRole(userId, newRole);
            if (success) {
                showToast('Role updated', 'success');
                setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
            }
        }
    };

    // --- News Handlers ---
    const handleCreateNews = async () => {
        if (!newNews.title || !newNews.content) return showToast('Fill all fields', 'error');

        const { data, error } = await supabase.from('news').insert({
            ...newNews,
            author_id: user.uuid,
            published: true
        }).select().single();

        if (error) {
            showToast('Failed to post news', 'error');
        } else {
            showToast('News published!', 'success');
            setNews([data, ...news]);
            setNewNews({ title: '', content: '', category: 'update', image_url: '', color: '#ff8800', version: '' });
            setShowNewsForm(false);
        }
    };

    const handleDeleteNews = async (id: string) => {
        if (await confirm('Delete News', 'Are you sure? This cannot be undone.', { isDanger: true })) {
            const { error } = await supabase.from('news').delete().eq('id', id);
            if (!error) {
                setNews(news.filter(n => n.id !== id));
                showToast('News deleted', 'success');
            }
        }
    };

    if (loading) return <div className={styles.loading}>Loading Admin Panel...</div>;
    if (!isAdmin) return (
        <div className={styles.container}>
            <div className={styles.accessDenied}>
                <Shield size={64} color="#ff4757" />
                <h2>Access Restricted</h2>
                <p>Protected Area. Only authorized personnel allowed.</p>
            </div>
        </div>
    );

    const iconOptions = ['Shield', 'Gift', 'Code', 'Heart', 'Bug', 'Star', 'Award', 'Crown'];

    return (
        <div className={styles.container}>
            {/* Sidebar Navigation */}
            <div className={styles.sidebar}>
                <div className={styles.header}>
                    <LayoutDashboard size={24} color="#ff8800" />
                    <h2 className={styles.headerTitle}>Admin</h2>
                </div>
                <nav className={styles.nav}>
                    <button className={`${styles.navItem} ${activeSection === 'badges' ? styles.active : ''}`} onClick={() => setActiveSection('badges')}>
                        <Award size={18} /> Badges
                    </button>
                    <button className={`${styles.navItem} ${activeSection === 'users' ? styles.active : ''}`} onClick={() => setActiveSection('users')}>
                        <Users size={18} /> Users
                    </button>
                    <button className={`${styles.navItem} ${activeSection === 'news' ? styles.active : ''}`} onClick={() => setActiveSection('news')}>
                        <Newspaper size={18} /> News
                    </button>
                </nav>
            </div>

            {/* Main Content */}
            <div className={styles.content}>
                <PageHeader
                    title="Administration"
                    description="Manage badges, users, and launcher news updates."
                />

                {activeSection === 'badges' && (
                    <>
                        <div className={styles.sectionHeader}>
                            <button className={styles.actionBtn} onClick={() => setShowBadgeForm(!showBadgeForm)}>
                                <Plus size={18} /> New Badge
                            </button>
                        </div>

                        {showBadgeForm && (
                            <div className={styles.formCard}>
                                <h3>Create New Badge</h3>
                                <div className={styles.formGrid}>
                                    <input className={styles.input} placeholder="Name" value={newBadge.name} onChange={e => setNewBadge({ ...newBadge, name: e.target.value })} />
                                    <input className={styles.input} placeholder="Description" value={newBadge.description} onChange={e => setNewBadge({ ...newBadge, description: e.target.value })} />
                                </div>
                                <div className={styles.formGrid}>
                                    <CustomSelect
                                        value={newBadge.icon}
                                        onChange={(val) => setNewBadge({ ...newBadge, icon: val })}
                                        options={iconOptions.map(i => ({ value: i, label: i, icon: <Shield size={14} /> }))} // Simple icon mapping for now
                                        placeholder="Select Icon"
                                    />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span>Color:</span>
                                        <input type="color" className={styles.colorPicker} value={newBadge.color} onChange={e => setNewBadge({ ...newBadge, color: e.target.value })} />
                                    </div>
                                </div>
                                <button className={styles.actionBtn} onClick={handleCreateBadge}><Save size={16} /> Save Badge</button>
                            </div>
                        )}

                        <div className={styles.grid}>
                            {/* Grant Section */}
                            <div className={styles.card}>
                                <div className={styles.cardContent}>
                                    <span className={styles.cardTitle}>Grant Badges</span>
                                    <div className={styles.formGrid} style={{ marginTop: 10, marginBottom: 0 }}>
                                        <CustomSelect
                                            value={grantForm.userId}
                                            onChange={(val) => setGrantForm({ ...grantForm, userId: val })}
                                            options={users.map(u => ({ value: u.id, label: u.username }))}
                                            placeholder="Select User"
                                        />
                                        <CustomSelect
                                            value={grantForm.badgeId}
                                            onChange={(val) => setGrantForm({ ...grantForm, badgeId: val })}
                                            options={badges.map(b => ({ value: b.id, label: b.name }))}
                                            placeholder="Select Badge"
                                        />
                                    </div>
                                </div>
                                <div className={styles.cardActions}>
                                    <button className={styles.actionBtn} style={{ background: '#222', color: 'white', border: '1px solid #444' }} onClick={handleGrantBadge}>Grant</button>
                                </div>
                            </div>

                            {badges.map(badge => (
                                <div key={badge.id} className={styles.card}>
                                    <div className={styles.cardContent}>
                                        <span className={styles.badgePreview} style={{ borderColor: badge.color, color: badge.color }}>
                                            {badge.name}
                                        </span>
                                        <span className={styles.cardSub} style={{ marginLeft: 10 }}>{badge.description}</span>
                                    </div>
                                    <div className={styles.cardActions}>
                                        <button className={`${styles.iconBtn} ${styles.danger}`}><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {activeSection === 'users' && (
                    <>
                        <div className={styles.sectionHeader}>
                            <h2 className={styles.pageTitle}>User Directory</h2>
                            <div className={styles.searchBox}>
                                {/* Future Search Implementation */}
                            </div>
                        </div>

                        <div className={styles.grid}>
                            {users.map(u => (
                                <div key={u.id} className={`${styles.card} ${u.banned ? styles.banned : ''}`}>
                                    <div className={styles.cardContent}>
                                        <span className={styles.cardTitle}>
                                            {u.username}
                                            {u.banned && <span className={styles.banTag}>BANNED</span>}
                                        </span>
                                        <span className={styles.cardSub}>{u.email} • Joined {new Date(u.joined_at || Date.now()).toLocaleDateString()}</span>
                                    </div>
                                    <div className={styles.cardActions}>
                                        <CustomSelect
                                            value={u.role}
                                            onChange={(val) => handleRoleChange(u.id, val as any)}
                                            options={[
                                                { value: 'user', label: 'User' },
                                                { value: 'admin', label: 'Admin' },
                                                { value: 'developer', label: 'Dev' },
                                            ]}
                                            width={140}
                                        />
                                        <button
                                            className={`${styles.iconBtn} ${u.banned ? '' : styles.danger}`}
                                            title={u.banned ? "Unban" : "Ban"}
                                            onClick={() => handleBanUser(u.id, u.banned || false)}
                                        >
                                            {u.banned ? <UserCheck size={18} /> : <Ban size={18} />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {activeSection === 'news' && (
                    <>
                        <div className={styles.sectionHeader}>
                            <button className={styles.actionBtn} onClick={() => setShowNewsForm(!showNewsForm)}>
                                <Plus size={18} /> New Post
                            </button>
                        </div>

                        {showNewsForm && (
                            <div className={styles.formCard}>
                                <h3>Create Post</h3>
                                <div className={styles.formGrid}>
                                    <input className={styles.input} placeholder="Title" value={newNews.title} onChange={e => setNewNews({ ...newNews, title: e.target.value })} />
                                    <CustomSelect
                                        value={newNews.category}
                                        onChange={(val) => setNewNews({ ...newNews, category: val })}
                                        options={[
                                            { value: 'update', label: 'Update' },
                                            { value: 'feature', label: 'Feature' },
                                            { value: 'bugfix', label: 'Bug Fix' },
                                            { value: 'announcement', label: 'Announcement' },
                                        ]}
                                    />
                                </div>
                                <textarea className={styles.textarea} rows={6} placeholder="Content (Markdown supported)" value={newNews.content} onChange={e => setNewNews({ ...newNews, content: e.target.value })} />
                                <div className={styles.formGrid} style={{ marginTop: 16 }}>
                                    {newNews.category === 'update' && (
                                        <input
                                            className={styles.input}
                                            placeholder="Version (e.g. v1.0.5)"
                                            value={newNews.version}
                                            onChange={e => setNewNews({ ...newNews, version: e.target.value })}
                                        />
                                    )}
                                    <input className={styles.input} placeholder="Image URL (optional)" value={newNews.image_url} onChange={e => setNewNews({ ...newNews, image_url: e.target.value })} />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span>Accent:</span>
                                        <input type="color" className={styles.colorPicker} value={newNews.color} onChange={e => setNewNews({ ...newNews, color: e.target.value })} />
                                    </div>
                                </div>
                                <button className={styles.actionBtn} style={{ marginTop: 16 }} onClick={handleCreateNews}><Save size={16} /> Publish Post</button>
                            </div>
                        )}

                        <div className={styles.grid}>
                            {news.map(item => (
                                <div key={item.id} className={styles.card} style={{ borderLeft: `4px solid ${item.color || '#ff8800'}` }}>
                                    <div className={styles.cardContent}>
                                        <span className={styles.cardTitle}>{item.title}</span>
                                        <span className={styles.cardSub}>{item.category} • {new Date(item.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <div className={styles.cardActions}>
                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDeleteNews(item.id)}>
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

            </div>
        </div>
    );
};
