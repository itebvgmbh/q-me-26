import { useState, useCallback, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { startOfWeek, getDay, parse, format, addDays, subDays, addWeeks, subWeeks, startOfDay, endOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Appointment, Staff, updateAppointment, createAppointment } from '../utils/firestore';
import { WorkingHoursForm } from '../components/WorkingHoursForm';

interface Props {
  employee: Staff;
  appointments: Appointment[];
  onAppointmentUpdate: (appointment: Appointment) => void;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  status?: string;
  isWorkingHours?: boolean;
}

const locales = {
  'de': de,
};

const getStatusColor = (status?: string) => {
  switch (status) {
    case 'scheduled':
      return 'bg-blue-500';
    case 'in-progress':
      return 'bg-yellow-500';
    case 'completed':
      return 'bg-green-500';
    case 'cancelled':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
};

const getStatusText = (status?: string) => {
  switch (status) {
    case 'scheduled':
      return 'Geplant';
    case 'in-progress':
      return 'In Bearbeitung';
    case 'completed':
      return 'Abgeschlossen';
    case 'cancelled':
      return 'Storniert';
    default:
      return 'Unbekannt';
  }
};

export const EmployeeCalendar = ({ employee, appointments, onAppointmentUpdate }: Props) => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [view, setView] = useState('week');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showWorkingHoursDialog, setShowWorkingHoursDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newAppointment, setNewAppointment] = useState({
    customerName: '',
    service: '',
    startTime: new Date(),
    endTime: new Date(Date.now() + 30 * 60000), // 30 minutes from now
    status: 'scheduled' as const,
    notes: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter(apt => {
      const matchesSearch = searchTerm === '' ||
        apt.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        apt.service.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(apt.status);
      
      return matchesSearch && matchesStatus;
    });
  }, [appointments, searchTerm, statusFilter]);

  const workingHoursEvents = useMemo(() => {
    if (!employee.workingHours) return [];

    const events: CalendarEvent[] = [];
    const currentDate = new Date();
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // Generate working hours events for the entire month
    for (let date = new Date(startOfMonth); date <= endOfMonth; date.setDate(date.getDate() + 1)) {
      const dayOfWeek = date.getDay();
      const workingHours = employee.workingHours.find(wh => wh.dayOfWeek === dayOfWeek);

      if (workingHours?.isWorking) {
        const [startHour, startMinute] = workingHours.startTime.split(':').map(Number);
        const [endHour, endMinute] = workingHours.endTime.split(':').map(Number);

        const start = new Date(date);
        start.setHours(startHour, startMinute, 0);
        const end = new Date(date);
        end.setHours(endHour, endMinute, 0);

        events.push({
          id: `working-hours-${date.toISOString()}`,
          title: 'Arbeitszeit',
          start,
          end,
          isWorkingHours: true,
        });
      }
    }

    return events;
  }, [employee.workingHours]);

  const handleEventDrop = useCallback(
    async ({ event, start, end }: any) => {
      try {
        const appointment = appointments.find(apt => apt.id === event.id);
        if (appointment) {
          // Update the appointment times
          await updateAppointment(appointment.id, {
            startTime: start,
            endTime: end,
          });
          toast.success('Termin erfolgreich verschoben');
        }
      } catch (error) {
        console.error('Error updating appointment:', error);
        toast.error('Fehler beim Verschieben des Termins');
      }
    },
    [appointments]
  );

  const handleEventResize = useCallback(
    async ({ event, start, end }: any) => {
      try {
        const appointment = appointments.find(apt => apt.id === event.id);
        if (appointment) {
          // Update the appointment times
          await updateAppointment(appointment.id, {
            startTime: start,
            endTime: end,
          });
          toast.success('Termin erfolgreich angepasst');
        }
      } catch (error) {
        console.error('Error updating appointment:', error);
        toast.error('Fehler beim Anpassen des Termins');
      }
    },
    [appointments]
  );

  const handleSelectSlot = useCallback((slotInfo: any) => {
    setNewAppointment(prev => ({
      ...prev,
      startTime: slotInfo.start,
      endTime: slotInfo.end
    }));
    setShowCreateDialog(true);
  }, []);

  const handleSelectEvent = useCallback((event: any) => {
    const appointment = appointments.find(apt => apt.id === event.id);
    if (appointment) {
      setSelectedAppointment(appointment);
      setShowEditDialog(true);
    }
  }, [appointments]);

  const handleAppointmentUpdate = async (appointmentId: string, status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled') => {
    try {
      const updatedAppointment = await updateAppointment(appointmentId, { status });
      onAppointmentUpdate(updatedAppointment);
      setShowEditDialog(false);
      toast.success('Termin erfolgreich aktualisiert');
    } catch (error: any) {
      console.error('Error updating appointment:', error);
      toast.error('Fehler beim Aktualisieren: ' + (error.message || 'Unbekannter Fehler'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">Terminkalender</h2>
          <div className="space-x-2">
            <Button onClick={() => setShowWorkingHoursDialog(true)}>
              Arbeitszeiten
            </Button>
            <Button onClick={() => setShowCreateDialog(true)}>
            Neuer Termin
          </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Input
              placeholder="Nach Kunde oder Service suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={statusFilter.includes('scheduled') ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(prev =>
                prev.includes('scheduled')
                  ? prev.filter(s => s !== 'scheduled')
                  : [...prev, 'scheduled']
              )}
            >
              Geplant
            </Badge>
            <Badge
              variant={statusFilter.includes('in-progress') ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(prev =>
                prev.includes('in-progress')
                  ? prev.filter(s => s !== 'in-progress')
                  : [...prev, 'in-progress']
              )}
            >
              In Bearbeitung
            </Badge>
            <Badge
              variant={statusFilter.includes('completed') ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(prev =>
                prev.includes('completed')
                  ? prev.filter(s => s !== 'completed')
                  : [...prev, 'completed']
              )}
            >
              Abgeschlossen
            </Badge>
            <Badge
              variant={statusFilter.includes('cancelled') ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(prev =>
                prev.includes('cancelled')
                  ? prev.filter(s => s !== 'cancelled')
                  : [...prev, 'cancelled']
              )}
            >
              Storniert
            </Badge>
          </div>
        </div>
      </div>

      <Tabs defaultValue="week" className="w-full">
        <TabsList>
          <TabsTrigger value="day">Tag</TabsTrigger>
          <TabsTrigger value="week">Woche</TabsTrigger>
        </TabsList>

        <div className="flex justify-between items-center mt-4">
          <Button
            variant="outline"
            onClick={() => {
              if (view === 'day') {
                setSelectedDate(subDays(selectedDate, 1));
              } else {
                setSelectedDate(subWeeks(selectedDate, 1));
              }
            }}
          >
            ← {view === 'day' ? 'Vorheriger Tag' : 'Vorherige Woche'}
          </Button>
          <h2 className="text-lg font-semibold">
            {view === 'day' ? (
              format(selectedDate, 'EEEE, dd.MM.yyyy', { locale: de })
            ) : (
              <>
                {format(startOfWeek(selectedDate, { locale: de }), 'dd.MM.yyyy')} - {format(addDays(startOfWeek(selectedDate, { locale: de }), 6), 'dd.MM.yyyy')}
              </>
            )}
          </h2>
          <Button
            variant="outline"
            onClick={() => {
              if (view === 'day') {
                setSelectedDate(addDays(selectedDate, 1));
              } else {
                setSelectedDate(addWeeks(selectedDate, 1));
              }
            }}
          >
            {view === 'day' ? 'Nächster Tag' : 'Nächste Woche'} →
          </Button>
        </div>

        <TabsContent value="day" className="mt-4">
          <div className="space-y-4">
            {employee.workingHours
              ?.filter(wh => wh.dayOfWeek === selectedDate.getDay() && wh.isWorking)
              .map((wh, index) => (
                <Card key={index} className="bg-gray-50 border-dashed">
                  <CardHeader>
                    <CardTitle className="text-gray-500">Arbeitszeit</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p>{wh.startTime} - {wh.endTime} Uhr</p>
                  </CardContent>
                </Card>
              ))}

            {filteredAppointments
              .filter(apt => {
                const aptDate = apt.startTime.toDate();
                return (
                  aptDate >= startOfDay(selectedDate) &&
                  aptDate < endOfDay(selectedDate)
                );
              })
              .sort((a, b) => a.startTime.toDate().getTime() - b.startTime.toDate().getTime())
              .map(apt => (
                <Card
                  key={apt.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handleSelectEvent(apt)}
                >
                  <CardHeader>
                    <CardTitle className="flex justify-between items-center">
                      <span>{apt.customerName}</span>
                      <Badge className={getStatusColor(apt.status)}>
                        {getStatusText(apt.status)}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p><strong>Service:</strong> {apt.service}</p>
                      <p><strong>Zeit:</strong> {apt.startTime.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {apt.endTime.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      {apt.notes && <p><strong>Notizen:</strong> {apt.notes}</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </TabsContent>

        <TabsContent value="week" className="mt-4">
          <div className="grid grid-cols-7 gap-4">
            {Array.from({ length: 7 }, (_, i) => {
              const date = addDays(startOfWeek(selectedDate, { locale: de }), i);
              const dayAppointments = filteredAppointments.filter(apt => {
                const aptDate = apt.startTime.toDate();
                return (
                  aptDate >= startOfDay(date) &&
                  aptDate < endOfDay(date)
                );
              });

              const workingHours = employee.workingHours
                ?.filter(wh => wh.dayOfWeek === date.getDay() && wh.isWorking);

              return (
                <div key={date.toISOString()} className="space-y-4">
                  <h3 className="font-semibold text-center">
                    {format(date, 'EEEE', { locale: de })}
                    <br />
                    {format(date, 'dd.MM.')}
                  </h3>

                  {workingHours?.map((wh, index) => (
                    <Card key={index} className="bg-gray-50 border-dashed">
                      <CardHeader>
                        <CardTitle className="text-gray-500 text-sm">Arbeitszeit</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm">{wh.startTime} - {wh.endTime} Uhr</p>
                      </CardContent>
                    </Card>
                  ))}

                  {dayAppointments
                    .sort((a, b) => a.startTime.toDate().getTime() - b.startTime.toDate().getTime())
                    .map(apt => (
                      <Card
                        key={apt.id}
                        className="cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => handleSelectEvent(apt)}
                      >
                        <CardHeader>
                          <CardTitle className="flex justify-between items-center text-sm">
                            <span>{apt.customerName}</span>
                            <Badge className={getStatusColor(apt.status)}>
                              {getStatusText(apt.status)}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-1 text-sm">
                            <p>{apt.service}</p>
                            <p>{apt.startTime.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuen Termin erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Kundenname</Label>
              <Input
                value={newAppointment.customerName}
                onChange={(e) => setNewAppointment(prev => ({ ...prev, customerName: e.target.value }))}
                placeholder="Name des Kunden"
              />
            </div>
            <div className="space-y-2">
              <Label>Service</Label>
              <Input
                value={newAppointment.service}
                onChange={(e) => setNewAppointment(prev => ({ ...prev, service: e.target.value }))}
                placeholder="Art des Services"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={newAppointment.status}
                onValueChange={(value: any) => setNewAppointment(prev => ({ ...prev, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Geplant</SelectItem>
                  <SelectItem value="in-progress">In Bearbeitung</SelectItem>
                  <SelectItem value="completed">Abgeschlossen</SelectItem>
                  <SelectItem value="cancelled">Storniert</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notizen</Label>
              <Input
                value={newAppointment.notes}
                onChange={(e) => setNewAppointment(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Zusätzliche Notizen"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Abbrechen
            </Button>
            <Button
              onClick={async () => {
                try {
                  await createAppointment({
                    ...newAppointment,
                    employeeId: employee.id
                  });
                  setShowCreateDialog(false);
                  toast.success('Termin erfolgreich erstellt');
                } catch (error) {
                  console.error('Error creating appointment:', error);
                  toast.error('Fehler beim Erstellen des Termins');
                }
              }}
            >
              Termin erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Termin bearbeiten</DialogTitle>
          </DialogHeader>
          {selectedAppointment && (
            <div className="space-y-4">
              <div>
                <Label>Kunde</Label>
                <p>{selectedAppointment.customerName}</p>
              </div>
              <div>
                <Label>Service</Label>
                <p>{selectedAppointment.service}</p>
              </div>
              <div>
                <Label>Status</Label>
                <div className="space-x-2 mt-2">
                  <Button
                    variant={selectedAppointment.status === 'scheduled' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleAppointmentUpdate(selectedAppointment.id, 'scheduled')}
                  >
                    Geplant
                  </Button>
                  <Button
                    variant={selectedAppointment.status === 'in-progress' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleAppointmentUpdate(selectedAppointment.id, 'in-progress')}
                  >
                    In Bearbeitung
                  </Button>
                  <Button
                    variant={selectedAppointment.status === 'completed' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleAppointmentUpdate(selectedAppointment.id, 'completed')}
                  >
                    Abgeschlossen
                  </Button>
                  <Button
                    variant={selectedAppointment.status === 'cancelled' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleAppointmentUpdate(selectedAppointment.id, 'cancelled')}
                  >
                    Storniert
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showWorkingHoursDialog} onOpenChange={setShowWorkingHoursDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Arbeitszeiten bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <WorkingHoursForm
              employee={employee}
              onUpdate={(updatedEmployee) => {
                onAppointmentUpdate(updatedEmployee);
                setShowWorkingHoursDialog(false);
              }}
              onCancel={() => setShowWorkingHoursDialog(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
