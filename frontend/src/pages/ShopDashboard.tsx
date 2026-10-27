import { useEffect, useMemo, useState } from 'react';
import { PlanBanner } from '../components/pricing/PlanBanner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, format, isToday, startOfDay, endOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser, firebaseApp } from 'app';
import { collection, query, where, onSnapshot, Timestamp, getFirestore } from 'firebase/firestore';

import { AppointmentsList } from '../components/AppointmentsList';
import { EditShopForm } from '../components/EditShopForm';
import { CreateAppointmentForm } from '../components/CreateAppointmentForm';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { CounterLane } from '../components/counter/CounterLane';
import { CounterCalendar } from '../components/counter/CounterCalendar';
import { Startklar } from '../components/onboarding/Startklar';
import { weekDays } from '../utils/calendar-layout';
import { useKeepScreenOn } from '../utils/native-app';
import {
  listShopsOfOwner,
  getShopById,
  getShopStaff,
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

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { datumsLocale, intlSprache, merke, t } from '@/i18n';

/** Ansichten am Tresen: Schlange je Person, Kalender des Tages (Spalte je Person), Woche einer Person */
type View = 'schlange' | 'tag' | 'woche';
const VIEWS: { id: View; label: string }[] = [
  { id: 'schlange', label: merke('Schlange') },
  { id: 'tag', label: merke('Kalender') },
  { id: 'woche', label: merke('Woche') },
];
const VIEW_KEY = 'tresen.ansicht';
const rememberedView = (): View => {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return VIEWS.some((v) => v.id === value) ? (value as View) : 'schlange';
  } catch {
    return 'schlange';
  }
};

const Stat =({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3">
    <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
    <span className="font-mono text-2xl font-bold">{value}</span>
  </div>
);

/** Tresen: Schlange und Termine des Tages je Person, mit "Nächste Nummer aufrufen"; dazu Kalender (Tag, Woche) */
const ShopDashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: userLoading } = useCurrentUser();
  const [shops, setShops] = useState<Shop[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [now, setNow] = useState(new Date());
  const [showEditShop, setShowEditShop] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showCreateAppointmentDialog, setShowCreateAppointmentDialog] = useState(false);
  const [appointmentType, setAppointmentType] = useState<'booked' | 'queue'>('queue');
  const [view, setView] = useState<View>(rememberedView);
  const chooseView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // nur Komfort
    }
  };
  // In der Wochenansicht blättern die Pfeile um eine Woche
  const step = view === 'woche' ? 7 : 1;

  // Am Tresen geht der Bildschirm nicht aus (Tablet an der Theke, iPad-App)
  useKeepScreenOn();

  // Uhr für Aufruf und Verzug am Tresen – alle 30 Sekunden
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const loadShopData = async (shopId: string) => {
    setIsLoading(true);
    try {
      const shopData = await getShopById(shopId);
      if (!shopData) {
        toast.error(t('Der Laden konnte nicht geladen werden.'));
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
      toast.error(t('Die Daten des Ladens konnten nicht geladen werden.'));
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
        const userShops = await listShopsOfOwner(user.uid);
        setShops(userShops);
        // ?shopId= z. B. direkt nach dem Einrichten eines weiteren Ladens; sonst zuerst ein Laden, der nicht gesperrt ist
        const wanted = userShops.find((s) => s.id === searchParams.get('shopId')) ?? userShops.find((s) => !s.suspended) ?? userShops[0];
        if (wanted) await loadShopData(wanted.id);
        else setIsLoading(false);
      } catch (error) {
        console.error('Error loading shops:', error);
        setLoadFailed(true); // nicht "kein Laden" anzeigen – das würde zum Anlegen eines zweiten verleiten
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
    // Wer wartet, wartet, bis er aufgerufen oder abgesagt wird – auch wenn seine geplante Zeit vorbei ist
    return {
      waiting: active.filter((a) => a.status === 'scheduled').length,
      running: active.filter((a) => a.status === 'in-progress').length,
      done: active.filter((a) => a.status === 'completed').length,
      revenue: active.filter((a) => a.status === 'completed').reduce((sum, a) => sum + Number(priceOf(a) || 0), 0),
    };
  }, [appointments, services]);

  // Spuren: je aktive Person, dazu Termine ohne (bekannte) Person
  const lanes = useMemo(() => {
    const list = staff.map((s) => ({ key: s.id, title: s.name, items: appointments.filter((a) => a.staffId === s.id && a.status !== 'cancelled') }));
    const orphan = appointments.filter((a) => a.status !== 'cancelled' && !staff.some((s) => s.id === a.staffId));
    if (orphan.length) list.push({ key: 'ohne', title: t('Ohne Zuordnung'), items: orphan });
    return list;
  }, [staff, appointments]);

  const openCreate = (type: 'booked' | 'queue') => {
    setAppointmentType(type);
    setShowCreateAppointmentDialog(true);
  };

  if (userLoading || !user) return null;

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6" aria-busy="true" aria-label={t('Tresen wird geladen')}>
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

  if (loadFailed) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">{t('Dein Laden lädt gerade nicht.')}</h1>
        <p className="text-muted-foreground">{t('Die Verbindung zur Datenbank hat nicht geklappt. Prüf dein Internet und lade die Seite neu.')}</p>
        <Button variant="signal" onClick={() => window.location.reload()}>
          {t('Neu laden')}
        </Button>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Willkommen am Tresen.')}</h1>
        <p className="text-muted-foreground">
          {t('Richte zuerst deinen Laden ein: ein paar Fragen, und Öffnungszeiten, Leistungen und Team stehen. Ist dein Laden bei Google, übernehme ich das meiste von dort.')}
        </p>
        <Button variant="signal" size="lg" onClick={() => navigate('/shop-setup')}>
          {t('Laden einrichten')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PlanBanner shop={shop} />
      <Startklar key={shop.id} shop={shop} staff={staff} appointments={live ? appointments : []} onEditShop={() => setShowEditShop(true)} />

      {/* Kopf: Laden, Tag, Aktionen */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Tresen')}</p>
          {shops.length > 1 ? (
            <Select value={shop.id} onValueChange={loadShopData}>
              <SelectTrigger className="h-auto w-auto gap-3 border-none bg-transparent p-0 font-display text-3xl font-extrabold sm:text-4xl" aria-label={t('Laden wechseln')}>
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
            <Button variant="ghost" size="icon" onClick={() => setSelectedDate((d) => addDays(d, -step))} aria-label={view === 'woche' ? t('Vorherige Woche') : t('Vorheriger Tag')}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <label className="sr-only" htmlFor="tresen-datum">
              {t('Tag wählen')}
            </label>
            <Input
              id="tresen-datum"
              type="date"
              value={dayKey}
              onChange={(e) => e.target.value && setSelectedDate(new Date(`${e.target.value}T12:00:00`))}
              className="h-11 w-auto font-mono"
            />
            <Button variant="ghost" size="icon" onClick={() => setSelectedDate((d) => addDays(d, step))} aria-label={view === 'woche' ? t('Nächste Woche') : t('Nächster Tag')}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </Button>
            {!live && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())}>
                {t('Heute')}
              </Button>
            )}
            <span className="ms-1 text-sm text-muted-foreground">
              {view === 'woche'
                ? `${format(weekDays(selectedDate)[0], t('dd.MM.'))}–${format(weekDays(selectedDate)[6], t('dd.MM.'))}`
                : format(selectedDate, 'EEEE', { locale: datumsLocale() })}
            </span>
          </div>
          <div role="group" aria-label={t('Ansicht')} className="flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => chooseView(v.id)}
                aria-pressed={view === v.id}
                className={cn(
                  'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
                  view === v.id ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-foreground/10',
                )}
              >
                {t(v.label)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="signal" onClick={() => openCreate('queue')}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t('Nummer vergeben')}
          </Button>
          <Button variant="outline" onClick={() => openCreate('booked')}>
            {t('Termin eintragen')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('Weitere Aktionen')}>
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => window.open(`/bildschirm/${shop.id}`, '_blank', 'noopener')}>
                {t('Wartezimmer-Bildschirm öffnen')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/auswertung')}>{t('Auswertung')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/plakat')}>{t('QR-Plakat drucken')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowEditShop(true)}>{t('Laden bearbeiten')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/staff-management')}>{t('Team')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/service-management')}>{t('Leistungen')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/shop-setup')}>{t('Weiteren Laden einrichten')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => window.open('/hilfe', '_blank', 'noopener')}>{t('Hilfe und Anleitungen')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Zahlen gelten für den gewählten Tag – in der Wochenansicht nicht */}
      {view !== 'woche' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={live ? t('Wartet noch') : t('Gebucht')} value={String(stats.waiting)} />
          <Stat label={t('Ist dran')} value={String(stats.running)} />
          <Stat label={t('Fertig')} value={String(stats.done)} />
          <Stat label={t('Umsatz')} value={`${stats.revenue.toLocaleString(intlSprache(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`} />
        </div>
      )}

      {/* Kalender brauchen die ganze Breite; der QR-Code steht nur bei der Schlange daneben */}
      <div className={cn('grid gap-6', view === 'schlange' && 'lg:grid-cols-[1fr_300px]')}>
        <div className="flex min-w-0 flex-col gap-6">
          {staff.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-3xl border border-border bg-card p-6">
              <p className="font-display text-xl font-bold">{t('Noch niemand im Team.')}</p>
              <p className="text-sm text-muted-foreground">{t('Ohne Team gibt es keine freien Zeiten. Leg dich selbst oder deine Leute an.')}</p>
              <Button onClick={() => navigate('/staff-management')}>{t('Team anlegen')}</Button>
            </div>
          ) : view === 'schlange' ? (
            <div className="grid gap-4 md:grid-cols-2">
              {lanes.map((lane) => (
                <CounterLane key={lane.key} title={lane.title} appointments={lane.items} services={services} now={now} live={live} />
              ))}
            </div>
          ) : (
            <CounterCalendar
              key={shop.id}
              mode={view}
              shop={shop}
              staff={staff}
              services={services}
              dayAppointments={appointments}
              selectedDate={selectedDate}
              now={now}
            />
          )}

          {view !== 'woche' && (
            <AppointmentsList
              appointments={appointments}
              services={services}
              staff={staff}
              customers={customers}
              selectedDate={selectedDate}
              onAppointmentUpdate={(updated) => setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
            />
          )}
        </div>

        {view === 'schlange' && (
          <aside className="flex flex-col gap-4">
            <QRCodeDisplay shopId={shop.id} shopName={shop.name} />
          </aside>
        )}
      </div>

      <Dialog open={showEditShop} onOpenChange={setShowEditShop}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('Laden bearbeiten')}</DialogTitle>
            <DialogDescription>{t('Änderungen gelten sofort.')}</DialogDescription>
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
            <DialogTitle>{appointmentType === 'queue' ? t('Nummer vergeben') : t('Termin eintragen')}</DialogTitle>
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
