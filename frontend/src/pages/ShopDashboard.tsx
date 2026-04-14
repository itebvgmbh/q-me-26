import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { format, startOfDay, endOfDay, addMinutes } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarDays, Users, Clock, EuroIcon, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';

// App imports
import { useCurrentUser, firebaseApp } from 'app';
import { APP_BASE_PATH } from 'app';
import { collection, query, where, onSnapshot, Timestamp, getFirestore } from 'firebase/firestore';

// Components
import { Navigation } from '../components/Navigation';
import { DailyMetricsCard } from '../components/DailyMetricsCard';
import { AppointmentsList } from '../components/AppointmentsList';
import { EditShopForm } from '../components/EditShopForm';
import { CreateAppointmentForm } from '../components/CreateAppointmentForm';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { CreateShopForm } from '../components/CreateShopForm';

// Firestore utils
import { 
  getShopsByOwnerId,
  getShopById,
  getShopStaff, 
  getTodayAppointments, 
  getDailyRevenue, 
  getAppointmentsInRange, 
  createShop, 
  createAppointment, 
  Shop, 
  Staff, 
  Appointment, 
  Service, 
  getServicesByShopId, 
  getCustomersByShopId, 
  getUniqueCustomers,
  Customer 
} from '../utils/firestore';

// Profile utils
import { getUserProfile } from '../utils/user-profile-service';

// UI Components
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ShopDashboard = () => {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useCurrentUser();
  const [shops, setShops] = useState<Shop[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showCreateShop, setShowCreateShop] = useState(false);
  const [showEditShop, setShowEditShop] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadShopData = async (shopId: string) => {
    setIsLoading(true);
    try {
      // Lade Shop-Details
      const shopData = await getShopById(shopId);
      if (!shopData) {
        toast.error('Shop konnte nicht geladen werden');
        setIsLoading(false);
        return;
      }
      
      setShop(shopData);
      
      // Lade Mitarbeiter, Services und Kunden
      const [staffData, servicesData, customersData] = await Promise.all([
        getShopStaff(shopData.id),
        getServicesByShopId(shopData.id),
        getCustomersByShopId(shopData.id)
      ]);
      
      setStaff(staffData.filter(s => s.isActive));
      setServices(servicesData);
      setCustomers(getUniqueCustomers(customersData));
      
      // Starte den Echtzeit-Listener für Termine
      setupAppointmentsListener(shopData.id, selectedDate);
    } catch (error) {
      console.error('Fehler beim Laden der Shop-Daten:', error);
      toast.error('Fehler beim Laden der Shop-Daten');
    } finally {
      setIsLoading(false);
    }
  };

  // Shop-Wechsel Handler
  const handleShopChange = async (shopId: string) => {
    const selectedShop = shops.find(s => s.id === shopId);
    if (selectedShop) {
      await loadShopData(selectedShop.id);
    }
  };

  // Bereinige Listener beim Unmounten
  useEffect(() => {
    return () => {
      if (window.appointmentsUnsubscribe) {
        window.appointmentsUnsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const loadUserShops = async () => {
      if (!userLoading) {
        if (!user) {
          navigate('/login');
          return;
        }

        const profile = await getUserProfile(user.uid);
        if (!profile || profile.role !== 'shopOwner') {
          console.error('User is not a shop owner');
          navigate('/');
          return;
        }

        // Lade alle Shops des Betreibers
        try {
          const userShops = await getShopsByOwnerId(user.uid);
          setShops(userShops);
          
          if (userShops.length > 0) {
            // Lade Daten für den ersten Shop
            await loadShopData(userShops[0].id);
          } else {
            // Keine Shops vorhanden
            setIsLoading(false);
          }
        } catch (error) {
          console.error('Error loading shops:', error);
          toast.error('Fehler beim Laden der Shops');
          setIsLoading(false);
        }
      }
    };

    loadUserShops();
  }, [user, userLoading, navigate]);
  
  // Neustart des Echtzeit-Listeners, wenn sich das ausgewählte Datum ändert
  useEffect(() => {
    if (shop) {
      setupAppointmentsListener(shop.id, selectedDate);
    }
  }, [selectedDate]);
  
  // Declare a global variable to store the unsubscribe function
declare global {
  interface Window {
    appointmentsUnsubscribe?: () => void;
  }
}

// Funktion zum Einrichten des Echtzeit-Listeners für Termine
  const setupAppointmentsListener = (shopId: string, date: Date) => {
    console.log('Setting up appointments listener for shop:', shopId, 'and date:', date);
    try {
      // Lade Termine für das ausgewählte Datum
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);
      
      const db = getFirestore(firebaseApp);
      const appointmentsRef = collection(db, 'appointments');
      
      // Erstelle Query mit shopId und Datumsbereich
      const q = query(
        appointmentsRef,
        where('shopId', '==', shopId),
        where('startTime', '>=', Timestamp.fromDate(dayStart)),
        where('startTime', '<', Timestamp.fromDate(dayEnd))
      );
      
      // Cleanup vorheriger Listener, falls vorhanden
      if (window.appointmentsUnsubscribe) {
        window.appointmentsUnsubscribe();
      }
      
      // Echtzeit-Listener für Termine
      window.appointmentsUnsubscribe = onSnapshot(q, (snapshot) => {
        const appointmentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Appointment[];
        console.log('Appointments updated in real-time:', appointmentsData.length);
        setAppointments(appointmentsData);
        
        // Berechne Umsatz für das ausgewählte Datum
        const dailyRevenue = appointmentsData
          .filter(app => app.status === 'completed')
          .reduce((sum, app) => sum + (app.price || 0), 0);
        setRevenue(dailyRevenue);
      }, (error) => {
        console.error('Error in appointments listener:', error);
      });
    } catch (error) {
      console.error('Error setting up appointments listener:', error);
    }
  };
  
  // Bereinige Listener beim Unmounten der Komponente
  useEffect(() => {
    return () => {
      if (window.appointmentsUnsubscribe) {
        window.appointmentsUnsubscribe();
      }
    };
  }, []);

  const [showCreateAppointmentDialog, setShowCreateAppointmentDialog] = useState(false);
  const [appointmentType, setAppointmentType] = useState<'booked' | 'queue'>('booked');
  
  





  if (userLoading || !user) {
    return null;
  }
  
  if (isLoading) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto p-6 flex justify-center items-center h-screen">
          <p>Lädt...</p>
        </div>
      </>
    );
  }

  if (!shop) {
    return (
    <>
      <Navigation />
      <div className="container mx-auto p-6">
        <Dialog open={showCreateShop} onOpenChange={setShowCreateShop}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Neuen Shop erstellen</DialogTitle>
            </DialogHeader>
            <CreateShopForm 
              userId={user.uid}
              onShopCreated={(createdShop) => {
                setShop(createdShop);
                setShops([createdShop]);
                setShowCreateShop(false);
              }}
              createShop={createShop}
            />
          </DialogContent>
        </Dialog>
        <div className="flex justify-center items-center h-[70vh] flex-col gap-4">
          <h1 className="text-2xl font-bold">Willkommen im Shop-Dashboard</h1>
          <p className="text-gray-600">Sie haben noch keinen Shop erstellt.</p>
          <Button onClick={() => setShowCreateShop(true)}>Neuen Shop erstellen</Button>
        </div>
      </div>
      </>
  );
  }

  return (
    <>
      <Navigation />
      <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">{shop.name} - Dashboard</h1>
          <Select value={shop.id} onValueChange={handleShopChange}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Shop auswählen" />
            </SelectTrigger>
            <SelectContent>
              {shops.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/staff-management')}
          >
            Mitarbeiter verwalten
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/service-management')}
          >
            Services verwalten
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowEditShop(true)}
          >
            Shop-Profil bearbeiten
          </Button>
          <Button
            onClick={() => setShowCreateShop(true)}
          >
            Neuen Shop erstellen
          </Button>
        </div>
      </div>

      <Dialog open={showEditShop} onOpenChange={setShowEditShop}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Shop-Profil bearbeiten</DialogTitle>
            <DialogDescription>
              Bearbeiten Sie die Details Ihres Shops. Alle Änderungen werden sofort gespeichert.
            </DialogDescription>
          </DialogHeader>
          <EditShopForm
            shop={shop}
            onUpdate={(updatedShop) => {
              setShop(updatedShop);
              setShowEditShop(false);
            }}
            onCancel={() => setShowEditShop(false)}
          />
        </DialogContent>
      </Dialog>
      
      {/* Dialog zum Erstellen eines neuen Shops */}
      <Dialog open={showCreateShop} onOpenChange={setShowCreateShop}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Neuen Shop erstellen</DialogTitle>
          </DialogHeader>
          <CreateShopForm 
            userId={user.uid}
            onShopCreated={(createdShop) => {
              // Füge den neuen Shop zur Liste hinzu
              setShops([...shops, createdShop]);
              setShowCreateShop(false);
              toast.success('Shop erfolgreich erstellt');
            }}
            createShop={createShop}
          />
        </DialogContent>
      </Dialog>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <DailyMetricsCard
          title={`Termine ${format(selectedDate, 'dd.MM.yyyy', { locale: de })}`}
          value={appointments.length.toString()}
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <DailyMetricsCard
          title="Aktive Mitarbeiter"
          value={staff.filter(s => s.isActive && s.status !== 'off').length.toString()}
          icon={<Users className="h-4 w-4" />}
        />
        <DailyMetricsCard
          title="Wartende Kunden"
          value={appointments.filter(a => a.status === 'scheduled').length.toString()}
          icon={<Clock className="h-4 w-4" />}
        />
        <DailyMetricsCard
          title="Tagesumsatz"
          value={`${revenue.toFixed(2)} €`}
          icon={<EuroIcon className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium">Termine anzeigen für</h3>
            <div className="flex items-center">
              <CalendarIcon className="mr-2 h-4 w-4" />
              <Input
                type="date"
                value={format(selectedDate, 'yyyy-MM-dd')}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedDate(new Date(e.target.value));
                  }
                }}
                className="w-40"
              />
            </div>
          </div>
          
          <div className="flex justify-between items-center mb-4">
            <Button
              onClick={() => {
                setAppointmentType('booked');
                setShowCreateAppointmentDialog(true);
              }}
              className="mb-4"
            >
              Termin erstellen
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setAppointmentType('queue');
                setShowCreateAppointmentDialog(true);
              }}
              className="mb-4"
            >
              In Warteschlange einfügen
            </Button>
          </div>
          <AppointmentsList
            appointments={appointments}
            services={services}
            staff={staff}
            customers={customers}
            selectedDate={selectedDate}
            onAppointmentUpdate={(updatedAppointment) => {
              setAppointments(appointments.map(apt =>
                apt.id === updatedAppointment.id ? updatedAppointment : apt
              ));
            }}
          />
        </div>
        <QRCodeDisplay shopId={shop.id} />
      </div>

      {/* Create Appointment Dialog */}
      <Dialog open={showCreateAppointmentDialog} onOpenChange={setShowCreateAppointmentDialog}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Neuen Termin erstellen</DialogTitle>
          </DialogHeader>
          <CreateAppointmentForm
            services={services}
            staff={staff}
            customers={customers}
            shopId={shop.id}
            onCreateAppointment={(createdAppointment) => {
              // Update appointments list if the appointment is for the selected date
              const dayStart = startOfDay(selectedDate);
              const dayEnd = endOfDay(selectedDate);
              if (createdAppointment.startTime >= dayStart && createdAppointment.startTime <= dayEnd) {
                setAppointments([...appointments, createdAppointment]);
              }
              setShowCreateAppointmentDialog(false);
            }}
            onCancel={() => setShowCreateAppointmentDialog(false)}
            appointmentType={appointmentType}
            setAppointmentType={setAppointmentType}
            createAppointment={createAppointment}
          />
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
};

export default ShopDashboard;