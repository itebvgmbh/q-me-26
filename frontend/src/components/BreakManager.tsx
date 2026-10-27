import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Break, createBreak, getBreaksByStaffAndDate, updateBreak, deleteBreak, checkBreakConflicts } from '../utils/firestore/breaks';
import { Staff } from '../utils/firestore/types';
import { Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '../utils/cn';
import { CalendarIcon, Trash2 } from 'lucide-react';
import { datumsLocale, t } from '@/i18n';

interface BreakManagerProps {
  staff: Staff;
  shopId: string;
}

export function BreakManager({ staff, shopId }: BreakManagerProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddingBreak, setIsAddingBreak] = useState(false);
  const [editingBreak, setEditingBreak] = useState<Break | null>(null);
  
  // Form states
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [breakType, setBreakType] = useState('lunch'); // Default: Mittagspause
  
  // Pausentypen: gespeichert wird nur die id, der Name ist nur Anzeige
  const breakTypes = [
    { id: 'lunch', name: t('Mittagspause') },
    { id: 'coffee', name: t('Kaffeepause') },
    { id: 'personal', name: t('Persönliche Pause') },
    { id: 'other', name: t('Sonstige Pause') }
  ];
  
  // Laden der Pausen für den ausgewählten Tag
  useEffect(() => {
    const loadBreaks = async () => {
      setLoading(true);
      try {
        const breaksList = await getBreaksByStaffAndDate(staff.id, selectedDate);
        setBreaks(breaksList);
      } catch (error) {
        console.error('Error loading breaks:', error);
        toast.error(t('Fehler beim Laden der Pausen'));
      } finally {
        setLoading(false);
      }
    };
    
    loadBreaks();
  }, [staff.id, selectedDate]);
  
  // Formular zurücksetzen
  const resetForm = () => {
    setStartTime('');
    setEndTime('');
    setBreakType('lunch');
    setEditingBreak(null);
    setIsAddingBreak(false);
  };
  
  // Pause zum Bearbeiten laden
  const handleEditBreak = (breakItem: Break) => {
    const startDateTime = breakItem.startTime.toDate();
    const endDateTime = breakItem.endTime.toDate();
    
    setStartTime(format(startDateTime, 'HH:mm'));
    setEndTime(format(endDateTime, 'HH:mm'));
    setBreakType(breakItem.type || 'lunch');
    setEditingBreak(breakItem);
    setIsAddingBreak(true);
  };
  
  // Pause löschen
  const handleDeleteBreak = async (breakId: string) => {
    try {
      await deleteBreak(breakId);
      setBreaks(breaks.filter(b => b.id !== breakId));
      toast.success(t('Pause erfolgreich gelöscht'));
    } catch (error) {
      console.error('Error deleting break:', error);
      toast.error(t('Fehler beim Löschen der Pause'));
    }
  };
  
  // Pause speichern (erstellen oder aktualisieren)
  const handleSaveBreak = async () => {
    if (!startTime || !endTime) {
      toast.error(t('Bitte Start- und Endzeit auswählen'));
      return;
    }
    
    try {
      // Erstelle Date-Objekte für Start- und Endzeit
      const [startHours, startMinutes] = startTime.split(':').map(Number);
      const [endHours, endMinutes] = endTime.split(':').map(Number);
      
      const startDateTime = new Date(selectedDate);
      startDateTime.setHours(startHours, startMinutes, 0, 0);
      
      const endDateTime = new Date(selectedDate);
      endDateTime.setHours(endHours, endMinutes, 0, 0);
      
      // Überprüfe, ob die Endzeit nach der Startzeit liegt
      if (endDateTime <= startDateTime) {
        toast.error(t('Die Endzeit muss nach der Startzeit liegen'));
        return;
      }
      
      // Erstelle Timestamps
      const startTimestamp = Timestamp.fromDate(startDateTime);
      const endTimestamp = Timestamp.fromDate(endDateTime);
      const dateTimestamp = Timestamp.fromDate(new Date(selectedDate.setHours(0, 0, 0, 0)));
      
      // Überprüfe auf Überschneidungen mit bestehenden Pausen
      const hasConflict = await checkBreakConflicts(
        staff.id, 
        startDateTime, 
        endDateTime,
        editingBreak?.id // Aktuelle Pause ausschließen, wenn bearbeitet wird
      );
      
      if (hasConflict) {
        toast.error(t('Diese Pause überschneidet sich mit einer bestehenden Pause'));
        return;
      }
      
      if (editingBreak) {
        // Pause aktualisieren
        const updatedBreak = await updateBreak(editingBreak.id, {
          startTime: startTimestamp,
          endTime: endTimestamp,
          type: breakType
        });
        
        setBreaks(breaks.map(b => b.id === updatedBreak.id ? updatedBreak : b));
        toast.success(t('Pause erfolgreich aktualisiert'));
      } else {
        // Neue Pause erstellen
        const newBreak = await createBreak({
          shopId,
          staffId: staff.id,
          date: dateTimestamp,
          startTime: startTimestamp,
          endTime: endTimestamp,
          type: breakType
        });
        
        setBreaks([...breaks, newBreak]);
        toast.success(t('Pause erfolgreich erstellt'));
      }
      
      // Formular zurücksetzen
      resetForm();
    } catch (error) {
      console.error('Error saving break:', error);
      toast.error(t('Fehler beim Speichern der Pause'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>{t('Pausenverwaltung für {name}', { name: staff.name })}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row items-start gap-4">
              <div className="w-full md:w-auto">
                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="date">{t('Datum')}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-start font-normal",
                          !selectedDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="me-2 h-4 w-4" />
                        {selectedDate ? (
                          format(selectedDate, "PPP", { locale: datumsLocale() })
                        ) : (
                          <span>{t('Datum auswählen')}</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date) => date && setSelectedDate(date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              <div className="w-full md:w-auto mt-4 md:mt-0">
                {!isAddingBreak ? (
                  <Button onClick={() => setIsAddingBreak(true)} className="w-full md:w-auto">
                    {t('Neue Pause hinzufügen')}
                  </Button>
                ) : (
                  <div className="space-y-4 bg-muted p-4 rounded-md w-full">
                    <h3 className="font-medium">
                      {editingBreak ? t('Pause bearbeiten') : t('Neue Pause hinzufügen')}
                    </h3>
                    
                    <div className="grid gap-2">
                      <Label htmlFor="startTime">{t('Startzeit')}</Label>
                      <Input
                        id="startTime"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <Label htmlFor="endTime">{t('Endzeit')}</Label>
                      <Input
                        id="endTime"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                      />
                    </div>
                    
                    <div className="grid gap-2">
                      <Label htmlFor="breakType">{t('Pausentyp')}</Label>
                      <Select value={breakType} onValueChange={setBreakType}>
                        <SelectTrigger id="breakType">
                          <SelectValue placeholder={t('Pausentyp auswählen')} />
                        </SelectTrigger>
                        <SelectContent>
                          {breakTypes.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button onClick={handleSaveBreak} className="flex-1">
                        {t('Speichern')}
                      </Button>
                      <Button onClick={resetForm} variant="outline" className="flex-1">
                        {t('Abbrechen')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>{t('Pausen am {datum}', { datum: format(selectedDate, 'PPP', { locale: datumsLocale() }) })}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p>{t('Lädt...')}</p>
          ) : breaks.length === 0 ? (
            <p className="text-muted-foreground">{t('Keine Pausen für diesen Tag eingetragen.')}</p>
          ) : (
            <div className="space-y-2">
              {breaks.map((breakItem) => {
                const startDateTime = breakItem.startTime.toDate();
                const endDateTime = breakItem.endTime.toDate();
                const breakTypeName = breakTypes.find((typ) => typ.id === breakItem.type)?.name || t('Pause');
                
                return (
                  <div key={breakItem.id} className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <div className="font-medium">{breakTypeName}</div>
                      <div className="text-sm text-muted-foreground">
                        {t('{start} - {ende} Uhr', { start: format(startDateTime, 'HH:mm'), ende: format(endDateTime, 'HH:mm') })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleEditBreak(breakItem)}>
                        {t('Bearbeiten')}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleDeleteBreak(breakItem.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}