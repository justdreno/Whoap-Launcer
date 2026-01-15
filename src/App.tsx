import { useState, useEffect, lazy, Suspense } from 'react'
import { MainLayout } from './layouts/MainLayout'
import { LoadingScreen } from './components/LoadingScreen'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './context/ToastContext'
import { Toaster } from 'react-hot-toast'
import { ConfirmProvider } from './context/ConfirmContext'
import { supabase } from './lib/supabase';
import { Skeleton } from './components/Skeleton';
import { perf } from './utils/PerformanceProfiler';

// Mark app module load time
perf.mark('App module loaded');

// Eager-load critical path components
import { Home } from './pages/Home';
import { Login } from './pages/Login';

// Lazy-load non-critical pages for faster startup
const Instances = lazy(() => import('./pages/Instances').then(m => ({ default: m.Instances })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const ModpackBrowser = lazy(() => import('./pages/ModpackBrowser').then(m => ({ default: m.ModpackBrowser })));
const ModsManager = lazy(() => import('./pages/ModsManager').then(m => ({ default: m.ModsManager })));
const News = lazy(() => import('./pages/News').then(m => ({ default: m.News })));
const Friends = lazy(() => import('./pages/Friends').then(m => ({ default: m.Friends })));
const Profile = lazy(() => import('./pages/Profile').then(m => ({ default: m.Profile })));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const Screenshots = lazy(() => import('./pages/Screenshots').then(m => ({ default: m.Screenshots })));

// Fallback component for lazy loading
const PageLoader = () => (
    <div style={{ padding: 40 }}>
        <Skeleton width="200px" height="32px" style={{ marginBottom: 16 }} />
        <Skeleton width="100%" height="200px" />
    </div>
);

function App() {
    const [showSplash, setShowSplash] = useState(true);
    const [activeTab, setActiveTab] = useState('home');
    const [user, setUser] = useState<any>(null);
    const [checkingSession, setCheckingSession] = useState(true);
    const [isOnline, setIsOnline] = useState(true);

    // Check for existing session on startup and listen for changes
    useEffect(() => {
        const checkSession = async () => {
            try {
                // Timeout after 3 seconds if backend is slow/hung
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Session check timed out")), 3000));
                const sessionPromise = window.ipcRenderer.invoke('auth:get-session');

                const result: any = await Promise.race([sessionPromise, timeoutPromise]);

                if (result && result.success && result.profile) {
                    // Fetch role from database dynamically
                    let role = 'user';
                    if (result.profile.type === 'whoap') {
                        try {
                            const { ProfileService } = await import('./services/ProfileService');
                            role = await ProfileService.getRole(result.profile.uuid);
                        } catch (e) {
                            console.warn("[App] Could not fetch role, defaulting to 'user'");
                        }
                    }

                    setUser({
                        name: result.profile.name,
                        uuid: result.profile.uuid,
                        token: result.profile.token,
                        type: result.profile.type, // Capture auth type (supabase, microsoft, offline)
                        role: role
                    });

                    // Sync Supabase session if it's a whoap account
                    if (result.profile.type === 'whoap' && result.profile.token) {
                        const { CloudManager } = await import('./utils/CloudManager');
                        CloudManager.syncSession(result.profile.token, result.profile.refreshToken);
                    }
                }
            } catch (e) {
                console.error("[App] Session check failed or timed out", e);
            } finally {
                setCheckingSession(false);
            }
        };

        checkSession();

        // Listen for auth state changes (especially token refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                if (session) {
                    const { AccountManager } = await import('./utils/AccountManager');

                    // Update user state
                    setUser((prev: any) => ({
                        ...prev,
                        token: session.access_token,
                        uuid: session.user.id,
                        name: session.user.user_metadata.display_name || prev?.name || 'User'
                    }));

                    // Sync with AccountManager (localStorage)
                    AccountManager.addAccount({
                        name: session.user.user_metadata.display_name || 'User',
                        uuid: session.user.id,
                        token: session.access_token,
                        refreshToken: session.refresh_token,
                        type: 'whoap'
                    });

                    // Sync with main process SessionStore
                    window.ipcRenderer.invoke('auth:update-session', {
                        token: session.access_token,
                        refreshToken: session.refresh_token
                    });
                }
            } else if (event === 'SIGNED_OUT') {
                setUser(null);
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const handleLogout = async () => {
        await window.ipcRenderer.invoke('auth:logout');
        await supabase.auth.signOut(); // Ensure AuthContext is cleared
        setUser(null);
    };

    if (showSplash) {
        // Only ready to dismiss when checkingSession is DONE (false)
        return <LoadingScreen isReady={!checkingSession} onComplete={(online) => {
            setIsOnline(online);
            setShowSplash(false);
        }} />;
    }

    if (!user) {
        return <Login onLoginSuccess={setUser} onOfflineLogin={(name) => console.log("Offline login:", name)} />;
    }

    return (
        <ErrorBoundary>
            <ToastProvider>
                <Toaster position="bottom-right" toastOptions={{
                    style: {
                        background: '#333',
                        color: '#fff',
                        border: '1px solid #444'
                    }
                }} />
                <ConfirmProvider>
                    <MainLayout activeTab={activeTab} onTabChange={setActiveTab} user={user} onLogout={handleLogout}>
                        {activeTab === 'home' && <Home user={user} />}
                        <Suspense fallback={<PageLoader />}>
                            {activeTab === 'profiles' && <Instances />}
                            {activeTab === 'screenshots' && <Screenshots user={user} />}
                            {activeTab === 'settings' && <Settings />}
                            {activeTab === 'modpacks' && <ModpackBrowser isOnline={isOnline} />}
                            {activeTab === 'mods' && <ModsManager user={user} isOnline={isOnline} />}
                            {activeTab === 'friends' && <Friends isOnline={isOnline} />}
                            {activeTab === 'news' && <News />}
                            {activeTab === 'profile' && <Profile user={user} />}
                            {activeTab === 'admin' && <Admin user={user} />}
                        </Suspense>
                    </MainLayout>
                </ConfirmProvider>
            </ToastProvider>
        </ErrorBoundary>
    );
}

export default App;
