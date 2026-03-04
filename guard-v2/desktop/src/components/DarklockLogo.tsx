import React from 'react';

interface DarklockLogoProps {
  size?: number;
  className?: string;
}

export const DarklockLogo: React.FC<DarklockLogoProps> = ({ size = 24, className = '' }) => {
  // Use the new brand PNG served from /public to stay consistent with favicon/app icon.
  return (
    <img
      src="/darklock.png"
      width={size}
      height={size}
      className={className}
      alt="Darklock"
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
};
