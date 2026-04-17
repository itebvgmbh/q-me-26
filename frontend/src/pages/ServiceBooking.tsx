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
                    forceRefresh={!!refreshTimestamp}
                    onTimeSlotSelect={(timeSlot) => {
                      // Nach erfolgreicher Buchung in die Buchungsübersicht navigieren
                      navigate('/my-bookings');
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
};

export default ServiceBooking;
