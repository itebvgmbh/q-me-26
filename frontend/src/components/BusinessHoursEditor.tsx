import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { BusinessHoursDay } from '../utils/firestore/types';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { TimePicker } from './TimePicker';

const DAY_NAMES = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag'
];

interface Props {
  businessHours: BusinessHoursDay[];
  onChange: (hours: BusinessHoursDay[]) => void;
}

export const BusinessHoursEditor = ({ businessHours, onChange }: Props) => {
  // Initialisiere mit den übergebenen Stunden oder mit Standardwerten für jeden Tag
  const [hours, setHours] = useState<BusinessHoursDay[]>(() => {
    // Wenn businessHours vorhanden ist, verwende sie
    if (businessHours && businessHours.length > 0) {
      return businessHours;
    }

    // Andernfalls erstelle Standardwerte für jeden Tag
    return Array.from({ length: 7 }, (_, index) => ({
      dayOfWeek: index,
      isOpen: index > 0 && index < 6, // Mo-Fr geöffnet, Sa-So geschlossen
      openTime: '09:00',
      closeTime: '17:00'
    }));
  });

  // Aktualisiere die Stunden, wenn sich die Props ändern
  useEffect(() => {
    if (businessHours && businessHours.length > 0) {
      setHours(businessHours);
    }
  }, [businessHours]);

  // Handler für die Änderung eines Tages
  const handleDayChange = (index: number, field: keyof BusinessHoursDay, value: any) => {
    const newHours = [...hours];
    newHours[index] = { ...newHours[index], [field]: value };
    
    // Bei Änderung der isOpen-Eigenschaft die Änderungen speichern
    setHours(newHours);
    onChange(newHours);
  };

  // Handler für die Anwendung der gleichen Zeiten auf alle ausgewählten Tage
  const applyToAllDays = (templateDay: number) => {
    const template = hours[templateDay];
    const newHours = hours.map((day, index) => {
      // Wir überschreiben nur die Zeiten, nicht den isOpen-Status
      if (day.isOpen) {
        return {
          ...day,
          openTime: template.openTime,
          closeTime: template.closeTime
        };
      }
      return day;
    });

    setHours(newHours);
    onChange(newHours);
    toast.success('Zeiten wurden auf alle geöffneten Tage angewendet');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Öffnungszeiten</h3>
      </div>
      
      <Accordion type="single" collapsible className="w-full">
        {hours.map((day, index) => (
          <AccordionItem key={index} value={`day-${index}`}>
            <AccordionTrigger className="flex justify-between py-2 px-2 hover:bg-gray-50 rounded-md">
              <div className="flex items-center justify-between w-full pr-4">
                <span className="text-md font-medium">{DAY_NAMES[day.dayOfWeek]}</span>
                <div className="flex items-center space-x-2">
                  <span className={day.isOpen ? 'text-green-600' : 'text-red-600'}>
                    {day.isOpen 
                      ? `${day.openTime} - ${day.closeTime}`
                      : 'Geschlossen'}
                  </span>
                  <div className="flex items-center space-x-2">
                    <Switch 
                      checked={day.isOpen} 
                      onCheckedChange={(checked) => handleDayChange(index, 'isOpen', checked)}
                      aria-label={`${DAY_NAMES[day.dayOfWeek]} geöffnet/geschlossen`}
                    />
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-2">
              {day.isOpen && (
                <div className="space-y-4 mt-2 p-4 bg-gray-50 rounded-md">
                  <div className="flex items-center justify-between space-x-4">
                    <div className="w-1/2">
                      <Label htmlFor={`open-time-${index}`}>Öffnungszeit</Label>
                      <TimePicker 
                        id={`open-time-${index}`}
                        value={day.openTime} 
                        onChange={(time) => handleDayChange(index, 'openTime', time)}
                      />
                    </div>
                    <div className="w-1/2">
                      <Label htmlFor={`close-time-${index}`}>Schließzeit</Label>
                      <TimePicker 
                        id={`close-time-${index}`}
                        value={day.closeTime} 
                        onChange={(time) => handleDayChange(index, 'closeTime', time)}
                      />
                    </div>
                  </div>
                  
                  <div className="pt-2">
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm"
                      onClick={() => applyToAllDays(index)}
                    >
                      Diese Zeiten auf alle geöffneten Tage anwenden
                    </Button>
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
};
