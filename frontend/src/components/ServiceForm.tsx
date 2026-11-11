import React from 'react';
import { Service } from '../utils/firestore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HilfeLink } from './HilfeLink';
import { GRUPPEN } from '../utils/suche-daten';
import { t } from '@/i18n';

/** Wert im Auswahlfeld für „automatisch“ (gespeichert wird ein leeres gruppe) */
const AUTO = 'auto';

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
    /** Leistungsgruppe für „Läden finden“: '' = automatisch, 'keine' oder ein Schlüssel (utils/leistungsgruppen.ts) */
    gruppe: string;
  }) => Promise<unknown>;
  /** Called when the form is cancelled */
  onCancel: () => void;
  /** Submit button text */
  submitLabel?: string;
  /** Name des Ladens: beim Barbier gilt ein Schnitt ohne Angabe als Herrenschnitt (wie im Backend) */
  kontext?: string;
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
  submitLabel = t('Speichern'),
  kontext = '',
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
  // 0 € ist ein gültiger Preis (z. B. Erstgespräch) – vorher wurde er zu '' und galt als fehlend
  const [price, setPrice] = React.useState(
    initialService.price != null ? initialService.price.toString() : ''
  );
  const [category, setCategory] = React.useState(initialService.category || '');
  const [gruppe, setGruppe] = React.useState(initialService.gruppe || '');
  // Was automatisch gälte – ändert sich mit Name und Kategorie
  const autoGruppe = GRUPPEN.auto({ name, category }, kontext);
  const autoName = autoGruppe ? GRUPPEN.gruppe(autoGruppe)?.name : undefined;
  
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
      newErrors.name = t('Name ist erforderlich');
    }
    
    if (!duration.trim()) {
      newErrors.duration = t('Dauer ist erforderlich');
    } else if (isNaN(parseInt(duration)) || parseInt(duration) <= 0) {
      newErrors.duration = t('Dauer muss eine positive Zahl sein');
    }
    
    if (!price.trim()) {
      newErrors.price = t('Preis ist erforderlich');
    } else if (isNaN(parseFloat(price)) || parseFloat(price) < 0) {
      newErrors.price = t('Preis muss eine nicht-negative Zahl sein');
    }
    
    if (setupTime.trim() && (isNaN(parseInt(setupTime)) || parseInt(setupTime) < 0)) {
      newErrors.setupTime = t('Vor- und Nachbereitung muss 0 oder mehr Minuten sein');
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
        gruppe,
      });
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [name, description, duration, setupTime, price, category, gruppe, onSubmit]);

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">
          {t('Name')}*
          {errors.name && <span className="text-destructive ms-1 text-sm">{errors.name}</span>}
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('z.B. Haarschnitt')}
          disabled={isSubmitting}
        />
      </div>
      
      <div className="grid gap-2">
        <Label htmlFor="description">{t('Beschreibung')}</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('z. B. Waschen, Schneiden, Föhnen')}
          disabled={isSubmitting}
        />
      </div>
      
      <div className="grid gap-2">
        <Label htmlFor="duration">
          {t('Dauer (Minuten)')}*
          {errors.duration && <span className="text-destructive ms-1 text-sm">{errors.duration}</span>}
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
          {t('Vor- und Nachbereitung (Minuten)')}
          {errors.setupTime && <span className="text-destructive ms-1 text-sm">{errors.setupTime}</span>}
        </Label>
        <Input
          id="setupTime"
          type="number"
          value={setupTime}
          onChange={(e) => setSetupTime(e.target.value)}
          placeholder="5"
          disabled={isSubmitting}
        />
        <p className="text-sm text-muted-foreground">
          {t('Zeit zum Aufräumen und Vorbereiten. Bei Nummern und Online-Terminen wird sie zur Dauer dazugerechnet, damit zwischen zwei Kunden Luft bleibt.')}{' '}
          <HilfeLink hilfe="leistungen" />
        </p>
      </div>
      
      <div className="grid gap-2">
        <Label htmlFor="price">
          {t('Preis (€)')}*
          {errors.price && <span className="text-destructive ms-1 text-sm">{errors.price}</span>}
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
        <Label htmlFor="category">{t('Kategorie')}</Label>
        <Input
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t('z.B. Haare')}
          disabled={isSubmitting}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="gruppe">{t('In der Suche unter')}</Label>
        <Select value={gruppe || AUTO} onValueChange={(v) => setGruppe(v === AUTO ? '' : v)} disabled={isSubmitting}>
          <SelectTrigger id="gruppe">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>
              {autoName ? t('Automatisch: {gruppe}', { gruppe: t(autoName) }) : t('Automatisch: keine passende Gruppe')}
            </SelectItem>
            {GRUPPEN.liste.map((g) => (
              <SelectItem key={g.key} value={g.key}>
                {t(g.name)}
              </SelectItem>
            ))}
            <SelectItem value="keine">{t('Keiner Gruppe zuordnen')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {t('Darunter findet man die Leistung bei „Läden finden“, auch wenn sie bei dir anders heißt.')}
        </p>
      </div>
      
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('Abbrechen')}
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? t('Wird gespeichert...') : submitLabel}
        </Button>
      </div>
    </div>
  );
};
