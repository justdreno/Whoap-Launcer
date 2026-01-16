import React, { useEffect, useState } from 'react';
import styles from './Splash.module.css';
import { SystemService } from '../services/SystemService';

interface SplashProps {
    onComplete: () => void;
}

export const Splash: React.FC<SplashProps> = ({ onComplete }) => {
    const [progress, setProgress] = useState(0);
    const [version, setVersion] = useState('');

    useEffect(() => {
        const fetchVersion = async () => {
            const v = await SystemService.getAppVersion();
            setVersion(`v${v}`);
        };
        fetchVersion();

        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    setTimeout(onComplete, 500);
                    return 100;
                }
                return prev + 5;
            });
        }, 100);

        return () => clearInterval(interval);
    }, [onComplete]);

    return (
        <div className={styles.splashWindow}>
            <div className={styles.logoContainer}>
                <img src={logo} alt="Whoap Launcher" className={styles.logoImage} />
            </div>
            <div className={styles.progressContainer}>
                <div className={styles.progressBar} style={{ width: `${progress}%` }}></div>
            </div>
            <div className={styles.status}>
                <span>Initializing... {progress}%</span>
                {version && <span style={{ opacity: 0.5, fontSize: '0.8em' }}>{version}</span>}
            </div>
        </div>
    );
};
