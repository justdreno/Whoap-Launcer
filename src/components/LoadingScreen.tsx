import React, { useEffect, useState } from 'react';
import styles from './LoadingScreen.module.css';
import logo from '../assets/logo.png';
import { NetworkUtils } from '../utils/NetworkUtils';
import { WifiOff } from 'lucide-react';

interface LoadingScreenProps {
    onComplete: (isOnline: boolean) => void;
    isReady: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ onComplete, isReady }) => {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("Initializing...");
    const [canComplete, setCanComplete] = useState(false);
    const [isOnline, setIsOnline] = useState(true);
    const [checkingNetwork, setCheckingNetwork] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    setCanComplete(true);
                    return 100;
                }

                // Update status based on progress
                if (prev > 20 && prev < 40) setStatus("Checking network...");
                if (prev > 40 && prev < 70) setStatus("Loading resources...");
                if (prev > 70 && prev < 90) setStatus("Preparing interface...");
                if (prev > 90) setStatus("Finalizing...");

                const increment = Math.random() * 5 + 1; // Slower, smoother
                return Math.min(prev + increment, 100);
            });
        }, 50);

        return () => clearInterval(interval);
    }, []);

    // Check internet connectivity
    useEffect(() => {
        const checkNetwork = async () => {
            setCheckingNetwork(true);
            const online = await NetworkUtils.checkConnection();
            setIsOnline(online);
            setCheckingNetwork(false);
        };
        
        checkNetwork();
    }, []);

    useEffect(() => {
        if (canComplete && isReady && !checkingNetwork) {
            // Add a small delay for smoothness even if instantly ready
            const t = setTimeout(() => {
                onComplete(isOnline);
            }, 500);
            return () => clearTimeout(t);
        }
    }, [canComplete, isReady, checkingNetwork, isOnline, onComplete]);

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <img src={logo} alt="Whoap" className={styles.logoImage} />

                <div className={styles.loaderArea}>
                    <div className={styles.spinner}></div>
                    <div className={styles.status}>{status}</div>
                </div>

                <div className={styles.progressContainer}>
                    <div className={styles.progressBar} style={{ width: `${progress}%` }}></div>
                </div>

                {!isOnline && progress > 50 && (
                    <div className={styles.networkWarning}>
                        <WifiOff size={16} />
                        <span>No internet connection - Some features will be limited</span>
                    </div>
                )}

                <div className={styles.versionTag}>v1.0.0 Alpha</div>
            </div>
        </div>
    );
};
