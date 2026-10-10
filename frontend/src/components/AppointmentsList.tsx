import { useState } from 'react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, addMinutes } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import { de } from 'date-fns/locale';
import { Appointment, Service, Staff, Customer, updateAppointment, getUniqueCustomers } from '../utils/firestore';
import { customerLabel } from './counter/CounterLane';

export const STATUS_LABEL: Record<Appointment['status'], string> = {
  scheduled: 'Wartet',
  'in-progress': 'Ist dran',
  completed: 'Fertig',
  cancelled: 'Abgesagt',
};

interface Props {
  appointments: Appointment[];
  services: Service[];
  staff: Staff[];
  customers?: Customer[];
  selectedDate: Date;
  onAppointmentUpdate: (appointment: Appointment) => void;
}

export const AppointmentsList = ({ appointments, services, staff, customers = [], selectedDate, onAppointmentUpdate }: Props) => {
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState<Date | undefined>(undefined);
  const [appointmentTime, setAppointmentTime] = useState<string>('10:00');
  const [appointmentDuration, setAppointmentDuration] = useState<number>(30);
  const [appointmentFormData, setAppointmentFormData] = useState<Partial<Appointment>>({});
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);


  const statusChip = (status: Appointment['status']) =>
    cn(
      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
      status === 'in-progress' && 'bg-signal text-signal-foreground',
      status === 'scheduled' && 'border border-border',
      status === 'completed' && 'bg-foreground text-background',
      status === 'cancelled' && 'bg-destructive/10 text-destructive',
    );

  const handleStatusChange = async (status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled') => {
    if (!selectedAppointment) return;

    try {
      const updatedAppointment = await updateAppointment(selectedAppointment.id, { status });
      onAppointmentUpdate(updatedAppointment);
      toast.success(`Status: ${STATUS_LABEL[status]}`);
      setShowStatusDialog(false);
    } catch (error) {
      console.error('Error updating appointment status:', error);
      toast.error('Der Status konnte nicht geändert werden.');
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
      toast.success('Termin gespeichert.');
      setShowEditDialog(false);
    } catch (error: any) {
      console.error('Error updating appointment:', error);
      toast.error('Speichern hat nicht geklappt: ' + (error.message || 'unbekannter Fehler'));
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

  const sorted = [...appointments].sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5" aria-labelledby="tagesliste">
      <h3 id="tagesliste" className="font-display text-xl font-bold">
        Alle Termine am {format(selectedDate, 'EEEE, d. MMMM', { locale: de })}
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">An diesem Tag ist nichts eingetragen.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {sorted.map((appointment) => {
            const service = services.find((s) => s.id === appointment.serviceId);
            const person = staff.find((s) => s.id === appointment.staffId);
            return (
              <li key={appointment.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-3 sm:flex-nowrap sm:gap-x-4', appointment.status === 'cancelled' && 'opacity-60')}>
                <span className="flex w-14 shrink-0 flex-col whitespace-nowrap">
                  <span className="font-mono text-[15px] font-semibold">{format(appointment.startTime.toDate(), 'HH:mm')}</span>
                  <span className="text-xs text-muted-foreground">bis {format(appointment.endTime.toDate(), 'HH:mm')}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{customerLabel(appointment)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[service?.name || 'Leistung', person?.name || 'nicht zugeordnet', appointment.type === 'queue' ? 'Schlange' : 'Termin'].join(' · ')}
                  </span>
                </span>
                <span className={statusChip(appointment.status)}>{STATUS_LABEL[appointment.status] ?? appointment.status}</span>
                <span className="ml-auto flex gap-1 sm:ml-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedAppointment(appointment);
                      setShowStatusDialog(true);
                    }}
                  >
                    Status
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog(appointment)}>
                    Bearbeiten
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Status ändern */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Status ändern</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(STATUS_LABEL) as Appointment['status'][]).map((status) => (
              <Button key={status} variant={selectedAppointment?.status === status ? 'default' : 'outline'} onClick={() => handleStatusChange(status)}>
                {STATUS_LABEL[status]}
              </Button>
            ))}
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
                      {service.name} ({service.duration} Min, {Number(service.price || 0).toFixed(2)} €)
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
                <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
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
                  <SelectItem value="scheduled">{STATUS_LABEL.scheduled}</SelectItem>
                  <SelectItem value="in-progress">{STATUS_LABEL['in-progress']}</SelectItem>
                  <SelectItem value="completed">{STATUS_LABEL.completed}</SelectItem>
                  <SelectItem value="cancelled">{STATUS_LABEL.cancelled}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="checkEarlierOptions"
                checked={appointmentFormData.checkEarlierOptions || false}
                onCheckedChange={(v) => handleInputChange('checkEarlierOptions', v === true)}
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
    </section>
  );
};