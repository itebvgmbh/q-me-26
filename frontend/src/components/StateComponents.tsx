import React from 'react';

/**
 * LoadingState component
 * 
 * Displays a loading spinner with an optional message
 */
interface LoadingStateProps {
  /** Message to display below the spinner */
  message?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ 
  message = 'Lade Daten...' 
}) => {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
        <p className="mt-4">{message}</p>
      </div>
    </div>
  );
};

/**
 * EmptyState component
 * 
 * Displays a message when no data is available
 */
interface EmptyStateProps {
  /** Message to display */
  message: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message }) => {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
      <div className="text-center">
        <p>{message}</p>
      </div>
    </div>
  );
};
