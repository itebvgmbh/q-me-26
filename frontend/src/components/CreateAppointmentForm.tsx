import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { addMinutes } from 'date-fns';
import { toast } from 'sonner';
import { AvailableTimeSlotPicker } from './AvailableTimeSlotPicker';

// App imports
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Types
import { Service, Staff, Customer, Appointment } from '../utils/firestore';

interface CreateAppointmentFormProps {
  services: Service[];
  staff: Staff[];
  customers: Customer[];
  shopId: string;
  onCreateAppointment: (appointment: Appointment) => void;
  onCancel: () => void;
  appointmentType: 'booked' | 'queue';
  setAppointmentType: (type: 'booked' | 'queue') => void;
  createAppointment: (appointmentData: any) => Promise<Appointment>;
}

export const CreateAppointmentForm = ({
  services,
  staff,
  customers,
  shopId,
  onCreateAppointment,
  onCancel,
  appointmentType,
  setAppointmentType,
  createAppointment
}: CreateAppointmentFormProps) => {
  const [newAppointmentData, setNewAppointmentData] = useState({
    customerId: '',
    customerName: '',
    serviceId: '',
    staffId: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: '10:00',
    duration: 30,
    price: 0
  });

  // Update appointment duration and price when service changes
  useEffect(() => {
    if (newAppointmentData.serviceId) {
      const selectedService = services.find(s => s.id === newAppointmentData.serviceId);
      if (selectedService) {
        setNewAppointmentData(prev => ({
          ...prev,
          duration: selectedService.duration,
          price: selectedService.price
        }));
      }
    }
  }, [newAppointmentData.serviceId, services]);

  const handleAppointmentInputChange = (field: string, value: any) => {
    setNewAppointmentData(prev => ({
      ...prev,
      [field]: field === 'price' || field === 'duration' ? Number(value) : value
    }));
  };

  const handleCreateAppointment = async () => {
    try {
      // Parse time and create datetime
      const [hours, minutes] = newAppointmentData.time.split(':').map(Number);
      const startTime = new Date(newAppointmentData.date);
      startTime.setHours(hours, minutes, 0, 0);
      
      // Calculate end time based on duration
      const endTime = addMinutes(startTime, newAppointmentData.duration);
      
      // Wenn es sich um einen Bestandskunden handelt (customerId vorhanden),
      // wird createAppointment automatisch den displayName aus der users-Collection verwenden
      
      // Create the appointment
      const appointmentData = {
        shopId: shopId,
        customerId: newAppointmentData.customerId || 'walk-in',
        customerName: newAppointmentData.customerName,
        serviceId: newAppointmentData.serviceId,
        staffId: newAppointmentData.staffId,
        startTime: startTime,
        endTime: endTime,
        price: newAppointmentData.price,
        status: 'scheduled',
        type: appointmentType
      };
      
      const createdAppointment = await createAppointment(appointmentData);
      
      toast.success(`${appointmentType === 'booked' ? 'Termin' : 'Warteschlangen-Eintrag'} erfolgreich erstellt`);
      onCreateAppointment(createdAppointment);
      
      // Reset form data
      setNewAppointmentData({
        customerId: '',
        customerName: '',
        serviceId: '',
        staffId: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        time: '10:00',
        duration: 30,
        price: 0
      });
    } catch (error: any) {
      console.error('Error creating appointment:', error);
      toast.error(`Fehler beim Erstellen des ${appointmentType === 'booked' ? 'Termins' : 'Warteschlangen-Eintrags'}: ${error.message || 'Unbekannter Fehler'}`);
    }
  };

  // Helper function for unique customers
  const getUniqueCustomers = (customers: Customer[]) => {
    const uniqueMap = new Map();
    customers.forEach(customer => {
      if (!uniqueMap.has(customer.id)) {
        uniqueMap.set(customer.id, customer);
      }
    });
    return Array.from(uniqueMap.values());
  };

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="appointmentType">Termintyp</Label>
        <Select
          value={appointmentType}
          onValueChange={(value) => setAppointmentType(value as 'booked' | 'queue')}
          required
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
        <Label htmlFor="customerName">Kundenname</Label>
        <Input
          id="customerName"
          value={newAppointmentData.customerName}
          onChange={(e) => handleAppointmentInputChange('customerName', e.target.value)}
          placeholder="Name des Kunden"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="customerId">Kunde auswählen (optional)</Label>
        <Select
          value={newAppointmentData.customerId}
          onValueChange={(value) => {
            handleAppointmentInputChange('customerId', value);
            const customer = customers.find(c => c.id === value);
            if (customer) {
              handleAppointmentInputChange('customerName', customer.name);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Kunde auswählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="walk-in">Kein Bestandskunde / Walk-In</SelectItem>
            {getUniqueCustomers(customers).map((customer) => (
              <SelectItem key={customer.id} value={customer.id}>
                {customer.name} {customer.email ? `(${customer.email})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="serviceId">Service</Label>
        <Select
          value={newAppointmentData.serviceId}
          onValueChange={(value) => handleAppointmentInputChange('serviceId', value)}
          required
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
          value={newAppointmentData.staffId}
          onValueChange={(value) => handleAppointmentInputChange('staffId', value)}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Mitarbeiter auswählen" />
          </SelectTrigger>
          <SelectContent>
            {staff.filter(s => s.isActive).map((staffMember) => (
              <SelectItem key={staffMember.id} value={staffMember.id}>
                {staffMember.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="date">Datum</Label>
          <Input
            id="date"
            type="date"
            value={newAppointmentData.date}
            onChange={(e) => handleAppointmentInputChange('date', e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="time">Uhrzeit</Label>
          {newAppointmentData.serviceId && newAppointmentData.staffId ? (
            <AvailableTimeSlotPicker 
              shopId={shopId}
              serviceId={newAppointmentData.serviceId}
              staffId={newAppointmentData.staffId}
              date={newAppointmentData.date}
              value={newAppointmentData.time}
              onChange={(time) => handleAppointmentInputChange('time', time)}
            />
          ) : (
            <Input
              id="time"
              type="time"
              value={newAppointmentData.time}
              onChange={(e) => handleAppointmentInputChange('time', e.target.value)}
              required
              disabled={!newAppointmentData.serviceId || !newAppointmentData.staffId}
            />
          )}
          {(!newAppointmentData.serviceId || !newAppointmentData.staffId) && (
            <p className="text-xs text-amber-600 mt-1">Bitte wählen Sie zuerst einen Service und Mitarbeiter</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="duration">Dauer (Minuten)</Label>
          <Input
            id="duration"
            type="number"
            min="5"
            step="5"
            value={newAppointmentData.duration}
            onChange={(e) => handleAppointmentInputChange('duration', e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="price">Preis (€)</Label>
          <Input
            id="price"
            type="number"
            step="0.01"
            value={newAppointmentData.price}
            onChange={(e) => handleAppointmentInputChange('price', e.target.value)}
            required
          />
        </div>
      </div>

      <div className="pt-4 flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>Abbrechen</Button>
        <Button onClick={handleCreateAppointment}>
          {appointmentType === 'booked' ? 'Termin erstellen' : 'In Warteschlange einfügen'}
        </Button>
      </div>
    </div>
  );
};