import React from 'react';
import { Spinner } from './Spinner';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps?: number;
}

/**
 * Component that shows the current step in a multi-step process
 */
export const StepIndicator: React.FC<StepIndicatorProps> = ({ 
  currentStep, 
  totalSteps = 4 
}) => {
  return (
    <div className="flex justify-center mb-8">
      <div className="flex items-center">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
          <div key={step} className="flex items-center">
            <div 
              className={`rounded-full h-8 w-8 flex items-center justify-center ${
                step <= currentStep ? 'bg-blue-500 text-white' : 'bg-gray-200'
              }`}
            >
              {step}
            </div>
            {step < totalSteps && (
              <div 
                className={`h-1 w-6 ${
                  step < currentStep ? 'bg-blue-500' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

interface LoadingStateProps {
  message?: string;
}

/**
 * Component to display a loading state
 */
export const LoadingState: React.FC<LoadingStateProps> = ({ 
  message = 'Lädt...' 
}) => {
  return (
    <div className="flex items-center justify-center py-8">
      <Spinner />
      <span className="ml-2">{message}</span>
    </div>
  );
};
