import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import type { EarlierSlotNotificationType } from '../utils/types';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '../utils/firestore-client';
import { safelyConvertToDate } from '../utils/datetime';
import useTimeSlotStore from '../utils/timeSlotStore';
import { loadAppointmentsWithDetails } from '../utils/bookings';
import { loadUserNotifications } from '../utils/notifications';
import { setFrueherDran } from '../utils/frueher-dran';
import { cancelTicket } from '../utils/ticket-key';
import { AppointmentCard, AppointmentWithDetails, nochmalLinks } from '../components/AppointmentCard';
import { CancelAppointmentDialog } from '../components/CancelAppointmentDialog';
import { Ticket } from '../components/brand/Ticket';
import { t, tTeile, datumsLocale } from '@/i18n';

const dayLabel = (d: Date) => (isToday(d) ? t('Heute') : isTomorrow(d) ? t('Morgen') : format(d, t('EEEEEE d.M.'), { locale: datumsLocale() }));

// Offen bleibt, was dran ist oder heute noch wartet – auch wenn der Laden hinterherhängt und die Zeit vorbei ist
const isUpcoming = (a: AppointmentWithDetails) =>
  a.status === 'in-progress' || (a.status === 'scheduled' && (safelyConvertToDate(a.endTime) > new Date() || isToday(safelyConvertToDate(a.startTime))));

/** Meine Termine: nächster Termin als Wartemarke, danach Kommendes und Vergangenes */
const MyBookings = () => {
  const { user } = useCurrentUser();
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<EarlierSlotNotificationType[]>([]);
  // Link aus der Benachrichtigung „Früher dran?“: /my-bookings?angebot=<id> (backend/app/libs/notify_worker.py)
  const [params] = useSearchParams();
  const offerFromLink = params.get('angebot');
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [appointmentToCancel, setAppointmentToCancel] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    if (!user) return;
    try {
      setAppointments(await loadAppointmentsWithDetails(user.uid));
    } catch (error) {
      console.error('Error loading appointments:', error);
      toast.error(t('Deine Termine konnten nicht geladen werden.'));
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      setNotifications(await loadUserNotifications(user.uid));
    } catch {
      setNotifications([]);
    } finally {
      setNotificationsLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadAppointments();
    fetchNotifications();
    // Angebote für frühere Plätze regelmäßig nachladen
    const refresh = setInterval(fetchNotifications, 30000);
    return () => clearInterval(refresh);
  }, [user, loadAppointments, fetchNotifications]);

  const handleAcceptEarlierSlot = async (notificationId: string) => {
    try {
      const { acceptEarlierAppointmentSlot } = await import('../utils/firebase/appointmentRepository');
      if (!(await acceptEarlierAppointmentSlot(notificationId))) throw new Error('not accepted');
      toast.success(t('Du hast den früheren Platz.'));
      await Promise.all([fetchNotifications(), loadAppointments()]);
      return true;
    } catch (error) {
      console.error('Error accepting earlier slot:', error);
      toast.error((error as Error)?.name === 'EarlierSlotRefused' ? (error as Error).message : t('Der Platz ist leider schon weg.'));
      await fetchNotifications();
      return false;
    }
  };

  const handleToggleEarlier = async (appointmentId: string, on: boolean) => {
    try {
      const now = await setFrueherDran(appointmentId, on);
      setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? { ...a, checkEarlierOptions: now } : a)));
      if (now) {
        toast.success(t('Früher dran ist an. Wird ein Platz frei, siehst du ihn hier.'));
        // Das Backend sucht sofort; ein Angebot ist meist nach wenigen Sekunden da
        setTimeout(fetchNotifications, 4000);
      } else {
        toast.success(t('Früher dran ist aus.'));
        // Ein offenes Angebot gibt das Backend frei, hier verschwindet es gleich
        setNotifications((prev) => prev.filter((n) => n.appointmentId !== appointmentId));
      }
    } catch (error) {
      console.error('Error toggling earlier slot option:', error);
      toast.error(error instanceof Error ? error.message : t('Das hat nicht geklappt. Versuch es noch einmal.'));
      throw error;
    }
  };

  const handleCancelAppointment = async () => {
    const id = appointmentToCancel;
    setAppointmentToCancel(null);
    if (!id) return;
    try {
      const snap = await getDoc(doc(firestore, 'appointments', id));
      const data = snap.exists() ? snap.data() : null;
      // Über das Backend: gibt den Platz frei und meldet es dem Team (app/apis/nummer)
      await cancelTicket(id, null);
      toast.success(t('Termin abgesagt.'));
      if (data?.shopId && data?.startTime) {
        useTimeSlotStore.getState().invalidateCache(data.shopId, safelyConvertToDate(data.startTime));
      }
      loadAppointments();
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      toast.error(t('Das Absagen hat nicht geklappt. Versuch es noch einmal.'));
    }
  };

  const upcoming = appointments
    .filter(isUpcoming)
    .sort((a, b) => safelyConvertToDate(a.startTime).getTime() - safelyConvertToDate(b.startTime).getTime());
  const past = appointments
    .filter((a) => !isUpcoming(a))
    .sort((a, b) => safelyConvertToDate(b.startTime).getTime() - safelyConvertToDate(a.startTime).getTime());
  const next = upcoming[0];
  const offerFor = (a: AppointmentWithDetails) => notifications.find((n) => n.appointmentId === a.id && n.isAccepted !== true);
  // „Wie letztes Mal?“: der letzte Besuch – nicht, wenn dort schon etwas gebucht ist
  const last = past.find((a) => a.status === 'completed');
  const showLast = !!last && !upcoming.some((a) => a.shopId === last.shopId);
  const lastLinks = last ? nochmalLinks(last) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Meine Termine')}</h1>
        {/* Immer erreichbar, auch wenn schon etwas gebucht ist; ohne Buchungen stehen die Knöpfe unten */}
        {!loading && appointments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="signal" asChild>
              <Link to="/public-join-queue">{t('Nummer ziehen')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/book-appointment">{t('Termin buchen')}</Link>
            </Button>
          </div>
        )}
      </div>

      {offerFromLink && notificationsLoaded && !loading && !notifications.some((n) => n.id === offerFromLink) && (
        <div role="status" className="rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">{t('Dieses Angebot ist hier nicht offen.')}</p>
          <p className="text-muted-foreground">
            {tTeile(
              'Entweder ist es schon angenommen oder abgelaufen – oder es gehört zu einem anderen Konto. Angemeldet bist du als <email/>. Gebucht mit einem anderen Konto? Dann melde dich damit an.',
              {
                email: () => (
                  <strong className="text-foreground">
                    <bdi>{user?.email}</bdi>
                  </strong>
                ),
              },
            )}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t('Termine werden geladen')}>
          <div className="h-56 animate-pulse rounded-3xl bg-muted" />
          <div className="h-28 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : appointments.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-3xl border border-border bg-card p-6">
          <p className="font-display text-xl font-bold">{t('Noch nichts gebucht.')}</p>
          <p className="text-muted-foreground">{t('Zieh eine Nummer für sofort oder buch eine feste Uhrzeit.')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="signal" asChild>
              <Link to="/public-join-queue">{t('Nummer ziehen')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/book-appointment">{t('Termin buchen')}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {next && (
            <section className="flex flex-col gap-3" aria-labelledby="als-naechstes">
              <h2 id="als-naechstes" className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t('Als Nächstes')}
              </h2>
              <Ticket
                eyebrow={next.shop?.name}
                eyebrowRight={[next.service?.name, next.staff?.name].filter(Boolean).join(' · ')}
                number={format(safelyConvertToDate(next.startTime), 'HH:mm')}
                stats={[
                  { label: t('Wann'), value: dayLabel(safelyConvertToDate(next.startTime)) },
                  {
                    label: next.type === 'queue' ? t('In der Schlange') : t('Art'),
                    value: next.type === 'queue' ? ((next.queuePosition ?? 0) > 0 ? t('Platz {platz}', { platz: next.queuePosition ?? 0 }) : t('Eingereiht')) : t('Fester Termin'),
                  },
                ]}
              />
              <AppointmentCard
                appointment={next}
                notification={offerFor(next)}
                onCancelClick={setAppointmentToCancel}
                onAcceptEarlierSlot={handleAcceptEarlierSlot}
                onToggleEarlier={handleToggleEarlier}
                actionsOnly
              />
            </section>
          )}

          {showLast && last && lastLinks && (
            <section className="flex flex-col gap-3" aria-labelledby="wie-letztes-mal">
              <h2 id="wie-letztes-mal" className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t('Wie letztes Mal?')}
              </h2>
              <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-display text-lg font-bold">
                    {last.service?.name && last.staff?.name
                      ? t('{leistung} bei {name}', { leistung: last.service.name, name: last.staff.name })
                      : last.service?.name || t('Termin')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[last.shop?.name, t('zuletzt am {datum}', { datum: format(safelyConvertToDate(last.startTime), t('EEEE, d. MMMM'), { locale: datumsLocale() }) })]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {lastLinks.termin && (
                    <Button asChild>
                      <Link to={lastLinks.termin}>{t('Nochmal buchen')}</Link>
                    </Button>
                  )}
                  <Button variant={lastLinks.termin ? 'outline' : 'default'} asChild>
                    <Link to={lastLinks.nummer}>{t('Nummer ziehen')}</Link>
                  </Button>
                </div>
              </div>
            </section>
          )}

          {upcoming.length > 1 && (
            <section className="flex flex-col gap-3" aria-labelledby="danach">
              <h2 id="danach" className="font-display text-2xl font-bold">
                {t('Danach')}
              </h2>
              {upcoming.slice(1).map((a) => (
                <AppointmentCard
                  key={a.id}
                  appointment={a}
                  notification={offerFor(a)}
                  onCancelClick={setAppointmentToCancel}
                  onAcceptEarlierSlot={handleAcceptEarlierSlot}
                  onToggleEarlier={handleToggleEarlier}
                />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section className="flex flex-col gap-3" aria-labelledby="vorbei">
              <h2 id="vorbei" className="font-display text-2xl font-bold text-muted-foreground">
                {t('Vorbei')}
              </h2>
              {past.map((a) => (
                <AppointmentCard key={a.id} appointment={a} onCancelClick={setAppointmentToCancel} past />
              ))}
            </section>
          )}
        </>
      )}

      <CancelAppointmentDialog
        isOpen={!!appointmentToCancel}
        onOpenChange={(open) => !open && setAppointmentToCancel(null)}
        onCancel={() => setAppointmentToCancel(null)}
        onConfirm={handleCancelAppointment}
      />
    </div>
  );
};

export default MyBookings;
