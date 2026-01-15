import React, { useEffect, useState } from 'react';
import styles from './Splash.module.css';
import logo from '../assets/logo.png';

interface SplashProps {
    onComplete: () => void;
}

export const Splash: React.FC<SplashProps> = ({ onComplete }) => {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
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
            <div className={styles.status}>Initializing... {progress}%</div>
        </div>
    );
};
