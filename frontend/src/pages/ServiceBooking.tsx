import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { format, startOfDay, addDays } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import { doc, collection, setDoc } from 'firebase/firestore';

import { Navigation } from '../components/Navigation';
import { CustomerTimelineView } from '../components/CustomerTimelineView';
import { firestore } from '../utils/firestore-client';
import useTimeSlotStore from '../utils/timeSlotStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronLeft } from 'lucide-react';
import { useCurrentUser } from 'app';
import { getShopById, getServiceById, getStaffByShopId, createAppointment, createCustomer, isTimeSlotAvailable, Shop, Service, Staff } from '../utils/firestore';
import { CalendarTimeSlot } from '../utils/types';

const ServiceBooking = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shopId = searchParams.get('shopId');
  const serviceId = searchParams.get('serviceId');
  const { user, loading: authLoading } = useCurrentUser();

  const [refreshTimestamp, setRefreshTimestamp] = useState<number>(Date.now());
  const [shop, setShop] = useState<Shop | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<CalendarTimeSlot | null>(null);
  const [checkEarlierOptions, setCheckEarlierOptions] = useState(false);
  const [loading, setLoading] = useState(true);

  const getTimeSlots = useTimeSlotStore(state => state.getTimeSlots);

  // Lade Shop- und Service-Daten aus den URL-Parametern
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      if (!shopId || !serviceId) {
        toast.error('Shop und Service müssen angegeben werden');
        navigate('/book-appointment');
        return;
      }

      try {
        // Shop laden
        const shopData = await getShopById(shopId);
        if (!shopData) {
          toast.error('Shop nicht gefunden');
          navigate('/book-appointment');
          return;
        }
        setShop(shopData);

        // Service laden
        const serviceData = await getServiceById(shopId, serviceId);
        if (!serviceData) {
          toast.error('Service nicht gefunden');
          navigate('/book-appointment');
          return;
        }
        setService(serviceData);

        // Mitarbeiter laden
        const staffData = await getStaffByShopId(shopId);
        const activeStaff = staffData.filter(s => s.isActive);
        setStaff(activeStaff);

        setLoading(false);
      } catch (error) {
        console.error('Fehler beim Laden der Daten:', error);
        toast.error('Fehler beim Laden der Daten');
        navigate('/book-appointment');
      }
    };

    loadData();
  }, [shopId, serviceId, navigate]);

  // Hilfsfunktion zur Prüfung der Timeslot-Verfügbarkeit
  const checkDirectAvailability = async (shopId: string, staffId: string, startTime: Date, endTime: Date): Promise<boolean> => {
    try {
      console.log(`Direct availability check for ${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`);
      return await isTimeSlotAvailable(
        shopId,
        staffId,
        Timestamp.fromDate(startTime),
        Timestamp.fromDate(endTime)
      );
    } catch (error) {
      console.error('Error in direct availability check:', error);
      return false;
    }
  };

  const handleBookAppointment = async () => {
    if (!user) {
      // Redirect to PublicJoinQueue instead of login
      navigate(`/public-join-queue?shopId=${shopId}&serviceId=${serviceId}`);
      return;
    }

    // Validierung
    if (!shopId || !serviceId || !selectedTimeSlot) {
      toast.error('Bitte füllen Sie alle erforderlichen Felder aus');
      return;
    }

    try {
      console.log('Starting booking process...');
      const startTime = selectedTimeSlot.start;
      const endTime = selectedTimeSlot.end;
      
      console.log(`Selected slot: ${startTime.toLocaleString()} - ${endTime.toLocaleString()}`);

      // Direkte Verfügbarkeitsüberprüfung vor dem Buchungsversuch
      const staffIdToUse = (selectedStaff && selectedStaff !== 'any') ? selectedStaff : (selectedTimeSlot.staffId || '');
      if (!staffIdToUse) {
        toast.error('Kein Mitarbeiter für diesen Zeitslot verfügbar');
        return;
      }

      console.log('Checking direct availability...');
      const isAvailable = await checkDirectAvailability(shopId, staffIdToUse, startTime, endTime);
      
      if (!isAvailable) {
        console.log('Direct availability check failed - slot is not available');
        toast.error('Dieser Zeitslot ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen Termin.');
        
        // Force refresh of time slots
        await getTimeSlots(shopId, serviceId, selectedStaff || null, startOfDay(currentDate), true);
        setSelectedTimeSlot(null);
        setRefreshTimestamp(Date.now());
        return;
      }
      
      console.log('Slot is available, proceeding with booking...');
      
      // Create or retrieve customer record
      try {
        await createCustomer({
          shopId: shopId,
          name: user.displayName || user.email?.split('@')[0] || 'Unbekannt',
          email: user.email || '',
          phone: '', // Optional
          userId: user.uid, // Verknüpfung mit Firebase Auth User
        });
      } catch (err) {
        console.error('Error with customer record, but continuing...', err);
      }

      console.log('Creating appointment...');
      try {
        // Verwende die gemeinsame createAppointment-Funktion anstatt direktes Firestore
        const adjustedStartTime = startTime;
        const adjustedEndTime = endTime;
        
        console.log(`Original times: ${startTime.toLocaleString()} - ${endTime.toLocaleString()}`);
        
        const appointmentData = {
          shopId: shopId,
          staffId: staffIdToUse,
          customerId: user.uid,
          // Gemäß Task QME-61: Verwende IMMER users.displayName
          // Die komplette Implementierung zur Namensfindung ist in createAppointment
          // Verbesserte Namensermittlung mit mehreren Fallbacks
          customerName: user.displayName || 
                       (user.email ? user.email.split('@')[0] : null) || 
                       user.providerData?.[0]?.displayName || 
                       'Unbekannt',
          serviceId: serviceId,
          startTime: adjustedStartTime,  // Die createAppointment-Funktion konvertiert automatisch zu Timestamp
          endTime: adjustedEndTime,      // Die createAppointment-Funktion konvertiert automatisch zu Timestamp
          status: 'scheduled',
          type: 'booked',
          checkEarlierOptions: checkEarlierOptions,
          checkEarlierOptionsCreatedAt: checkEarlierOptions ? new Date() : undefined,
        };
        
        console.log('Creating appointment with data:', appointmentData);
        await createAppointment(appointmentData);
        
        // Die Cache-Invalidierung und Event-Emission erfolgt jetzt automatisch in createAppointment
        console.log('Booking successful!');
        toast.success('Termin erfolgreich gebucht');
        
        // Navigate to my bookings
        navigate('/my-bookings');
      } catch (appointmentError) {
        console.error('Error creating appointment:', appointmentError);
        toast.error('Fehler beim Buchen des Termins');
      }
    } catch (error) {
      console.error('Error in booking process:', error);
      toast.error('Fehler beim Buchen des Termins');
    }
  };

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold">Terminbuchung</h1>
          </div>
        </div>

        {loading ? (
          <div className="container mx-auto py-8">
            <p>Lädt...</p>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Terminbuchung für {service?.name}</CardTitle>
              <CardDescription>
                Bei {shop?.name}
                {shop?.address && <span> - {shop.address}</span>}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {staff.length > 0 && (
                <div className="space-y-2">
                  <Label>Mitarbeiter auswählen</Label>
                  <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                    <SelectTrigger>
                      <SelectValue placeholder="Jeder verfügbare Mitarbeiter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Jeder verfügbare Mitarbeiter</SelectItem>
                      {staff.map(employee => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2 mt-4">
                <Label className="text-lg font-medium">Terminfindung - Wählen Sie einen verfügbaren Zeitslot</Label>
                
                <div className="p-4 bg-gray-50 rounded-md">
                  <CustomerTimelineView
                    shopId={shopId || ''}
                    serviceId={serviceId || ''}
                    staffId={selectedStaff === 'any' ? null : selectedStaff}
                    services={service ? [service] : []}
                    startDate={currentDate}
                    numDays={1}
                    forceRefresh={refreshTimestamp}
                    onTimeSlotSelect={(timeSlot) => {
                      setSelectedTimeSlot(timeSlot);
                      toast.success(`Zeitslot von ${format(timeSlot.start, 'HH:mm')} bis ${format(timeSlot.end, 'HH:mm')} ausgewählt`);
                    }}
                  />
                </div>

                {selectedTimeSlot && (
                  <div className="p-4 bg-green-50 rounded-md">
                    <p className="font-medium">Ausgewählter Termin:</p>
                    <p>
                      Datum: {format(selectedTimeSlot.start, 'dd.MM.yyyy')}<br/>
                      Uhrzeit: {format(selectedTimeSlot.start, 'HH:mm')} - {format(selectedTimeSlot.end, 'HH:mm')} Uhr
                    </p>
                    
                    <div className="flex items-center space-x-2 mt-3">
                      <Checkbox 
                        id="check-earlier-options" 
                        checked={checkEarlierOptions} 
                        onCheckedChange={checked => setCheckEarlierOptions(checked === true)}
                      />
                      <label 
                        htmlFor="check-earlier-options"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        Bei früherer Option fragen
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex justify-end space-x-4">
              <Button variant="outline" onClick={() => navigate(-1)}>
                Abbrechen
              </Button>
              <Button 
                onClick={handleBookAppointment}
                disabled={!selectedTimeSlot}
              >
                Termin buchen
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </>
  );
};

export default ServiceBooking;
