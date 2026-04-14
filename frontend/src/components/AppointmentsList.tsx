import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, addMinutes, startOfDay, endOfDay, parseISO, setHours, setMinutes } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import { de } from 'date-fns/locale';
import { Appointment, Service, Staff, Customer, updateAppointment, getAppointmentsInRange, getUniqueCustomers } from '../utils/firestore';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';

interface Props {
  appointments: Appointment[];
  services: Service[];
  staff: Staff[];
  customers?: Customer[];
  selectedDate: Date;
  onAppointmentUpdate: (appointment: Appointment) => void;
}

export const AppointmentsList = ({ appointments, services, staff, customers = [], selectedDate, onAppointmentUpdate }: Props) => {
  const calendarRef = useRef<HTMLDivElement>(null);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState<Date | undefined>(undefined);
  const [appointmentTime, setAppointmentTime] = useState<string>('10:00');
  const [appointmentDuration, setAppointmentDuration] = useState<number>(30);
  const [appointmentFormData, setAppointmentFormData] = useState<Partial<Appointment>>({});
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Schließen des Kalenders bei Klick außerhalb
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    }

    // Nur Event-Listener hinzufügen, wenn Kalender geöffnet ist
    if (calendarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [calendarOpen]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 hover:bg-blue-200';
      case 'in-progress':
        return 'bg-yellow-100 hover:bg-yellow-200';
      case 'completed':
        return 'bg-green-100 hover:bg-green-200';
      case 'cancelled':
        return 'bg-red-100 hover:bg-red-200';
      default:
        return 'bg-gray-100 hover:bg-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scheduled':
        return '🕒';
      case 'in-progress':
        return '▶️';
      case 'completed':
        return '✅';
      case 'cancelled':
        return '❌';
      default:
        return '❓';
    }
  };

  const handleStatusChange = async (status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled') => {
    if (!selectedAppointment) return;

    try {
      const updatedAppointment = await updateAppointment(selectedAppointment.id, { status });
      onAppointmentUpdate(updatedAppointment);
      toast.success('Status erfolgreich aktualisiert');
      setShowStatusDialog(false);
    } catch (error) {
      console.error('Error updating appointment status:', error);
      toast.error('Fehler beim Aktualisieren des Status');
    }
  };
  const handleAppointmentEdit = async () => {
    if (!selectedAppointment || !appointmentDate) return;
    
    try {
      // Parse time and create datetime
      const [hours, minutes] = appointmentTime.split(':').map(Number);
      const startTime = new Date(appointmentDate);
      startTime.setHours(hours, minutes, 0, 0);
      
      // Calculate end time based on duration
      const endTime = addMinutes(startTime, appointmentDuration);
      
      // Ensure we have valid timestamps
      const startTimestamp = Timestamp.fromDate(startTime);
      const endTimestamp = Timestamp.fromDate(endTime);
      
      const updatedData: Partial<Appointment> = {
        ...appointmentFormData,
        startTime: startTimestamp,
        endTime: endTimestamp,
      };
      
      // Safety check for numeric price
      if (updatedData.price && typeof updatedData.price === 'string') {
        updatedData.price = parseFloat(updatedData.price as unknown as string);
      }
      
      const updatedAppointment = await updateAppointment(selectedAppointment.id, updatedData);
      onAppointmentUpdate(updatedAppointment);
      toast.success('Termin erfolgreich aktualisiert');
      setShowEditDialog(false);
    } catch (error: any) {
      console.error('Error updating appointment:', error);
      toast.error('Fehler beim Aktualisieren des Termins: ' + (error.message || 'Unbekannter Fehler'));
    }
  };
  
  const openEditDialog = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    const startDate = appointment.startTime.toDate();
    setAppointmentDate(startDate);
    setAppointmentTime(format(startDate, 'HH:mm'));
    
    // Calculate duration in minutes
    const endDate = appointment.endTime.toDate();
    const durationMs = endDate.getTime() - startDate.getTime();
    const durationMinutes = Math.round(durationMs / (1000 * 60));
    setAppointmentDuration(durationMinutes);
    
    // Set form data
    setAppointmentFormData({
      customerId: appointment.customerId,
      customerName: appointment.customerName,
      serviceId: appointment.serviceId,
      staffId: appointment.staffId,
      status: appointment.status,
      price: appointment.price,
      type: appointment.type || 'booked',
      checkEarlierOptions: appointment.checkEarlierOptions || false,
    });
    
    setShowEditDialog(true);
  };

  const handleInputChange = (field: string, value: any) => {
    if (field === 'customerId' && value !== 'walk-in') {
      const customer = customers.find(c => c.id === value);
      if (customer) {
        setAppointmentFormData(prev => ({
          ...prev,
          customerId: value,
          customerName: customer.name
        }));
      }
    } else {
      setAppointmentFormData(prev => ({
        ...prev,
        [field]: field === 'price' ? Number(value) : value
      }));
    }
  };

  if (!appointments.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Termine für {format(selectedDate, 'PPP', { locale: de })}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">Keine Termine für diesen Tag</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Termine für {format(selectedDate, 'PPP', { locale: de })}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {appointments.map((appointment) => {
            const service = services.find(s => s.id === appointment.serviceId);
            return (
              <div
                key={appointment.id}
                className={`flex items-center justify-between p-4 rounded-lg cursor-pointer transition-colors ${getStatusColor(appointment.status)}`}
              >
                <div className="flex-1">
                  <p className="font-medium">
                    {appointment.isAnonymous ? 
                      `Anonym (#${appointment.referenceCode})` : 
                      appointment.customerName || 'Unbekannt'}
                  </p>
                  <p className="text-sm text-gray-600">{service?.name || 'Unbekannter Service'}</p>
                  <p className="text-xs text-gray-500">
                    {staff.find(s => s.id === appointment.staffId)?.name || 'Kein Mitarbeiter zugewiesen'}
                  </p>
                  <p className="text-xs text-gray-400">ID: {appointment.id}</p>
                </div>
                <div className="text-right flex items-center gap-4">
                  <div>
                    <p className="font-medium">
                      {format(appointment.startTime.toDate(), 'HH:mm', { locale: de })} - 
                      {format(appointment.endTime.toDate(), 'HH:mm', { locale: de })}
                    </p>
                    <p className="text-sm text-gray-600 flex items-center justify-end gap-1">
                      {getStatusIcon(appointment.status)} {appointment.status}
                    </p>
                  </div>
                </div>
                <div className="ml-2 flex gap-2">
                  <div className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 rounded" onClick={() => {
                    setSelectedAppointment(appointment);
                    setShowStatusDialog(true);
                  }}>
                    Status
                  </div>
                  <div className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 rounded" onClick={() => openEditDialog(appointment)}>
                    Bearbeiten
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      {/* Status change dialog */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminstatus ändern</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 p-4">
            <div
              className="rounded-md border border-input bg-blue-100 hover:bg-blue-200 p-2 text-center cursor-pointer"
              onClick={() => handleStatusChange('scheduled')}
            >
              🕒 Geplant
            </div>
            <div
              className="rounded-md border border-input bg-yellow-100 hover:bg-yellow-200 p-2 text-center cursor-pointer"
              onClick={() => handleStatusChange('in-progress')}
            >
              ▶️ In Bearbeitung
            </div>
            <div
              className="rounded-md border border-input bg-green-100 hover:bg-green-200 p-2 text-center cursor-pointer"
              onClick={() => handleStatusChange('completed')}
            >
              ✅ Abgeschlossen
            </div>
            <div
              className="rounded-md border border-input bg-red-100 hover:bg-red-200 p-2 text-center cursor-pointer"
              onClick={() => handleStatusChange('cancelled')}
            >
              ❌ Storniert
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Edit appointment dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Termin bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="customerId">Kunde auswählen</Label>
              <Select
                value={appointmentFormData.customerId || 'walk-in'}
                onValueChange={(value) => handleInputChange('customerId', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Kunde auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk-in">Kein Bestandskunde / Walk-In</SelectItem>
                  {/* Robuste Deduplizierung von Kunden */}
                  {getUniqueCustomers(customers).map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name} {customer.email ? `(${customer.email})` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="customerName">Kundenname</Label>
              <Input
                id="customerName"
                value={appointmentFormData.customerName || ''}
                onChange={(e) => handleInputChange('customerName', e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="serviceId">Service</Label>
              <Select
                value={appointmentFormData.serviceId}
                onValueChange={(value) => handleInputChange('serviceId', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Service auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name} ({service.duration} Min, {service.price.toFixed(2)} €)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="staffId">Mitarbeiter</Label>
              <Select
                value={appointmentFormData.staffId || ''}
                onValueChange={(value) => handleInputChange('staffId', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Mitarbeiter auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((staffMember) => (
                    <SelectItem key={staffMember.id} value={staffMember.id}>
                      {staffMember.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Datum</Label>
              <div className="flex items-center">
                <Input
                  type="date"
                  value={appointmentDate ? format(appointmentDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      setAppointmentDate(new Date(e.target.value));
                    }
                  }}
                  className="w-full"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="time">Uhrzeit</Label>
              <div className="flex items-center">
                <Clock className="mr-2 h-4 w-4 text-gray-500" />
                <Input
                  id="time"
                  type="time"
                  value={appointmentTime}
                  onChange={(e) => setAppointmentTime(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="duration">Dauer (Minuten)</Label>
              <Input
                id="duration"
                type="number"
                min="5"
                step="5"
                value={appointmentDuration}
                onChange={(e) => setAppointmentDuration(Number(e.target.value))}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="price">Preis (€)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={appointmentFormData.price || ''}
                onChange={(e) => handleInputChange('price', e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="type">Termintyp</Label>
              <Select
                value={appointmentFormData.type || 'booked'}
                onValueChange={(value: 'queue' | 'booked') => 
                  handleInputChange('type', value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Termintyp auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="booked">Regulärer Termin</SelectItem>
                  <SelectItem value="queue">Warteschlangen-Eintrag</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={appointmentFormData.status}
                onValueChange={(value: 'scheduled' | 'in-progress' | 'completed' | 'cancelled') => 
                  handleInputChange('status', value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">🕒 Geplant</SelectItem>
                  <SelectItem value="in-progress">▶️ In Bearbeitung</SelectItem>
                  <SelectItem value="completed">✅ Abgeschlossen</SelectItem>
                  <SelectItem value="cancelled">❌ Storniert</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="checkEarlierOptions"
                className="rounded border-gray-300 focus:ring-primary"
                checked={appointmentFormData.checkEarlierOptions || false}
                onChange={(e) => handleInputChange('checkEarlierOptions', e.target.checked)}
              />
              <Label htmlFor="checkEarlierOptions">Bei früherem freien Termin benachrichtigen</Label>
            </div>
            
            <div className="pt-4 flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowEditDialog(false)}>Abbrechen</Button>
              <Button onClick={handleAppointmentEdit}>Speichern</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};