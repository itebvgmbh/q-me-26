import React from 'react';

export interface StepsProps {
  currentStep: number;
  totalSteps: number;
}

export const Steps = ({ currentStep, totalSteps }: StepsProps) => {
  return (
    <div className="flex justify-center mb-8">
      <div className="flex items-center">
        {Array.from({ length: totalSteps }).map((_, index) => (
          <React.Fragment key={index}>
            <div 
              className={`rounded-full h-8 w-8 flex items-center justify-center ${index < currentStep ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
            >
              {index + 1}
            </div>
            {index < totalSteps - 1 && (
              <div 
                className={`h-1 w-6 ${index < currentStep - 1 ? 'bg-blue-500' : 'bg-gray-200'}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
