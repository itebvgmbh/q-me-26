import React from 'react';
import { cn } from '@/lib/utils';

export interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
}

/** Fortschritt als beschriftete Balken */
export const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep, totalSteps, labels = [] }) => (
  <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))` }} aria-label="Fortschritt">
    {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
      <li key={step} className="flex flex-col gap-1.5" aria-current={step === currentStep ? 'step' : undefined}>
        <span className={cn('h-1.5 rounded-full', step <= currentStep ? 'bg-foreground' : 'bg-foreground/15')} />
        <span className={cn('truncate text-xs sm:text-sm', step === currentStep ? 'font-semibold' : 'text-muted-foreground')}>
          {labels[step - 1] ?? `Schritt ${step}`}
        </span>
      </li>
    ))}
  </ol>
);
