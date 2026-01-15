import React, { useState, useRef, useEffect } from 'react';
import styles from './CustomSelect.module.css';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Option {
    value: string;
    label: string;
}

interface CustomSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps & { searchable?: boolean }> = ({ value, onChange, options, placeholder = "Select...", disabled = false, searchable = true }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const toggleOpen = () => {
        if (!disabled) setIsOpen(!isOpen);
    };

    const handleSelect = (optionValue: string) => {
        onChange(optionValue);
        setIsOpen(false);
        setSearchQuery('');
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen && searchable && inputRef.current) {
            inputRef.current.focus();
        }
        if (!isOpen) {
            setSearchQuery('');
        }
    }, [isOpen, searchable]);

    const selectedOption = options.find(opt => opt.value === value);

    const filteredOptions = options.filter(opt =>
        !searchQuery || opt.label.toLowerCase().includes(searchQuery.toLowerCase()) || opt.value.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className={styles.container} ref={containerRef}>
            <div className={`${styles.trigger} ${isOpen ? styles.open : ''} ${disabled ? styles.disabled : ''}`} onClick={toggleOpen}>
                <span className={styles.value}>{selectedOption ? selectedOption.label : placeholder}</span>
                <span className={styles.icon}>
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
            </div>

            {isOpen && (
                <div className={styles.dropdown}>
                    {searchable && (
                        <input
                            ref={inputRef}
                            type="text"
                            className={styles.searchInput}
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                        />
                    )}
                    {filteredOptions.length > 0 ? (
                        filteredOptions.map(option => (
                            <div
                                key={option.value}
                                className={`${styles.option} ${option.value === value ? styles.selected : ''}`}
                                onClick={() => handleSelect(option.value)}
                            >
                                {option.label}
                            </div>
                        ))
                    ) : (
                        <div className={styles.option} style={{ cursor: 'default', color: '#666' }}>
                            No results found
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
