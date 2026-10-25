import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { format, isToday, isTomorrow } from 'date-fns';
import { de } from 'date-fns/locale';
import { Bell, BellRing, Check, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Ticket } from '../components/brand/Ticket';
import { HilfeLink } from '../components/HilfeLink';
import { FrueherDranSchalter } from '../components/FrueherDranSchalter';
import { firestore } from '../utils/firestore-client';
import { safelyConvertToDate } from '../utils/datetime';
import { cancelAppointment, getServiceByIdLegacy, getShopById } from '../utils/firestore';
import type { Shop } from '../utils/firestore';
import { publicFromDoc, publicRef, staffDayQuery, type PublicAppointment } from '../utils/firestore/public-appointments';
import { cancelTicket, keyFromHash, rememberTicketKey, storedTicketKey } from '../utils/ticket-key';
import { hasFeature } from '../utils/plans';
import { aheadOf, delayMinutes, expectedStart, projectLane, SHOW_DELAY_MINUTES } from '../utils/queue-lane';
import {
  enablePush,
  getPushConfig,
  isIos,
  isStandalone,
  pushEnabledFor,
  pushSupported,
  rememberTicket,
  savedNotifyEmail,
  setNotifyEmail,
  type PushConfig,
} from '../utils/push';
import { ProdErrorPage } from '../prod-components/ProdErrorPage';
import { isConnectionError, retryWithSimpleConnection } from '../utils/connection';

// So lange darf die Nummer brauchen, bevor die Seite mit einfacher Verbindungsart neu lädt (utils/connection.ts)
const SLOW_CONNECTION_MS = 8000;

const dayLabel = (d: Date) => (isToday(d) ? 'Heute' : isTomorrow(d) ? 'Morgen' : format(d, 'EEEEEE d.M.', { locale: de }));

/**
 * Eigene Seite je Nummer: aktualisiert sich live, von hier aus Benachrichtigung einschalten.
 * Liest nur die öffentliche Kurzfassung (utils/firestore/public-appointments.ts – Zeit, Status, Nummer, keine
 * Namen). Eine Nummer ohne Konto gibt zurück, wer ihren Schlüssel hat: im Link (#k=…) oder in diesem Browser.
 */
export default function Nummer() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const ticketKey = useMemo(() => keyFromHash(hash) || storedTicketKey(id), [hash, id]);
  const justJoined = params.get('neu') === '1';
  // Angezeigter Platz war beim Bestätigen schon weg, die Nummer hat gleich den nächsten bekommen (QueueBookingService)
  const movedOnJoin = justJoined && params.get('verschoben') === '1';

  const [appt, setAppt] = useState<PublicAppointment | null>(null);
  const [missing, setMissing] = useState(false);
  const [names, setNames] = useState<{ shop?: string; service?: string; staff?: string }>({});
  const [shopData, setShopData] = useState<Shop | null>(null);
  const [lane, setLane] = useState<PublicAppointment[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Schlüssel aus dem Link in diesem Browser merken: Startseite, „Konto anlegen“ und Absagen finden ihn dann auch so
  useEffect(() => {
    const fromLink = keyFromHash(hash);
    if (id && fromLink) rememberTicketKey(id, fromLink);
  }, [id, hash]);

  // Die Nummer selbst, live
  useEffect(() => {
    if (!id) return;
    return onSnapshot(
      publicRef(firestore, id),
      (snap) => {
        // Ohne Verbindung meldet Firestore nach ~10 s „nicht da“ aus dem leeren Zwischenspeicher –
        // dann weiter warten statt „Diese Nummer gibt es nicht“; das sagt nur der Server
        const fromServer = !snap.metadata.fromCache;
        if (!snap.exists()) {
          if (fromServer) setMissing(true);
          return;
        }
        setAppt({ id: snap.id, ...snap.data() } as PublicAppointment);
      },
      (error) => {
        if (isConnectionError(error) && retryWithSimpleConnection()) return;
        setMissing(true);
      },
    );
  }, [id]);

  // Hängt die Dauerverbindung zur Datenbank, kommt die Nummer nicht an: einmal mit einfacher Verbindungsart
  // neu laden (in Safari ist sie schon an, dann bleibt es beim Warten)
  useEffect(() => {
    if (appt || missing) return;
    const timer = window.setTimeout(() => retryWithSimpleConnection(), SLOW_CONNECTION_MS);
    return () => window.clearTimeout(timer);
  }, [appt, missing]);

  // Laden, Leistung, Person einmal nachladen
  useEffect(() => {
    if (!appt?.shopId) return;
    let alive = true;
    (async () => {
      const [shop, service, staffSnap] = await Promise.all([
        getShopById(appt.shopId),
        appt.serviceId ? getServiceByIdLegacy(appt.serviceId) : Promise.resolve(null),
        appt.staffId ? getDoc(doc(firestore, 'staff', appt.staffId)) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setNames({ shop: shop?.name, service: service?.name, staff: staffSnap?.exists() ? (staffSnap.data().name as string) : undefined });
      setShopData(shop);
      rememberTicket({ id: appt.id, shopId: appt.shopId, start: safelyConvertToDate(appt.startTime).toISOString() });
    })();
    return () => {
      alive = false;
    };
    // Nur beim ersten Laden der Nummer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appt?.id]);

  // Wer an dem Tag bei derselben Person ansteht, live (gleiche Abfrage wie utils/bookings.ts)
  useEffect(() => {
    if (!appt?.staffId || !appt.startTime) return;
    const q = staffDayQuery(firestore, appt.staffId, safelyConvertToDate(appt.startTime));
    return onSnapshot(q, (snap) => setLane(snap.docs.map(publicFromDoc)), () => setLane([]));
  }, [appt?.staffId, appt?.startTime?.seconds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const start = appt ? safelyConvertToDate(appt.startTime) : null;
  // Vor dir: wer bei derselben Person dran ist oder vorher wartet – auch wenn dessen Zeit schon vorbei ist.
  // Dazu die nachgerechnete "ca."-Zeit, wenn der Laden hinterherhängt (utils/queue-lane.ts).
  const { ahead, expected, delay } = useMemo(() => {
    if (!appt || !start) return { ahead: 0, expected: start, delay: 0 };
    const items = lane.some((a) => a.id === appt.id) ? lane.map((a) => (a.id === appt.id ? appt : a)) : [...lane, appt];
    const projection = projectLane(items, now);
    return { ahead: aheadOf(appt, items), expected: expectedStart(appt, projection), delay: delayMinutes(appt, projection) };
  }, [lane, appt, start, now]);

  useEffect(() => {
    if (appt?.referenceCode) document.title = `Nummer ${appt.referenceCode} · Dranzeit`;
  }, [appt?.referenceCode]);

  if (missing) {
    return <ProdErrorPage code="404" title="Diese Nummer gibt es nicht." text="Der Link ist unvollständig oder die Nummer wurde gelöscht." canRefresh={false} />;
  }
  if (!appt || !start) {
    return (
      <div className="mx-auto flex max-w-xl items-center justify-center gap-3 px-4 py-24 text-muted-foreground" role="status">
        <span className="h-6 w-6 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        Deine Nummer wird geladen …
      </div>
    );
  }

  const open = appt.status === 'scheduled' || appt.status === 'in-progress';
  const number = appt.referenceCode || '—';
  const isQueue = appt.type !== 'booked';
  // Ohne Konto mit dem Schlüssel über das Backend, mit Konto direkt (die Regeln lassen nur den eigenen Termin zu)
  const canCancel = appt.isAnonymous ? Boolean(ticketKey) : Boolean(user);

  const cancel = async () => {
    try {
      if (appt.isAnonymous && ticketKey) await cancelTicket(appt.id, ticketKey);
      else await cancelAppointment(appt.id);
      toast.success(isQueue ? 'Deine Nummer ist zurückgegeben.' : 'Dein Termin ist abgesagt.');
    } catch {
      toast.error('Das hat nicht geklappt. Sag bitte am Tresen Bescheid.');
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">
          {justJoined && appt.status === 'scheduled' ? 'Du bist eingereiht.' : isQueue ? 'Deine Nummer' : 'Dein Termin'}
        </h1>
        {names.shop && <p className="text-muted-foreground">{names.shop}</p>}
      </header>

      {movedOnJoin && appt.status === 'scheduled' && (
        <p role="status" className="rounded-2xl border border-border bg-card px-4 py-3 font-semibold">
          Dein Platz hat sich auf {isToday(start) ? format(start, 'HH:mm') : format(start, 'EEEEEE d.M., HH:mm', { locale: de })} verschoben –
          jemand war kurz vor dir dran.
        </p>
      )}

      {appt.status === 'in-progress' && (
        <div role="status" className="flex items-center gap-3 rounded-3xl bg-foreground px-5 py-4 text-background">
          <BellRing className="h-6 w-6 shrink-0 text-signal" aria-hidden="true" />
          <p className="font-display text-2xl font-extrabold">Du bist dran. Komm rein.</p>
        </div>
      )}

      <Ticket
        size="lg"
        eyebrow={isQueue ? 'Deine Nummer' : 'Dein Termin'}
        eyebrowRight={[names.service, names.staff].filter(Boolean).join(' · ')}
        number={number}
        stats={
          appt.status === 'scheduled'
            ? [
                isToday(start) && isQueue ? { label: 'Vor dir', value: String(ahead) } : { label: 'Wann', value: dayLabel(start) },
                { label: isQueue ? 'Dran um ca.' : 'Um', value: format(isQueue && isToday(start) && expected ? expected : start, 'HH:mm') },
              ]
            : []
        }
      />

      {appt.status === 'scheduled' && isToday(start) && delay >= SHOW_DELAY_MINUTES && (
        <p className="text-sm font-semibold" aria-live="polite">
          {isQueue
            ? `Heute dauert es etwas länger: ursprünglich ${format(start, 'HH:mm')}, jetzt etwa ${delay} Minuten später.`
            : `Der Laden hängt gerade etwa ${delay} Minuten hinterher. Rechne mit etwas Wartezeit.`}
        </p>
      )}

      {appt.status === 'completed' && <p className="text-lg font-semibold">Fertig. Danke für deinen Besuch!</p>}
      {appt.status === 'cancelled' && <p className="text-lg font-semibold">{isQueue ? 'Diese Nummer ist abgesagt.' : 'Dieser Termin ist abgesagt.'}</p>}

      {appt.status === 'scheduled' && shopData && hasFeature(shopData, 'benachrichtigung') && (
        <NotifyCard appt={appt} ticketKey={ticketKey} userEmail={user?.email ?? ''} />
      )}

      {appt.status === 'scheduled' && start && shopData && hasFeature(shopData, 'frueherDran') && (
        <FrueherDranSchalter appointmentId={appt.id} start={start} claimedKey={appt.isAnonymous} />
      )}

      {appt.status === 'scheduled' && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Diese Seite aktualisiert sich von selbst. Du kannst sie schließen und über den Link oder die Startseite wieder öffnen.
        </p>
      )}

      {appt.isAnonymous && appt.status === 'scheduled' && !user && ticketKey && shopData && hasFeature(shopData, 'frueherDran') && (
        <div className="rounded-2xl border border-border p-4 text-sm">
          <strong className="block">Früher dran, wenn etwas frei wird</strong>
          <span className="text-muted-foreground">
            Das geht mit Konto: Wird vorher ein Platz frei, bieten wir ihn dir an. Leg eins an – deine Nummer bleibt, und du kannst es
            gleich hier einschalten.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {appt.isAnonymous && open && !user && ticketKey && (
          <Button
            size="lg"
            className="sm:flex-1"
            onClick={() =>
              navigate('/register-customer', {
                state: { redirectAfterLogin: `/nummer/${appt.id}`, linkAnonymousBooking: true, shopId: appt.shopId, appointmentId: appt.id, ticketKey },
              })
            }
          >
            Konto anlegen und Nummer behalten
          </Button>
        )}
        {appt.status === 'scheduled' && canCancel && (
          <CancelButton onConfirm={cancel} label={isQueue ? 'Nummer zurückgeben' : 'Termin absagen'} confirmLabel={isQueue ? 'Ja, zurückgeben' : 'Ja, absagen'} />
        )}
      </div>
      {appt.status === 'scheduled' && !canCancel && (
        <p className="text-sm text-muted-foreground">
          {appt.isAnonymous
            ? `${isQueue ? 'Zurückgeben' : 'Absagen'} geht auf dem Handy, mit dem du ${isQueue ? 'die Nummer gezogen' : 'gebucht'} hast, oder am Tresen.`
            : 'Zum Absagen melde dich mit deinem Konto an – oder sag am Tresen Bescheid.'}
        </p>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link to={`/shop-details?shopId=${appt.shopId}`} className="font-semibold underline underline-offset-2">
          Zum Laden
        </Link>
        <HilfeLink hilfe="so-funktioniert-die-nummer">So funktioniert’s</HilfeLink>
      </div>
    </div>
  );
}

function CancelButton({ onConfirm, label, confirmLabel }: { onConfirm: () => void; label: string; confirmLabel: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button size="lg" variant="outline" className="sm:flex-1" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-border p-3">
      <p className="text-sm font-semibold">Wirklich? Dein Platz wird dann frei.</p>
      <div className="flex gap-2">
        <Button variant="destructive" className="flex-1" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => setAsking(false)}>
          Behalten
        </Button>
      </div>
    </div>
  );
}

/** Benachrichtigung einschalten: Push, wo der Browser es kann, sonst E-Mail. */
function NotifyCard({ appt, ticketKey, userEmail }: { appt: PublicAppointment; ticketKey: string | null; userEmail: string }) {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [pushOn, setPushOn] = useState(() => pushEnabledFor(appt.id));
  const [busy, setBusy] = useState(false);
  const [savedEmail, setSavedEmail] = useState(() => savedNotifyEmail(appt.id));
  const [email, setEmail] = useState(savedEmail || userEmail);

  useEffect(() => {
    getPushConfig().then(setConfig);
  }, []);

  if (!config || (!config.push && !config.email)) return null;

  const iosBrowser = isIos() && !isStandalone();
  const canPush = config.push && pushSupported() && !iosBrowser;

  const turnOnPush = async () => {
    setBusy(true);
    try {
      const result = await enablePush(appt.id, config.publicKey, ticketKey);
      if (result === 'ok') {
        setPushOn(true);
        toast.success('Wir sagen dir Bescheid, kurz bevor du dran bist.');
      } else if (result === 'denied') {
        toast.error('Benachrichtigungen sind für diese Seite blockiert. Du kannst sie in den Browser-Einstellungen erlauben.');
      } else {
        toast.error('Dein Browser kann keine Benachrichtigungen. Nimm die E-Mail.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  const saveEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await setNotifyEmail(appt.id, email.trim(), ticketKey);
      setSavedEmail(email.trim());
      toast.success('Wir schicken dir eine E-Mail, kurz bevor du dran bist.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  const emailSaved = Boolean(savedEmail);

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5" aria-labelledby="bescheid">
      <h2 id="bescheid" className="font-display text-xl font-bold">
        Bescheid bekommen
      </h2>
      <p className="text-sm text-muted-foreground">Wir melden uns, kurz bevor du dran bist. Bis dahin bist du frei.</p>

      {canPush &&
        (pushOn ? (
          <p className="flex items-center gap-2 font-semibold">
            <Check className="h-5 w-5" aria-hidden="true" /> Benachrichtigung ist an.
          </p>
        ) : (
          <Button size="lg" onClick={turnOnPush} disabled={busy}>
            <Bell className="mr-2 h-5 w-5" aria-hidden="true" /> Benachrichtigung einschalten
          </Button>
        ))}

      {iosBrowser && config.push && (
        <p className="text-sm text-muted-foreground">
          Auf dem iPhone kommen Benachrichtigungen im Browser nicht an. Trag hier deine E-Mail ein, dann sagen wir dir per Mail Bescheid.
        </p>
      )}

      {config.email && (!canPush || !pushOn) && (
        <form onSubmit={saveEmail} className="flex flex-col gap-2">
          <Label htmlFor="notify-email">{canPush ? 'Oder per E-Mail' : 'Per E-Mail'}</Label>
          <div className="flex gap-2">
            <Input
              id="notify-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="du@beispiel.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" variant={canPush ? 'outline' : 'default'} disabled={busy}>
              <Mail className="mr-2 h-4 w-4" aria-hidden="true" /> {emailSaved ? 'Ändern' : 'Speichern'}
            </Button>
          </div>
          {emailSaved && <p className="text-sm font-semibold">E-Mail ist hinterlegt.</p>}
          <p className="text-xs text-muted-foreground">
            Nur für diese Nummer. Wir löschen die Adresse spätestens 90 Tage nach dem Termin.
          </p>
        </form>
      )}
    </section>
  );
}
