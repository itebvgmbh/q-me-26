import { useState, useEffect } from 'react';
import { Staff } from '../utils/firestore/types';
import { RecurringBreak, getRecurringBreaksByStaff, createRecurringBreak, updateRecurringBreak, deleteRecurringBreak, checkRecurringBreakConflicts } from '../utils/firestore/recurring-breaks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { PlusCircle, Clock, Trash2, Edit, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Timestamp } from 'firebase/firestore';
import { Switch } from '@/components/ui/switch';

interface RecurringBreakManagerProps {
  staff: Staff;
  shopId: string;
}

type BreakType = 'lunch' | 'coffee' | 'personal' | 'other';

const breakTypeOptions = [
  { value: 'lunch', label: 'Mittagspause' },
  { value: 'coffee', label: 'Kaffeepause' },
  { value: 'personal', label: 'Persönlich' },
  { value: 'other', label: 'Sonstige' },
];

const getBreakTypeLabel = (type: string | undefined): string => {
  const option = breakTypeOptions.find(option => option.value === type);
  return option ? option.label : 'Pause';
};

const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export const RecurringBreakManager = ({ staff, shopId }: RecurringBreakManagerProps) => {
  const [activeTab, setActiveTab] = useState<string>('0'); // 0 = Sonntag, 1 = Montag, usw.
  const [breaks, setBreaks] = useState<Record<number, RecurringBreak[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  
  // Form state
  const [currentDayOfWeek, setCurrentDayOfWeek] = useState<number>(0);
  const [isAddingBreak, setIsAddingBreak] = useState<boolean>(false);
  const [editingBreak, setEditingBreak] = useState<RecurringBreak | null>(null);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [breakType, setBreakType] = useState<BreakType>('lunch');
  
  // Laden aller wiederkehrenden Pausen für den Mitarbeiter
  const loadBreaks = async () => {
    if (!staff.id) return;
    
    setLoading(true);
    try {
      const allBreaks = await getRecurringBreaksByStaff(staff.id);
      
      // Pausen nach Wochentag gruppieren
      const groupedBreaks: Record<number, RecurringBreak[]> = {};
      
      // Initialisiere alle Wochentage
      for (let i = 0; i < 7; i++) {
        groupedBreaks[i] = [];
      }
      
      // Füge die Pausen hinzu
      allBreaks.forEach(breakItem => {
        const day = breakItem.dayOfWeek;
        if (!groupedBreaks[day]) {
          groupedBreaks[day] = [];
        }
        groupedBreaks[day].push(breakItem);
      });
      
      // Sortiere die Pausen nach Startzeit
      for (const day in groupedBreaks) {
        groupedBreaks[day].sort((a, b) => {
          const aMinutes = timeStringToMinutes(a.startTime);
          const bMinutes = timeStringToMinutes(b.startTime);
          return aMinutes - bMinutes;
        });
      }
      
      setBreaks(groupedBreaks);
    } catch (error) {
      console.error('Error loading recurring breaks:', error);
      toast.error('Fehler beim Laden der wiederkehrenden Pausen');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    loadBreaks();
  }, [staff.id]);
  
  // Funktion zum Konvertieren einer Zeitzeichenfolge in Minuten
  const timeStringToMinutes = (timeString: string): number => {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  };
  
  // Formular zurücksetzen
  const resetForm = () => {
    setIsAddingBreak(false);
    setEditingBreak(null);
    setStartTime('');
    setEndTime('');
    setBreakType('lunch');
  };
  
  // Pause bearbeiten
  const handleEditBreak = (breakItem: RecurringBreak) => {
    setEditingBreak(breakItem);
    setStartTime(breakItem.startTime);
    setEndTime(breakItem.endTime);
    setBreakType((breakItem.type as BreakType) || 'lunch');
    setCurrentDayOfWeek(breakItem.dayOfWeek);
    setIsAddingBreak(true);
  };
  
  // Pause löschen
  const handleDeleteBreak = async (breakId: string, dayOfWeek: number) => {
    if (!window.confirm('Möchten Sie diese Pause wirklich löschen?')) {
      return;
    }
    
    try {
      await deleteRecurringBreak(breakId);
      
      // Aktualisiere den State
      const updatedBreaks = { ...breaks };
      updatedBreaks[dayOfWeek] = updatedBreaks[dayOfWeek].filter(b => b.id !== breakId);
      setBreaks(updatedBreaks);
      
      toast.success('Pause erfolgreich gelöscht');
    } catch (error) {
      console.error('Error deleting recurring break:', error);
      toast.error('Fehler beim Löschen der Pause');
    }
  };
  
  // Status einer Pause ändern (aktiv/inaktiv)
  const handleToggleBreakStatus = async (breakItem: RecurringBreak) => {
    try {
      const updatedBreak = await updateRecurringBreak(breakItem.id, {
        active: !breakItem.active
      });
      
      // Aktualisiere den State
      const dayOfWeek = breakItem.dayOfWeek;
      const updatedBreaks = { ...breaks };
      updatedBreaks[dayOfWeek] = updatedBreaks[dayOfWeek].map(b => 
        b.id === updatedBreak.id ? updatedBreak : b
      );
      setBreaks(updatedBreaks);
      
      toast.success(`Pause ${updatedBreak.active ? 'aktiviert' : 'deaktiviert'}`);
    } catch (error) {
      console.error('Error toggling break status:', error);
      toast.error('Fehler beim Ändern des Pausenstatus');
    }
  };
  
  // Pause speichern (erstellen oder aktualisieren)
  const handleSaveBreak = async () => {
    if (!startTime || !endTime) {
      toast.error('Bitte geben Sie Start- und Endzeit ein');
      return;
    }
    
    // Validiere Zeiten
    const startMinutes = timeStringToMinutes(startTime);
    const endMinutes = timeStringToMinutes(endTime);
    
    if (startMinutes >= endMinutes) {
      toast.error('Die Startzeit muss vor der Endzeit liegen');
      return;
    }
    
    const dayOfWeek = editingBreak ? editingBreak.dayOfWeek : parseInt(activeTab);
    
    // Überprüfe auf Überschneidungen mit anderen Pausen am selben Wochentag
    try {
      const hasConflict = await checkRecurringBreakConflicts(
        staff.id,
        dayOfWeek,
        startTime,
        endTime,
        editingBreak?.id
      );
      
      if (hasConflict) {
        toast.error('Diese Pause überschneidet sich mit einer bereits existierenden Pause');
        return;
      }
      
      // Speichere die Pause
      if (editingBreak) {
        // Pause aktualisieren
        const updatedBreak = await updateRecurringBreak(editingBreak.id, {
          startTime,
          endTime,
          type: breakType
        });
        
        // Aktualisiere den State
        const updatedBreaks = { ...breaks };
        updatedBreaks[dayOfWeek] = updatedBreaks[dayOfWeek].map(b => 
          b.id === updatedBreak.id ? updatedBreak : b
        );
        setBreaks(updatedBreaks);
        
        toast.success('Pause erfolgreich aktualisiert');
      } else {
        // Neue Pause erstellen
        const newBreak = await createRecurringBreak({
          shopId,
          staffId: staff.id,
          dayOfWeek,
          startTime,
          endTime,
          type: breakType,
          active: true
        });
        
        // Aktualisiere den State
        const updatedBreaks = { ...breaks };
        updatedBreaks[dayOfWeek] = [...updatedBreaks[dayOfWeek], newBreak];
        
        // Sortiere die Pausen nach Startzeit
        updatedBreaks[dayOfWeek].sort((a, b) => {
          const aMinutes = timeStringToMinutes(a.startTime);
          const bMinutes = timeStringToMinutes(b.startTime);
          return aMinutes - bMinutes;
        });
        
        setBreaks(updatedBreaks);
        
        toast.success('Pause erfolgreich erstellt');
      }
      
      // Formular zurücksetzen
      resetForm();
    } catch (error) {
      console.error('Error saving recurring break:', error);
      toast.error('Fehler beim Speichern der Pause');
    }
  };
  
  // Neues Pausenformular öffnen
  const handleAddBreak = () => {
    setCurrentDayOfWeek(parseInt(activeTab));
    setIsAddingBreak(true);
    setEditingBreak(null);
    setStartTime('');
    setEndTime('');
    setBreakType('lunch');
  };
  
  return (
    <div className="space-y-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Wiederkehrende Pausen für {staff.name}</CardTitle>
          <CardDescription>
            Legen Sie regelmäßige Pausen fest, die in jedem Terminkalender berücksichtigt werden
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid grid-cols-7 mb-4">
              {DAY_NAMES.map((day, index) => (
                <TabsTrigger key={index} value={index.toString()} className="text-xs sm:text-sm">
                  {day}
                </TabsTrigger>
              ))}
            </TabsList>
            
            {DAY_NAMES.map((day, index) => (
              <TabsContent key={index} value={index.toString()}>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium">Pausen für {day}</h3>
                    {!isAddingBreak && (
                      <Button onClick={handleAddBreak} size="sm">
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Pause hinzufügen
                      </Button>
                    )}
                  </div>
                  
                  {isAddingBreak && parseInt(activeTab) === currentDayOfWeek && (
                    <Card className="bg-muted">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          {editingBreak ? 'Pause bearbeiten' : 'Neue Pause hinzufügen'}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4">
                          <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="startTime">Startzeit</Label>
                              <Input
                                id="startTime"
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="endTime">Endzeit</Label>
                              <Input
                                id="endTime"
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="breakType">Pausentyp</Label>
                              <Select value={breakType} onValueChange={(value) => setBreakType(value as BreakType)}>
                                <SelectTrigger id="breakType">
                                  <SelectValue placeholder="Pausentyp auswählen" />
                                </SelectTrigger>
                                <SelectContent>
                                  {breakTypeOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter className="flex justify-between">
                        <Button variant="outline" onClick={resetForm}>
                          Abbrechen
                        </Button>
                        <Button onClick={handleSaveBreak}>
                          <Save className="h-4 w-4 mr-2" />
                          Speichern
                        </Button>
                      </CardFooter>
                    </Card>
                  )}
                  
                  {loading ? (
                    <p>Lädt...</p>
                  ) : breaks[index] && breaks[index].length > 0 ? (
                    <div className="space-y-2">
                      {breaks[index].map((breakItem) => (
                        <div key={breakItem.id} className="flex items-center justify-between p-3 border rounded-md">
                          <div className="flex items-center">
                            <Switch
                              checked={breakItem.active}
                              onCheckedChange={() => handleToggleBreakStatus(breakItem)}
                              className="mr-3"
                            />
                            <div>
                              <div className={`font-medium ${!breakItem.active ? 'text-muted-foreground' : ''}`}>
                                {getBreakTypeLabel(breakItem.type as BreakType)}
                              </div>
                              <div className={`text-sm ${!breakItem.active ? 'text-muted-foreground' : ''}`}>
                                <Clock className="h-3 w-3 inline-block mr-1" />
                                {breakItem.startTime} - {breakItem.endTime} Uhr
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleEditBreak(breakItem)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleDeleteBreak(breakItem.id, index)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-4">
                      Keine Pausen für diesen Tag eingerichtet.
                    </p>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
