import React from 'react';
import { Service } from '../utils/firestore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

/**
 * Props for the ServiceForm component
 */
export interface ServiceFormProps {
  /** Initial service data for edit mode, empty for create mode */
  initialService?: Partial<Service>;
  /** Called when the form is submitted with validated data */
  onSubmit: (serviceData: {
    name: string;
    description: string;
    duration: number;
    setupTime?: number;
    price: number;
    category: string;
  }) => Promise<void>;
  /** Called when the form is cancelled */
  onCancel: () => void;
  /** Submit button text */
  submitLabel?: string;
}

/**
 * ServiceForm component
 * 
 * Reusable form for creating and editing services
 * Handles form state, validation, and submission
 */
export const ServiceForm: React.FC<ServiceFormProps> = ({
  initialService = {},
  onSubmit,
  onCancel,
  submitLabel = 'Speichern',
}) => {
  // Form state
  const [name, setName] = React.useState(initialService.name || '');
  const [description, setDescription] = React.useState(initialService.description || '');
  const [duration, setDuration] = React.useState(
    initialService.duration ? initialService.duration.toString() : ''
  );
  const [setupTime, setSetupTime] = React.useState(
    initialService.setupTime ? initialService.setupTime.toString() : ''
  );
  const [price, setPrice] = React.useState(
    initialService.price ? initialService.price.toString() : ''
  );
  const [category, setCategory] = React.useState(initialService.category || '');
  
  // Form validation and submission
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  /**
   * Validates the form data before submission
   * @returns True if valid, false otherwise
   */
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!name.trim()) {
      newErrors.name = 'Name ist erforderlich';
    }
    
    if (!duration.trim()) {
      newErrors.duration = 'Dauer ist erforderlich';
    } else if (isNaN(parseInt(duration)) || parseInt(duration) <= 0) {
      newErrors.duration = 'Dauer muss eine positive Zahl sein';
    }
    
    if (!price.trim()) {
      newErrors.price = 'Preis ist erforderlich';
    } else if (isNaN(parseFloat(price)) || parseFloat(price) < 0) {
      newErrors.price = 'Preis muss eine nicht-negative Zahl sein';
    }
    
    if (setupTime.trim() && (isNaN(parseInt(setupTime)) || parseInt(setupTime) < 0)) {
      newErrors.setupTime = 'Rüstzeit muss eine nicht-negative Zahl sein';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * Handles form submission
   */
  const handleSubmit = React.useCallback(async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    
    try {
      await onSubmit({
        name,
        description,
        duration: parseInt(duration),
        setupTime: setupTime ? parseInt(setupTime) : 0,
        price: parseFloat(price),
        category,
      });
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [name, description, duration, setupTime, price, category, onSubmit]);

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">
          Name*
          {errors.name && <span className="text-red-500 ml-1 text-sm">{errors.name}</span>}
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Haarschnitt"
          disabled={isSubmitting}
        />
      </div>
      
      <div className="grid gap-2">
        <Label htmlFor="description">Beschreibung</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Beschreiben Sie den Service..."
          disabled={isSubmitting}
        />
      </div>
      
      <div className="grid gap-2">
        <Label htmlFor="duration">
          Dauer (Minuten)*
          {errors.duration && <span className="text-red-500 ml-1 text-sm">{errors.duration}</span>}
        </Label>
        <Input
          id="duration"
          type="number"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="30"
          disabled={isSubmitting}
        />
      </div>
      
      <div className="grid gap-2">
        <Label htmlFor="setupTime">
          Rüstzeit (Minuten)
          {errors.setupTime && <span className="text-red-500 ml-1 text-sm">{errors.setupTime}</span>}
        </Label>
        <Input
          id="setupTime"
          type="number"
          value={setupTime}
          onChange={(e) => setSetupTime(e.target.value)}
          placeholder="5"
          disabled={isSubmitting}
        />
      </div>
      
      <div className="grid gap-2">
        <Label htmlFor="price">
          Preis (€)*
          {errors.price && <span className="text-red-500 ml-1 text-sm">{errors.price}</span>}
        </Label>
        <Input
          id="price"
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="29.99"
          disabled={isSubmitting}
        />
      </div>
      
      <div className="grid gap-2">
        <Label htmlFor="category">Kategorie</Label>
        <Input
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="z.B. Haare"
          disabled={isSubmitting}
        />
      </div>
      
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Abbrechen
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? 'Wird gespeichert...' : submitLabel}
        </Button>
      </div>
    </div>
  );
};
