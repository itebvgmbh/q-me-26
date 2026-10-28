import { useEffect, useMemo, useState } from 'react';
import { PlanBanner } from '../components/pricing/PlanBanner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, format, isToday, startOfDay, endOfDay } from 'date-fns';
import { ChevronDown, ChevronLeft, ChevronRight, Maximize, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser, firebaseApp } from 'app';
import { collection, query, where, onSnapshot, Timestamp, getFirestore } from 'firebase/firestore';

import { AppointmentsList } from '../components/AppointmentsList';
import { EditShopForm } from '../components/EditShopForm';
import { CreateAppointmentForm } from '../components/CreateAppointmentForm';
import { CounterLane } from '../components/counter/CounterLane';
import { CounterCalendar } from '../components/counter/CounterCalendar';
import { Startklar } from '../components/onboarding/Startklar';
import { GeraetWahl } from '../components/GeraetWahl';
import { TeamPushSchalter } from '../components/TeamPushSchalter';
import { gespeichertesGeraet, jetztFragen, merkeGeraet, spaeterFragen, type GeraetRolle } from '../utils/geraet';
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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { datumsLocale, intlSprache, merke, t, tn } from '@/i18n';

/**
 * Zwei Bereiche aus denselben Daten:
 *  - heute:    der Tresen – nur heute, eine Reihe je Person (Nummern und Termine gemischt), „Fertig – Nächster“
 *  - kalender: planen – Tag (Spalte je Person) oder Woche einer Person, mit Zahlen und Liste zum Bearbeiten
 * „Nur ich“ zeigt nur die eigene Reihe bzw. Spalte (Inhaber mit eigenem Eintrag im Team).
 */
type Bereich = 'heute' | 'kalender';
type View = 'tag' | 'woche';
const VIEWS: { id: View; label: string }[] = [
  { id: 'tag', label: merke('Tag') },
  { id: 'woche', label: merke('Woche') },
];
const VIEW_KEY = 'kalender.ansicht';
const LIST_KEY = 'tresen.liste';
const NUR_ICH_KEY = 'heute.nurIch';
const rememberedView = (): View => {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return VIEWS.some((v) => v.id === value) ? (value as View) : 'tag';
  } catch {
    return 'tag';
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // nur Komfort
  }
};

const Stat =({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3">
    <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
    <span className="font-mono text-2xl font-bold">{value}</span>
  </div>
);

/** Heute (Tresen) und Kalender für Inhaber – siehe oben */
const ShopDashboard = ({ bereich = 'heute' }: { bereich?: Bereich }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const heute = bereich === 'heute';
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
    remember(VIEW_KEY, next);
  };
  // Nur die eigene Reihe: über ?nur=ich (Gerät „Mein Handy“) oder wie zuletzt auf diesem Gerät
  const [nurIch, setNurIch] = useState(() => {
    if (searchParams.get('nur') === 'ich') return true;
    try {
      return localStorage.getItem(NUR_ICH_KEY) === '1';
    } catch {
      return false;
    }
  });
  const chooseNurIch = (next: boolean) => {
    setNurIch(next);
    remember(NUR_ICH_KEY, next ? '1' : '0');
  };
  const [geraetFragen, setGeraetFragen] = useState(false);
  const [showList, setShowList] = useState(() => {
    try {
      return localStorage.getItem(LIST_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleList = () => {
    setShowList(!showList);
    remember(LIST_KEY, showList ? '0' : '1');
  };
  // In der Wochenansicht blättern die Pfeile um eine Woche
  const step = view === 'woche' ? 7 : 1;

  // Am Tresen geht der Bildschirm nicht aus (Tablet an der Theke, iPad-App)
  useKeepScreenOn(heute);

  // Uhr für Aufruf und Verzug am Tresen – alle 30 Sekunden. „Heute“ bleibt heute, auch wenn das Tablet über Nacht läuft.
  useEffect(() => {
    const timer = setInterval(() => {
      const jetzt = new Date();
      setNow(jetzt);
      if (heute) setSelectedDate((d) => (isToday(d) ? d : jetzt));
    }, 30000);
    return () => clearInterval(timer);
  }, [heute]);

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

  // Eigener Eintrag im Team (Inhaber, der selbst mitarbeitet): nur dann gibt es „Nur ich“
  const ownStaff = staff.find((s) => s.userId === user?.uid);
  const showOnlyMe = nurIch && !!ownStaff;
  const visibleStaff = useMemo(() => (showOnlyMe && ownStaff ? [ownStaff] : staff), [showOnlyMe, ownStaff, staff]);

  // Spuren: je aktive Person, dazu Termine ohne (bekannte) Person
  const lanes = useMemo(() => {
    const list = visibleStaff.map((s) => ({ key: s.id, title: s.name, items: appointments.filter((a) => a.staffId === s.id && a.status !== 'cancelled') }));
    const orphan = appointments.filter((a) => a.status !== 'cancelled' && !staff.some((s) => s.id === a.staffId));
    if (orphan.length && !showOnlyMe) list.push({ key: 'ohne', title: t('Ohne Zuordnung'), items: orphan });
    return list;
  }, [visibleStaff, staff, appointments, showOnlyMe]);

  const openCreate = (type: 'booked' | 'queue') => {
    setAppointmentType(type);
    setShowCreateAppointmentDialog(true);
  };

  // Einmal je Gerät fragen, wofür es da ist (utils/geraet.ts) – am Tresen, sobald der Laden steht
  useEffect(() => {
    if (heute && shop) setGeraetFragen(jetztFragen());
  }, [heute, shop?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const waehleGeraet = (rolle: GeraetRolle) => {
    if (!shop) return;
    merkeGeraet({ rolle, shopId: shop.id });
    setGeraetFragen(false);
    if (rolle === 'tresen') {
      chooseNurIch(false);
      // Der Tipp ist die Erlaubnis, die der Browser für Vollbild braucht
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (rolle === 'handy') chooseNurIch(true);
    else if (rolle === 'bildschirm') navigate(`/bildschirm/${shop.id}`);
    else navigate('/shop-profile');
  };
  const vollbild = typeof document !== 'undefined' && document.fullscreenEnabled;

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
      {/* Erste Schritte nur am Tresen – im Kalender wäre es dieselbe Liste ein zweites Mal */}
      {heute && <Startklar key={shop.id} shop={shop} staff={staff} appointments={appointments} onEditShop={() => setShowEditShop(true)} />}

      {/* Kopf: Bereich, Laden, (Kalender: Tag und Ansicht), Aktionen */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {heute ? `${t('Heute')} · ${format(selectedDate, t('EEEE, d. MMMM'), { locale: datumsLocale() })}` : t('Kalender')}
          </p>
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
          {heute ? (
            <p className="font-semibold" aria-live="polite">
              {[
                tn(stats.waiting, '{n} wartet', '{n} warten'),
                tn(stats.running, '{n} ist dran', '{n} sind dran'),
                tn(stats.done, '{n} fertig', '{n} fertig'),
              ].join(' · ')}
            </p>
          ) : (
            <>
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
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ownStaff && (
            <div role="group" aria-label={t('Wessen Kunden?')} className="flex rounded-full bg-muted p-1">
              {[
                { only: false, label: t('Alle') },
                { only: true, label: t('Nur ich') },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={nurIch === o.only}
                  onClick={() => chooseNurIch(o.only)}
                  className={cn(
                    'h-9 rounded-full px-4 text-sm font-semibold transition-colors',
                    nurIch === o.only ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {heute && vollbild && (
            <Button variant="ghost" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
              <Maximize className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('Vollbild')}
            </Button>
          )}
          {heute ? (
            <Button variant="signal" size="lg" onClick={() => openCreate('queue')}>
              <Plus className="me-1.5 h-5 w-5" aria-hidden="true" />
              {t('Kunde eintragen')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => openCreate('booked')}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('Termin eintragen')}
            </Button>
          )}
        </div>
      </div>

      {/* Zahlen für den gewählten Tag: im Kalender (Tag) – am Tresen genügt die Zeile oben */}
      {!heute && view === 'tag' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={live ? t('Wartet noch') : t('Gebucht')} value={String(stats.waiting)} />
          <Stat label={t('Ist dran')} value={String(stats.running)} />
          <Stat label={t('Fertig')} value={String(stats.done)} />
          <Stat label={t('Umsatz')} value={`${stats.revenue.toLocaleString(intlSprache(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`} />
        </div>
      )}

      {staff.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-3xl border border-border bg-card p-6">
          <p className="font-display text-xl font-bold">{t('Noch niemand im Team.')}</p>
          <p className="text-sm text-muted-foreground">{t('Ohne Team gibt es keine freien Zeiten. Leg dich selbst oder deine Leute an.')}</p>
          <Button onClick={() => navigate('/staff-management')}>{t('Team anlegen')}</Button>
        </div>
      ) : heute ? (
        <div className={cn('grid gap-4', lanes.length > 1 && 'md:grid-cols-2 xl:grid-cols-3')}>
          {lanes.map((lane) => (
            <CounterLane key={lane.key} title={lane.title} appointments={lane.items} services={services} now={now} live={live} />
          ))}
        </div>
      ) : (
        <>
          <CounterCalendar
            key={`${shop.id}-${showOnlyMe ? 'ich' : 'alle'}`}
            mode={view}
            shop={shop}
            staff={visibleStaff}
            services={services}
            dayAppointments={appointments}
            selectedDate={selectedDate}
            now={now}
          />
          {/* Alle Termine des Tages als Liste – zum Bearbeiten (Preis, Leistung, Zeit) */}
          {view === 'tag' && (
            <section className="flex flex-col gap-3">
              <button
                type="button"
                onClick={toggleList}
                aria-expanded={showList}
                className="flex min-h-11 items-center gap-2 self-start rounded-full px-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', showList && 'rotate-180')} aria-hidden="true" />
                {showList ? t('Liste ausblenden') : t('Alle Termine als Liste – zum Bearbeiten')}
              </button>
              {showList && (
                <AppointmentsList
                  appointments={appointments}
                  services={services}
                  staff={staff}
                  customers={customers}
                  selectedDate={selectedDate}
                  onAppointmentUpdate={(updated) => setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
                />
              )}
            </section>
          )}
        </>
      )}

      {/* Auf dem eigenen Handy: Bescheid bekommen, wenn ein Kunde bucht oder absagt (utils/team-push.ts) */}
      {heute && gespeichertesGeraet()?.rolle === 'handy' && <TeamPushSchalter />}

      <GeraetWahl
        open={geraetFragen}
        onChoose={waehleGeraet}
        onLater={() => {
          spaeterFragen();
          setGeraetFragen(false);
        }}
      />

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
            <DialogTitle>{appointmentType === 'queue' ? t('Kunde eintragen') : t('Termin eintragen')}</DialogTitle>
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
