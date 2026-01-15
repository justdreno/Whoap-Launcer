import React, { useEffect, useState } from 'react';
import styles from './LoadingScreen.module.css';
import logo from '../assets/logo.png';

interface LoadingScreenProps {
    onComplete: () => void;
    isReady: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ onComplete, isReady }) => {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("Initializing...");
    const [canComplete, setCanComplete] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    setCanComplete(true);
                    return 100;
                }

                // Update status based on progress
                if (prev > 20 && prev < 40) setStatus("Checking updates...");
                if (prev > 40 && prev < 70) setStatus("Loading resources...");
                if (prev > 70 && prev < 90) setStatus("Preparing interface...");
                if (prev > 90) setStatus("Finalizing...");

                const increment = Math.random() * 5 + 1; // Slower, smoother
                return Math.min(prev + increment, 100);
            });
        }, 50);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (canComplete && isReady) {
            // Add a small delay for smoothness even if instantly ready
            const t = setTimeout(() => {
                onComplete();
            }, 500);
            return () => clearTimeout(t);
        }
    }, [canComplete, isReady, onComplete]);

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

                <div className={styles.versionTag}>v1.0.0 Alpha</div>
            </div>
        </div>
    );
};
