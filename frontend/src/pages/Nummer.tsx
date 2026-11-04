import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { Bell, BellRing, CalendarPlus, Check, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Ticket } from '../components/brand/Ticket';
import { HilfeLink } from '../components/HilfeLink';
import { PlatzAendern } from '../components/PlatzAendern';
import { FrueherDranSchalter } from '../components/FrueherDranSchalter';
import { safelyConvertToDate } from '../utils/datetime';
import type { Shop } from '../utils/firestore';
import type { PublicAppointment } from '../utils/firestore/public-appointments';
import { useLive } from '../utils/live';
import { cancelTicket, keyFromHash, rememberTicketKey, storedTicketKey } from '../utils/ticket-key';
import { hasFeature } from '../utils/plans';
import { aheadOf, delayMinutes, expectedStart, projectLane, SHOW_DELAY_MINUTES } from '../utils/queue-lane';
import { caFenster } from '../utils/ca-zeit';
import { googleKalenderLink, kalenderDateiLaden, type KalenderTermin } from '../utils/kalender-eintrag';
import {
  enableAppPush,
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
import { inNativeApp } from '../utils/native-app';
import { ProdErrorPage } from '../prod-components/ProdErrorPage';
import { datumsLocale, t, tn } from '@/i18n';

const dayLabel = (d: Date) =>
  isToday(d) ? t('Heute') : isTomorrow(d) ? t('Morgen') : format(d, t('EEEEEE d.M.'), { locale: datumsLocale() });

/** Was das Backend für die Nummernseite liefert (backend/app/apis/live: GET /live/nummer/{id}) */
interface NummerLive {
  termin: PublicAppointment;
  /** Wer an dem Tag bei derselben Person ansteht, einschließlich dieser Nummer */
  spur: PublicAppointment[];
  laden: Shop | null;
  leistung: { name: string } | null;
  person: { name: string } | null;
  kanaele: string[];
}

const KEINE: PublicAppointment[] = [];

/**
 * Eigene Seite je Nummer: aktualisiert sich live, von hier aus Benachrichtigung einschalten.
 * Holt nur die öffentliche Kurzfassung (Zeit, Status, Nummer, keine Namen) vom Backend und hört dort auf Änderungen
 * (utils/live.ts). Eine Nummer ohne Konto gibt zurück, wer ihren Schlüssel hat: im Link (#k=…) oder in diesem Browser.
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

  // Nummer, Schlange, Laden, Leistung und Person, live vom Backend
  const live = useLive<NummerLive>(id ? `nummer/${encodeURIComponent(id)}` : null);
  const appt = live.daten?.termin ?? null;
  const lane = live.daten?.spur ?? KEINE;
  const shopData = live.daten?.laden ?? null;
  const missing = live.fehlt;
  const names = useMemo(
    () => ({ shop: live.daten?.laden?.name, service: live.daten?.leistung?.name, staff: live.daten?.person?.name }),
    [live.daten],
  );
  const [now, setNow] = useState(() => Date.now());
  // „Platz ändern“, auch direkt aus „Meine Termine“ (?aendern=1)
  const [moving, setMoving] = useState(() => params.get('aendern') === '1');
  // Gerade über „Platz ändern“ verschoben: Überschrift sagt das statt „gebucht“
  const [movedHere, setMovedHere] = useState(false);

  // Schlüssel aus dem Link in diesem Browser merken: Startseite, „Konto anlegen“ und Absagen finden ihn dann auch so
  useEffect(() => {
    const fromLink = keyFromHash(hash);
    if (id && fromLink) rememberTicketKey(id, fromLink);
  }, [id, hash]);

  // Nummer auf diesem Gerät merken (Hinweis auf der Startseite, Benachrichtigungen); nur beim ersten Laden
  useEffect(() => {
    if (!appt?.id || !appt.shopId) return;
    rememberTicket({ id: appt.id, shopId: appt.shopId, start: safelyConvertToDate(appt.startTime).toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appt?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
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
    if (appt?.referenceCode) document.title = t('Nummer {nummer} · Dranzeit', { nummer: appt.referenceCode });
  }, [appt?.referenceCode]);

  if (missing) {
    return (
      <ProdErrorPage
        code="404"
        title={t('Diese Nummer gibt es nicht.')}
        text={t('Der Link ist unvollständig oder die Nummer wurde gelöscht.')}
        canRefresh={false}
      />
    );
  }
  if (!appt || !start) {
    return (
      <div className="mx-auto flex max-w-xl items-center justify-center gap-3 px-4 py-24 text-muted-foreground" role="status">
        <span className="h-6 w-6 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        {t('Deine Nummer wird geladen …')}
      </div>
    );
  }

  const open = appt.status === 'scheduled' || appt.status === 'in-progress';
  const isQueue = appt.type !== 'booked';
  // Fester Termin: groß die Uhrzeit wie in „Meine Termine“. Eine Tagesnummer haben nur Termine ohne Konto (zum Melden
  // am Tresen); sonst steht darunter die Dauer.
  const end = appt.endTime ? safelyConvertToDate(appt.endTime) : null;
  const minutes = end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0;
  const terminStats = [
    { label: t('Wann'), value: dayLabel(start) },
    appt.referenceCode
      ? { label: t('Nummer'), value: appt.referenceCode }
      : minutes > 0
        ? { label: t('Dauer'), value: t('{minuten} Min', { minuten: minutes }) }
        : null,
  ].filter((s): s is { label: string; value: string } => s !== null);
  // Heute die nachgerechnete ca.-Zeit, sonst die gebuchte
  const shownTime = isQueue && isToday(start) && expected ? expected : start;
  // Ohne Konto mit dem Schlüssel über das Backend, mit Konto direkt (die Regeln lassen nur den eigenen Termin zu)
  const canCancel = appt.isAnonymous ? Boolean(ticketKey) : Boolean(user);
  // Platz ändern, wo der Tarif Online-Termine hat – die neue Zeit ist ein fester Termin (backend/app/apis/nummer)
  const canMove = appt.status === 'scheduled' && canCancel && !!shopData && hasFeature(shopData, 'termine') && !!appt.serviceId;

  // Fester Termin in der Zukunft: in den eigenen Kalender (ohne Schlüssel im Link)
  const kalenderTermin: KalenderTermin | null =
    !isQueue && appt.status === 'scheduled' && end && start.getTime() > now
      ? {
          id: appt.id,
          start,
          end,
          titel: names.shop ? t('{leistung} bei {laden}', { leistung: names.service || t('Termin'), laden: names.shop }) : t('Termin'),
          ort: shopData
            ? [shopData.street, [shopData.postalCode, shopData.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || shopData.address
            : undefined,
          link: `${window.location.origin}/nummer/${appt.id}`,
          beschreibung: [names.staff && t('Bei {name}', { name: names.staff }), appt.referenceCode && t('Nummer {nummer}', { nummer: appt.referenceCode })]
            .filter(Boolean)
            .join(' · '),
        }
      : null;

  // Abgesagt oder fertig: gleich wieder buchen, Laden und Leistung (beim Termin auch die Person) vorbelegt
  const neuNummer = `/public-join-queue?${new URLSearchParams({ shopId: appt.shopId, ...(appt.serviceId ? { serviceId: appt.serviceId } : {}) })}`;
  const neuTermin =
    shopData && hasFeature(shopData, 'termine')
      ? `/book-appointment?${new URLSearchParams({
          shopId: appt.shopId,
          ...(appt.serviceId ? { serviceId: appt.serviceId } : {}),
          ...(appt.staffId ? { staffId: appt.staffId } : {}),
        })}`
      : null;

  const cancel = async () => {
    try {
      // Über das Backend, ohne Konto mit dem Schlüssel; es meldet die Absage dem Team (app/apis/nummer)
      await cancelTicket(appt.id, appt.isAnonymous && ticketKey ? ticketKey : null);
      toast.success(isQueue ? t('Deine Nummer ist zurückgegeben.') : t('Dein Termin ist abgesagt.'));
    } catch {
      toast.error(t('Das hat nicht geklappt. Sag bitte am Tresen Bescheid.'));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">
          {movedHere && appt.status === 'scheduled'
            ? t('Dein Termin ist verschoben.')
            : justJoined && appt.status === 'scheduled'
            ? isQueue
              ? t('Du bist eingereiht.')
              : t('Dein Termin ist gebucht.')
            : isQueue
              ? t('Deine Nummer')
              : t('Dein Termin')}
        </h1>
        {names.shop && <p className="text-muted-foreground">{names.shop}</p>}
      </header>

      {movedOnJoin && appt.status === 'scheduled' && (
        <p role="status" className="rounded-2xl border border-border bg-card px-4 py-3 font-semibold">
          {t('Dein Platz hat sich auf {zeit} verschoben – jemand war kurz vor dir dran.', {
            zeit: isToday(start) ? format(start, 'HH:mm') : format(start, t('EEEEEE d.M., HH:mm'), { locale: datumsLocale() }),
          })}
        </p>
      )}

      {appt.status === 'in-progress' && (
        <div role="status" className="flex items-center gap-3 rounded-3xl bg-foreground px-5 py-4 text-background">
          <BellRing className="h-6 w-6 shrink-0 text-signal" aria-hidden="true" />
          <p className="font-display text-2xl font-extrabold">{t('Du bist dran. Komm rein.')}</p>
        </div>
      )}

      <Ticket
        size="lg"
        eyebrow={isQueue ? t('Deine Nummer') : t('Dein Termin')}
        eyebrowRight={[names.service, names.staff].filter(Boolean).join(' · ')}
        number={isQueue ? appt.referenceCode || '—' : format(start, 'HH:mm')}
        stats={
          appt.status !== 'scheduled'
            ? []
            : isQueue
              ? [
                  isToday(start) ? { label: t('Vor dir'), value: String(ahead) } : { label: t('Wann'), value: dayLabel(start) },
                  { label: t('Dran um ca.'), value: format(shownTime, 'HH:mm') },
                ]
              : terminStats
        }
      />

      {appt.status === 'scheduled' && isToday(start) && delay >= SHOW_DELAY_MINUTES && (
        <p className="text-sm font-semibold" aria-live="polite">
          {isQueue
            ? tn(
                delay,
                'Heute dauert es etwas länger: ursprünglich {zeit}, jetzt etwa {n} Minute später.',
                'Heute dauert es etwas länger: ursprünglich {zeit}, jetzt etwa {n} Minuten später.',
                { zeit: format(start, 'HH:mm') },
              )
            : tn(
                delay,
                'Der Laden hängt gerade etwa {n} Minute hinterher. Rechne mit etwas Wartezeit.',
                'Der Laden hängt gerade etwa {n} Minuten hinterher. Rechne mit etwas Wartezeit.',
              )}
        </p>
      )}

      {appt.status === 'scheduled' && isQueue && (
        <p className="text-sm">
          <strong>{t('Rechne mit {von} bis {bis} Uhr.', caFenster(shownTime))}</strong>{' '}
          <span className="text-muted-foreground">{t('Bist du beim Aufruf nicht da, kann der Laden deine Nummer austragen.')}</span>
        </p>
      )}

      {appt.status === 'completed' && <p className="text-lg font-semibold">{t('Fertig. Danke für deinen Besuch!')}</p>}
      {appt.status === 'cancelled' && (
        <p className="text-lg font-semibold">{isQueue ? t('Diese Nummer ist abgesagt.') : t('Dieser Termin ist abgesagt.')}</p>
      )}
      {(appt.status === 'cancelled' || appt.status === 'completed') && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {isQueue || !neuTermin ? (
            <>
              <Button size="lg" variant="signal" className="sm:flex-1" asChild>
                <Link to={neuNummer}>{appt.status === 'completed' ? t('Nochmal Nummer ziehen') : t('Neue Nummer ziehen')}</Link>
              </Button>
              {neuTermin && (
                <Button size="lg" variant="outline" className="sm:flex-1" asChild>
                  <Link to={neuTermin}>{t('Termin buchen')}</Link>
                </Button>
              )}
            </>
          ) : (
            <>
              <Button size="lg" variant="signal" className="sm:flex-1" asChild>
                <Link to={neuTermin}>{appt.status === 'completed' ? t('Nochmal buchen') : t('Neuen Termin buchen')}</Link>
              </Button>
              <Button size="lg" variant="outline" className="sm:flex-1" asChild>
                <Link to={neuNummer}>{t('Nummer ziehen')}</Link>
              </Button>
            </>
          )}
        </div>
      )}

      {kalenderTermin && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="outline" onClick={() => kalenderDateiLaden(kalenderTermin)}>
            <CalendarPlus className="me-2 h-4 w-4" aria-hidden="true" />
            {t('In meinen Kalender')}
          </Button>
          <a
            href={googleKalenderLink(kalenderTermin)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold underline underline-offset-2"
          >
            {t('Google Kalender')}
          </a>
        </div>
      )}

      {appt.status === 'scheduled' && shopData && hasFeature(shopData, 'benachrichtigung') && (
        <NotifyCard appt={appt} ticketKey={ticketKey} userEmail={user?.email ?? ''} />
      )}

      {appt.status === 'scheduled' && start && shopData && hasFeature(shopData, 'frueherDran') && (
        <FrueherDranSchalter appointmentId={appt.id} start={start} claimedKey={appt.isAnonymous} />
      )}

      {appt.status === 'scheduled' && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('Diese Seite aktualisiert sich von selbst. Du kannst sie schließen und über den Link oder die Startseite wieder öffnen.')}
        </p>
      )}

      {appt.isAnonymous && appt.status === 'scheduled' && !user && ticketKey && shopData && hasFeature(shopData, 'frueherDran') && (
        <div className="rounded-2xl border border-border p-4 text-sm">
          <strong className="block">{t('Früher dran, wenn etwas frei wird')}</strong>
          <span className="text-muted-foreground">
            {t(
              'Das geht mit Konto: Wird vorher ein Platz frei, bieten wir ihn dir an. Leg eins an – deine Nummer bleibt, und du kannst es gleich hier einschalten.',
            )}
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
            {t('Konto anlegen und Nummer behalten')}
          </Button>
        )}
        {canMove && (
          <Button size="lg" variant="outline" className="sm:flex-1" onClick={() => setMoving(true)}>
            {t('Platz ändern')}
          </Button>
        )}
        {appt.status === 'scheduled' && canCancel && (
          <CancelButton
            onConfirm={cancel}
            label={isQueue ? t('Nummer zurückgeben') : t('Termin absagen')}
            confirmLabel={isQueue ? t('Ja, zurückgeben') : t('Ja, absagen')}
            onMove={canMove ? () => setMoving(true) : undefined}
          />
        )}
      </div>
      {canMove && (
        <PlatzAendern
          open={moving}
          onOpenChange={setMoving}
          appointmentId={appt.id}
          shopId={appt.shopId}
          serviceId={appt.serviceId}
          staffId={appt.staffId}
          ticketKey={ticketKey}
          signedIn={Boolean(user)}
          currentStart={start}
          onMoved={() => setMovedHere(true)}
        />
      )}
      {appt.status === 'scheduled' && !canCancel && (
        <p className="text-sm text-muted-foreground">
          {appt.isAnonymous
            ? isQueue
              ? t('Zurückgeben geht auf dem Handy, mit dem du die Nummer gezogen hast, oder am Tresen.')
              : t('Absagen geht auf dem Handy, mit dem du gebucht hast, oder am Tresen.')
            : t('Zum Absagen melde dich mit deinem Konto an – oder sag am Tresen Bescheid.')}
        </p>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link to={`/shop-details?shopId=${appt.shopId}`} className="font-semibold underline underline-offset-2">
          {t('Zum Laden')}
        </Link>
        <HilfeLink hilfe="so-funktioniert-die-nummer">{t('So funktioniert’s')}</HilfeLink>
      </div>
    </div>
  );
}

/** onMove: statt zurückgeben eine andere Zeit anbieten (Platz ändern) – wer gehen will, will oft nur später kommen */
function CancelButton({ onConfirm, label, confirmLabel, onMove }: { onConfirm: () => void; label: string; confirmLabel: string; onMove?: () => void }) {
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
      <p className="text-sm font-semibold">{t('Wirklich? Dein Platz wird dann frei.')}</p>
      <div className="flex gap-2">
        <Button variant="destructive" className="flex-1" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => setAsking(false)}>
          {t('Behalten')}
        </Button>
      </div>
      {onMove && (
        <button
          type="button"
          className="self-start text-sm font-semibold underline underline-offset-2"
          onClick={() => {
            setAsking(false);
            onMove();
          }}
        >
          {t('Lieber eine andere Zeit?')}
        </button>
      )}
    </div>
  );
}

/** Benachrichtigung einschalten: Push, wo der Browser es kann (in der iPhone/iPad-App nativ), sonst E-Mail. */
function NotifyCard({ appt, ticketKey, userEmail }: { appt: PublicAppointment; ticketKey: string | null; userEmail: string }) {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [pushOn, setPushOn] = useState(() => pushEnabledFor(appt.id));
  const [busy, setBusy] = useState(false);
  const [savedEmail, setSavedEmail] = useState(() => savedNotifyEmail(appt.id));
  const [email, setEmail] = useState(savedEmail || userEmail);

  useEffect(() => {
    getPushConfig().then(setConfig);
  }, []);

  if (!config || (!config.push && !config.email && !config.app)) return null;

  // In der App gibt es keinen Web-Push, dafür den nativen (utils/native-app.ts)
  const app = inNativeApp();
  const iosBrowser = !app && isIos() && !isStandalone();
  const canPush = app ? Boolean(config.app) : config.push && pushSupported() && !iosBrowser;

  const turnOnPush = async () => {
    setBusy(true);
    try {
      const result = app ? await enableAppPush(appt.id, ticketKey) : await enablePush(appt.id, config.publicKey, ticketKey);
      if (result === 'ok') {
        setPushOn(true);
        toast.success(t('Wir sagen dir Bescheid, kurz bevor du dran bist.'));
      } else if (result === 'denied' && app) {
        toast.error(t('Mitteilungen für Dranzeit sind aus. Du kannst sie in den Einstellungen deines Geräts unter Dranzeit einschalten.'));
      } else if (result === 'denied') {
        toast.error(t('Benachrichtigungen sind für diese Seite blockiert. Du kannst sie in den Browser-Einstellungen erlauben.'));
      } else {
        toast.error(t('Dein Browser kann keine Benachrichtigungen. Nimm die E-Mail.'));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
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
      toast.success(t('Wir schicken dir eine E-Mail, kurz bevor du dran bist.'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
    } finally {
      setBusy(false);
    }
  };

  const emailSaved = Boolean(savedEmail);

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5" aria-labelledby="bescheid">
      <h2 id="bescheid" className="font-display text-xl font-bold">
        {t('Bescheid bekommen')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('Wir melden uns, kurz bevor du dran bist. Bis dahin bist du frei.')}</p>

      {canPush &&
        (pushOn ? (
          <p className="flex items-center gap-2 font-semibold">
            <Check className="h-5 w-5" aria-hidden="true" /> {t('Benachrichtigung ist an.')}
          </p>
        ) : (
          <Button size="lg" onClick={turnOnPush} disabled={busy}>
            <Bell className="me-2 h-5 w-5" aria-hidden="true" /> {t('Benachrichtigung einschalten')}
          </Button>
        ))}

      {iosBrowser && config.push && (
        <p className="text-sm text-muted-foreground">
          {t('Auf dem iPhone kommen Benachrichtigungen im Browser nicht an. Trag hier deine E-Mail ein, dann sagen wir dir per Mail Bescheid.')}
        </p>
      )}

      {config.email && (!canPush || !pushOn) && (
        <form onSubmit={saveEmail} className="flex flex-col gap-2">
          <Label htmlFor="notify-email">{canPush ? t('Oder per E-Mail') : t('Per E-Mail')}</Label>
          <div className="flex gap-2">
            <Input
              id="notify-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              dir="ltr"
              placeholder={t('du@beispiel.de')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" variant={canPush ? 'outline' : 'default'} disabled={busy}>
              <Mail className="me-2 h-4 w-4" aria-hidden="true" /> {emailSaved ? t('Ändern') : t('Speichern')}
            </Button>
          </div>
          {emailSaved && <p className="text-sm font-semibold">{t('E-Mail ist hinterlegt.')}</p>}
          <p className="text-xs text-muted-foreground">
            {t('Nur für diese Nummer. Wir löschen die Adresse spätestens 90 Tage nach dem Termin.')}
          </p>
        </form>
      )}
    </section>
  );
}
