import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Service, Staff, Customer, createAppointment, getCustomersByShopId, createCustomer, getUniqueCustomers } from '../utils/firestore';
import { Timestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { format } from 'date-fns';
import useTimeSlotStore from '../utils/timeSlotStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  startTime: Date;
  employee: Staff;
  services: Service[];
  onAppointmentCreated: () => void;
}

export const CreateAppointmentDialog = ({
  isOpen,
  onClose,
  startTime,
  employee,
  services,
  onAppointmentCreated,
}: Props) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [isNewCustomer, setIsNewCustomer] = useState(true);
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [appointmentStartTime, setAppointmentStartTime] = useState<Date>(startTime);

  useEffect(() => {
    if (!isOpen) return; // Only load when dialog is open

    console.log('Loading customers for shop:', employee.shopId);
    const loadCustomers = async () => {
      const loadedCustomers = await getCustomersByShopId(employee.shopId);
      // Deduplizierung der Kundenliste - nur eindeutige Kunden anzeigen
      const uniqueCustomers = getUniqueCustomers(loadedCustomers);
      console.log('Original customer count:', loadedCustomers.length);
      console.log('Deduplicated customer count:', uniqueCustomers.length);
      console.log('Loaded customers:', loadedCustomers);
      setCustomers(uniqueCustomers);
      console.log('Set customers in state:', loadedCustomers);
    };
    loadCustomers();
    
    // Update appointment start time when dialog opens or startTime prop changes
    setAppointmentStartTime(startTime);
  }, [employee.shopId, isOpen, startTime]);
  const [serviceId, setServiceId] = useState('');
  const [duration, setDuration] = useState(30); // Default 30 minutes
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Zugriff auf die Cache-Invalidierungsfunktion
  const invalidateCache = useTimeSlotStore(state => state.invalidateCache);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceId || (isNewCustomer && !customerName) || (!isNewCustomer && !selectedCustomerId)) {
      toast.error('Bitte füllen Sie alle Pflichtfelder aus');
      return;
    }

    setIsSubmitting(true);
    try {
      const endTime = new Date(appointmentStartTime.getTime() + duration * 60000);
      
      let customerId = selectedCustomerId;
      let finalCustomerName = customerName;

      console.log('Creating appointment, isNewCustomer:', isNewCustomer);
      if (isNewCustomer) {
        // Create new customer
        const newCustomer = await createCustomer({
          shopId: employee.shopId,
          name: customerName,
          email: customerEmail,
          phone: customerPhone,
        });
        customerId = newCustomer.id;
        finalCustomerName = newCustomer.name;
      } else {
        const customer = customers.find(c => c.id === selectedCustomerId);
        if (!customer) throw new Error('Selected customer not found');
        finalCustomerName = customer.name;
      }

      console.log('Creating appointment with customer:', { customerId, finalCustomerName });
      // Convert Date objects to Timestamp objects
      const startTimestamp = Timestamp.fromDate(appointmentStartTime);
      const endTimestamp = Timestamp.fromDate(endTime);
      
      // Gemäß Task QME-61: Verwende IMMER users.displayName
      // In diesem Fall stammt der Name jedoch vom Kunden aus dem Formular
      const appointment = await createAppointment({
        shopId: employee.shopId,
        customerId,
        customerName: finalCustomerName,
        serviceId,
        staffId: employee.id,
        status: 'scheduled',
        startTime: startTimestamp,
        endTime: endTimestamp,
      });

      toast.success('Termin erfolgreich angelegt');
      console.log('Dialog closing after successful appointment creation');
      console.log('Appointment created successfully:', appointment);
      
      // Cache für diesen Shop und Datum invalidieren
      invalidateCache(employee.shopId, appointmentStartTime);
      
      onAppointmentCreated();
      onClose();
    } catch (error) {
      console.error('Error creating appointment:', error);
      toast.error('Fehler beim Anlegen des Termins');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neuen Termin anlegen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Startzeit</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={format(appointmentStartTime, 'yyyy-MM-dd')}
                  onChange={(e) => {
                    const newDate = new Date(e.target.value);
                    newDate.setHours(appointmentStartTime.getHours());
                    newDate.setMinutes(appointmentStartTime.getMinutes());
                    setAppointmentStartTime(newDate);
                  }}
                />
                <Input
                  type="time"
                  value={format(appointmentStartTime, 'HH:mm')}
                  onChange={(e) => {
                    const [hours, minutes] = e.target.value.split(':');
                    const updatedTime = new Date(appointmentStartTime);
                    updatedTime.setHours(parseInt(hours));
                    updatedTime.setMinutes(parseInt(minutes));
                    setAppointmentStartTime(updatedTime);
                  }}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Label>Kundentyp</Label>
                <div className="flex space-x-2">
                  <Button
                    type="button"
                    variant={isNewCustomer ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsNewCustomer(true)}
                  >
                    Neuer Kunde
                  </Button>
                  <Button
                    type="button"
                    variant={!isNewCustomer ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsNewCustomer(false)}
                  >
                    Bestandskunde
                  </Button>
                </div>
              </div>

              {isNewCustomer ? (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="customerName">Name</Label>
                    <Input
                      id="customerName"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="customerEmail">Email</Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="customerPhone">Telefon</Label>
                    <Input
                      id="customerPhone"
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <Label htmlFor="customerId">Kunde auswählen</Label>
                  <Select
                    value={selectedCustomerId}
                    onValueChange={setSelectedCustomerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Kunde auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Nur unterschiedliche Kunden zeigen, basierend auf ID + Email */}
                      {getUniqueCustomers(customers).map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="service">Service</Label>
              <Select
                value={serviceId}
                onValueChange={(id) => {
                  setServiceId(id);
                  // Bei Service-Auswahl die Service-Dauer als Standard setzen
                  const selectedService = services.find(service => service.id === id);
                  if (selectedService?.duration) {
                    setDuration(selectedService.duration);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Service auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name} ({service.duration} Min.)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="duration">Dauer (Minuten)</Label>
              <Input
                id="duration"
                type="number"
                min="15"
                step="15"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Speichern...' : 'Termin anlegen'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
