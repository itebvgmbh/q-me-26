import React from 'react';

export interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

/**
 * Component to show the current step in a multi-step process
 * Displays numbered indicators for each step with connecting lines
 */
export const StepIndicator: React.FC<StepIndicatorProps> = ({
  currentStep,
  totalSteps
}) => {
  return (
    <div className="flex justify-center mb-8">
      <div className="flex items-center">
        {Array.from({ length: totalSteps }, (_, index) => index + 1).map((step) => (
          <React.Fragment key={step}>
            <div 
              className={`rounded-full h-8 w-8 flex items-center justify-center ${step <= currentStep ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
            >
              {step}
            </div>
            {step < totalSteps && (
              <div 
                className={`h-1 w-6 ${step < currentStep ? 'bg-blue-500' : 'bg-gray-200'}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
