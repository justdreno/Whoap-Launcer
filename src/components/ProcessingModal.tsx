import React from 'react';
import styles from './ProcessingModal.module.css';

interface ProcessingModalProps {
    message: string;
    subMessage?: string;
}

export const ProcessingModal: React.FC<ProcessingModalProps> = ({ message, subMessage }) => {
    return (
        <div className={styles.overlay}>
            <div className={styles.spinner}></div>
            <div className={styles.message}>{message}</div>
            {subMessage && <div className={styles.subMessage}>{subMessage}</div>}
        </div>
    );
};
