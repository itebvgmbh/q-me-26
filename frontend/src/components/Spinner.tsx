import React from 'react';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'primary' | 'secondary' | 'white';
}

export const Spinner: React.FC<SpinnerProps> = ({ 
  size = 'md', 
  color = 'primary' 
}) => {
  // Größe des Spinners basierend auf prop
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8'
  }[size];
  
  // Farbe des Spinners basierend auf prop
  const colorClasses = {
    primary: 'text-primary',
    secondary: 'text-gray-400',
    white: 'text-white'
  }[color];

  return (
    <div className={`animate-spin ${sizeClasses} ${colorClasses}`} role="status">
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24" 
        className="animate-spin"
      >
        <circle 
          className="opacity-25" 
          cx="12" 
          cy="12" 
          r="10" 
          stroke="currentColor" 
          strokeWidth="4"
        />
        <path 
          className="opacity-75" 
          fill="currentColor" 
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <span className="sr-only">Loading...</span>
    </div>
  );
};
