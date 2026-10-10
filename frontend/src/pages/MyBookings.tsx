import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import type { EarlierSlotNotificationType } from '../utils/types';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '../utils/firestore-client';
import { cancelAppointment } from '../utils/firestore';
import { safelyConvertToDate } from '../utils/datetime';
import useTimeSlotStore from '../utils/timeSlotStore';
import { loadAppointmentsWithDetails } from '../utils/bookings';
import { loadUserNotifications } from '../utils/notifications';
import { AppointmentCard, AppointmentWithDetails } from '../components/AppointmentCard';
import { CancelAppointmentDialog } from '../components/CancelAppointmentDialog';
import { Ticket } from '../components/brand/Ticket';

const dayLabel = (d: Date) => (isToday(d) ? 'Heute' : isTomorrow(d) ? 'Morgen' : format(d, 'EEEEEE d.M.', { locale: de }));

const isUpcoming = (a: AppointmentWithDetails) =>
  (a.status === 'scheduled' || a.status === 'in-progress') && safelyConvertToDate(a.endTime) > new Date();

/** Meine Termine: nächster Termin als Wartemarke, danach Kommendes und Vergangenes */
const MyBookings = () => {
  const { user } = useCurrentUser();
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<EarlierSlotNotificationType[]>([]);
  const [appointmentToCancel, setAppointmentToCancel] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    if (!user) return;
    try {
      setAppointments(await loadAppointmentsWithDetails(user.uid));
    } catch (error) {
      console.error('Error loading appointments:', error);
      toast.error('Deine Termine konnten nicht geladen werden.');
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
      toast.success('Du hast den früheren Platz.');
      await Promise.all([fetchNotifications(), loadAppointments()]);
      return true;
    } catch (error) {
      console.error('Error accepting earlier slot:', error);
      toast.error('Der Platz ist leider schon weg.');
      await fetchNotifications();
      return false;
    }
  };

  const handleCancelAppointment = async () => {
    const id = appointmentToCancel;
    setAppointmentToCancel(null);
    if (!id) return;
    try {
      const snap = await getDoc(doc(firestore, 'appointments', id));
      const data = snap.exists() ? snap.data() : null;
      await cancelAppointment(id);
      toast.success('Termin abgesagt.');
      if (data?.shopId && data?.startTime) {
        useTimeSlotStore.getState().invalidateCache(data.shopId, safelyConvertToDate(data.startTime));
      }
      loadAppointments();
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      toast.error('Das Absagen hat nicht geklappt. Versuch es noch einmal.');
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Meine Termine</h1>

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Termine werden geladen">
          <div className="h-56 animate-pulse rounded-3xl bg-muted" />
          <div className="h-28 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : appointments.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-3xl border border-border bg-card p-6">
          <p className="font-display text-xl font-bold">Noch nichts gebucht.</p>
          <p className="text-muted-foreground">Zieh eine Nummer für sofort oder buch eine feste Uhrzeit.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="signal" asChild>
              <Link to="/public-join-queue">In die Schlange</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/book-appointment">Termin buchen</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {next && (
            <section className="flex flex-col gap-3" aria-labelledby="als-naechstes">
              <h2 id="als-naechstes" className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Als Nächstes
              </h2>
              <Ticket
                eyebrow={next.shop?.name}
                eyebrowRight={[next.service?.name, next.staff?.name].filter(Boolean).join(' · ')}
                number={format(safelyConvertToDate(next.startTime), 'HH:mm')}
                stats={[
                  { label: 'Wann', value: dayLabel(safelyConvertToDate(next.startTime)) },
                  {
                    label: next.type === 'queue' ? 'In der Schlange' : 'Art',
                    value: next.type === 'queue' ? ((next.queuePosition ?? 0) > 0 ? `Platz ${next.queuePosition}` : 'Eingereiht') : 'Fester Termin',
                  },
                ]}
              />
              <AppointmentCard
                appointment={next}
                notification={offerFor(next)}
                onCancelClick={setAppointmentToCancel}
                onAcceptEarlierSlot={handleAcceptEarlierSlot}
                actionsOnly
              />
            </section>
          )}

          {upcoming.length > 1 && (
            <section className="flex flex-col gap-3" aria-labelledby="danach">
              <h2 id="danach" className="font-display text-2xl font-bold">
                Danach
              </h2>
              {upcoming.slice(1).map((a) => (
                <AppointmentCard
                  key={a.id}
                  appointment={a}
                  notification={offerFor(a)}
                  onCancelClick={setAppointmentToCancel}
                  onAcceptEarlierSlot={handleAcceptEarlierSlot}
                />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section className="flex flex-col gap-3" aria-labelledby="vorbei">
              <h2 id="vorbei" className="font-display text-2xl font-bold text-muted-foreground">
                Vorbei
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
