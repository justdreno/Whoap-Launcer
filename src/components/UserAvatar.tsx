import React, { useState, useEffect } from 'react';
import whoapSkin from '../assets/whoap-skin.png';
import steveFace from '../assets/steve.png';

interface UserAvatarProps {
    username: string;
    preferredSkin?: string;
    uuid?: string;
    className?: string;
    accountType?: 'microsoft' | 'whoap' | 'offline';
    variant?: 'face' | 'body';
}

export const UserAvatar: React.FC<UserAvatarProps> = ({ username, preferredSkin, uuid, className, accountType, variant = 'face' }) => {
    // Determine the fallback image based on variant
    const fallbackSrc = variant === 'body' ? whoapSkin : steveFace;

    // Determine the primary URL to try fetching
    const getPrimaryUrl = () => {
        // [MODIFIED] Prioritize preferredSkin if provided and user is whoap/offline
        const identifier = preferredSkin || ((accountType === 'microsoft' && uuid) ? uuid : username);

        return variant === 'body'
            ? `https://mc-heads.net/body/${identifier}`
            : `https://mc-heads.net/avatar/${identifier}`;
    };

    const [currentSrc, setCurrentSrc] = useState<string>(getPrimaryUrl());

    useEffect(() => {
        // Reset to primary URL whenever props change
        setCurrentSrc(getPrimaryUrl());
    }, [username, uuid, accountType, variant, preferredSkin]);

    const handleError = () => {
        // If the network image fails, fallback to ID 
        if (currentSrc !== fallbackSrc) {
            setCurrentSrc(fallbackSrc);
        }
    };

    return (
        <img
            src={currentSrc}
            alt={username}
            className={className}
            onError={handleError}
            style={{
                objectFit: 'contain',
                imageRendering: 'pixelated'
            }}
        />
    );
};
