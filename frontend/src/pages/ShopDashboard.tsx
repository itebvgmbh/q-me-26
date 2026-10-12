import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, format, isToday, startOfDay, endOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser, firebaseApp } from 'app';
import { collection, query, where, onSnapshot, Timestamp, getFirestore } from 'firebase/firestore';

import { AppointmentsList } from '../components/AppointmentsList';
import { EditShopForm } from '../components/EditShopForm';
import { CreateAppointmentForm } from '../components/CreateAppointmentForm';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { CreateShopForm } from '../components/CreateShopForm';
import { CounterLane } from '../components/counter/CounterLane';
import {
  getShopsByOwnerId,
  getShopById,
  getShopStaff,
  createShop,
  createAppointment,
  Shop,
  Staff,
  Appointment,
  Service,
  getServicesByShopId,
  getCustomersByShopId,
  getUniqueCustomers,
  Customer,
} from '../utils/firestore';
import { getUserProfile } from '../utils/user-profile-service';
import { safelyConvertToDate } from '../utils/datetime';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3">
    <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
    <span className="font-mono text-2xl font-bold">{value}</span>
  </div>
);

/** Tresen: Schlange und Termine des Tages je Person, mit "Nächste Nummer aufrufen" */
const ShopDashboard = () => {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useCurrentUser();
  const [shops, setShops] = useState<Shop[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [now, setNow] = useState(new Date());
  const [showCreateShop, setShowCreateShop] = useState(false);
  const [showEditShop, setShowEditShop] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateAppointmentDialog, setShowCreateAppointmentDialog] = useState(false);
  const [appointmentType, setAppointmentType] = useState<'booked' | 'queue'>('queue');

  // Uhr für "wartet noch" – alle 30 Sekunden
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const loadShopData = async (shopId: string) => {
    setIsLoading(true);
    try {
      const shopData = await getShopById(shopId);
      if (!shopData) {
        toast.error('Der Laden konnte nicht geladen werden.');
        return;
      }
      setShop(shopData);
      const [staffData, servicesData, customersData] = await Promise.all([
        getShopStaff(shopData.id),
        getServicesByShopId(shopData.id),
        getCustomersByShopId(shopData.id),
      ]);
      setStaff(staffData.filter((s) => s.isActive !== false));
      setServices(servicesData);
      setCustomers(getUniqueCustomers(customersData));
    } catch (error) {
      console.error('Fehler beim Laden der Shop-Daten:', error);
      toast.error('Die Daten des Ladens konnten nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    (async () => {
      const profile = await getUserProfile(user.uid);
      if (!profile || profile.role !== 'shopOwner') {
        navigate('/');
        return;
      }
      try {
        const userShops = await getShopsByOwnerId(user.uid);
        setShops(userShops);
        if (userShops.length > 0) await loadShopData(userShops[0].id);
        else setIsLoading(false);
      } catch (error) {
        console.error('Error loading shops:', error);
        toast.error('Deine Läden konnten nicht geladen werden.');
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userLoading, navigate]);

  // Termine des gewählten Tages live mitlesen
  const shopId = shop?.id;
  const dayKey = format(selectedDate, 'yyyy-MM-dd');
  useEffect(() => {
    if (!shopId) return;
    const db = getFirestore(firebaseApp);
    const q = query(
      collection(db, 'appointments'),
      where('shopId', '==', shopId),
      where('startTime', '>=', Timestamp.fromDate(startOfDay(selectedDate))),
      where('startTime', '<', Timestamp.fromDate(endOfDay(selectedDate))),
    );
    return onSnapshot(
      q,
      (snapshot) => setAppointments(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Appointment)),
      (error) => console.error('Error in appointments listener:', error),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, dayKey]);

  const live = isToday(selectedDate);
  const stats = useMemo(() => {
    const priceOf = (a: Appointment) => a.price ?? services.find((s) => s.id === a.serviceId)?.price ?? 0;
    const active = appointments.filter((a) => a.status !== 'cancelled');
    return {
      waiting: active.filter((a) => a.status === 'scheduled' && (!live || safelyConvertToDate(a.endTime) > now)).length,
      running: active.filter((a) => a.status === 'in-progress').length,
      done: active.filter((a) => a.status === 'completed').length,
      revenue: active.filter((a) => a.status === 'completed').reduce((sum, a) => sum + Number(priceOf(a) || 0), 0),
    };
  }, [appointments, services, now, live]);

  // Spuren: je aktive Person, dazu Termine ohne (bekannte) Person
  const lanes = useMemo(() => {
    const list = staff.map((s) => ({ key: s.id, title: s.name, items: appointments.filter((a) => a.staffId === s.id && a.status !== 'cancelled') }));
    const orphan = appointments.filter((a) => a.status !== 'cancelled' && !staff.some((s) => s.id === a.staffId));
    if (orphan.length) list.push({ key: 'ohne', title: 'Ohne Zuordnung', items: orphan });
    return list;
  }, [staff, appointments]);

  const openCreate = (type: 'booked' | 'queue') => {
    setAppointmentType(type);
    setShowCreateAppointmentDialog(true);
  };

  if (userLoading || !user) return null;

  const createShopDialog = (
    <Dialog open={showCreateShop} onOpenChange={setShowCreateShop}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neuen Laden anlegen</DialogTitle>
        </DialogHeader>
        <CreateShopForm
          userId={user.uid}
          onShopCreated={(createdShop) => {
            setShops((prev) => [...prev, createdShop]);
            setShowCreateShop(false);
            toast.success('Dein Laden ist angelegt.');
            loadShopData(createdShop.id);
          }}
          createShop={createShop}
        />
      </DialogContent>
    </Dialog>
  );

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6" aria-busy="true" aria-label="Tresen wird geladen">
        <div className="h-12 w-64 animate-pulse rounded-2xl bg-muted" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        {createShopDialog}
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Willkommen am Tresen.</h1>
        <p className="text-muted-foreground">Leg zuerst deinen Laden an. Danach fügst du Leistungen und Team hinzu und hängst den QR-Code auf.</p>
        <Button variant="signal" size="lg" onClick={() => setShowCreateShop(true)}>
          Laden anlegen
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      {createShopDialog}

      {/* Kopf: Laden, Tag, Aktionen */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Tresen</p>
          {shops.length > 1 ? (
            <Select value={shop.id} onValueChange={loadShopData}>
              <SelectTrigger className="h-auto w-auto gap-3 border-none bg-transparent p-0 font-display text-3xl font-extrabold sm:text-4xl" aria-label="Laden wechseln">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {shops.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">{shop.name}</h1>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setSelectedDate((d) => addDays(d, -1))} aria-label="Vorheriger Tag">
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <label className="sr-only" htmlFor="tresen-datum">
              Tag wählen
            </label>
            <Input
              id="tresen-datum"
              type="date"
              value={dayKey}
              onChange={(e) => e.target.value && setSelectedDate(new Date(`${e.target.value}T12:00:00`))}
              className="h-11 w-auto font-mono"
            />
            <Button variant="ghost" size="icon" onClick={() => setSelectedDate((d) => addDays(d, 1))} aria-label="Nächster Tag">
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </Button>
            {!live && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())}>
                Heute
              </Button>
            )}
            <span className="ml-1 text-sm text-muted-foreground">{format(selectedDate, 'EEEE', { locale: de })}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="signal" onClick={() => openCreate('queue')}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nummer vergeben
          </Button>
          <Button variant="outline" onClick={() => openCreate('booked')}>
            Termin eintragen
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Weitere Aktionen">
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setShowEditShop(true)}>Laden bearbeiten</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/staff-management')}>Team</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/service-management')}>Leistungen</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowCreateShop(true)}>Weiteren Laden anlegen</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={live ? 'Wartet noch' : 'Gebucht'} value={String(stats.waiting)} />
        <Stat label="Ist dran" value={String(stats.running)} />
        <Stat label="Fertig" value={String(stats.done)} />
        <Stat label="Umsatz" value={`${stats.revenue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-6">
          {staff.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-3xl border border-border bg-card p-6">
              <p className="font-display text-xl font-bold">Noch niemand im Team.</p>
              <p className="text-sm text-muted-foreground">Ohne Team gibt es keine freien Zeiten. Leg dich selbst oder deine Leute an.</p>
              <Button onClick={() => navigate('/staff-management')}>Team anlegen</Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {lanes.map((lane) => (
                <CounterLane key={lane.key} title={lane.title} appointments={lane.items} services={services} now={now} live={live} />
              ))}
            </div>
          )}

          <AppointmentsList
            appointments={appointments}
            services={services}
            staff={staff}
            customers={customers}
            selectedDate={selectedDate}
            onAppointmentUpdate={(updated) => setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
          />
        </div>

        <aside className="flex flex-col gap-4">
          <QRCodeDisplay shopId={shop.id} shopName={shop.name} />
        </aside>
      </div>

      <Dialog open={showEditShop} onOpenChange={setShowEditShop}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Laden bearbeiten</DialogTitle>
            <DialogDescription>Änderungen gelten sofort, auch für die Shop-Suche.</DialogDescription>
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

      <Dialog open={showCreateAppointmentDialog} onOpenChange={setShowCreateAppointmentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{appointmentType === 'queue' ? 'Nummer vergeben' : 'Termin eintragen'}</DialogTitle>
          </DialogHeader>
          <CreateAppointmentForm
            services={services}
            staff={staff}
            customers={customers}
            shopId={shop.id}
            onCreateAppointment={() => setShowCreateAppointmentDialog(false)}
            onCancel={() => setShowCreateAppointmentDialog(false)}
            appointmentType={appointmentType}
            setAppointmentType={setAppointmentType}
            createAppointment={createAppointment}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ShopDashboard;
