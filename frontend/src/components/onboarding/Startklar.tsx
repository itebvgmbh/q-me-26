import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDocs, limit, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { Check, ChevronDown, Copy, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { APP_BASE_PATH } from 'app';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { firestore } from '../../utils/firestore-client';
import type { Appointment, Shop, Staff } from '../../utils/firestore';
import { HilfeLink } from '../HilfeLink';

/**
 * „Startklar“-Liste am Tresen (Vorbild: Shopifys Einrichtungsleitfaden). Höchstens fünf Schritte, keiner Pflicht,
 * jeder erkennt sich selbst als erledigt. Merker stehen am Laden (shop.onboarding), damit die Liste auf jedem
 * Gerät gleich aussieht; klappt das Schreiben nicht, wenigstens in diesem Browser.
 */
type Flag = 'testlaufAt' | 'plakatAt' | 'dismissedAt';

const storageKey = (shopId: string, flag: Flag) => `dranzeit:startklar:${shopId}:${flag}`;

export const markOnboarding = async (shopId: string, flag: Flag) => {
  try {
    localStorage.setItem(storageKey(shopId, flag), '1');
  } catch {
    // privater Modus: dann eben nur am Laden
  }
  try {
    await setDoc(doc(firestore, 'shops', shopId), { onboarding: { [flag]: Timestamp.now() } }, { merge: true });
  } catch (error) {
    console.warn('Startklar-Merker nicht gespeichert:', error);
  }
};

const hasFlag = (shop: Shop, flag: Flag) => {
  if (shop.onboarding?.[flag]) return true;
  try {
    return localStorage.getItem(storageKey(shop.id, flag)) === '1';
  } catch {
    return false;
  }
};

/** Wurde in diesem Laden schon einmal jemand aufgerufen? (einmal beim Öffnen; heute zählt live über appointments) */
const useEverCalled = (shopId: string, skip: boolean) => {
  const [called, setCalled] = useState(false);
  useEffect(() => {
    if (skip) return;
    let alive = true;
    getDocs(query(collection(firestore, 'appointments'), where('shopId', '==', shopId), where('status', 'in', ['in-progress', 'completed']), limit(1)))
      .then((snap) => alive && setCalled(!snap.empty))
      .catch((error) => console.warn('Startklar: Verlauf nicht lesbar', error));
    return () => {
      alive = false;
    };
  }, [shopId, skip]);
  return called;
};

interface Step {
  key: string;
  title: string;
  done: boolean;
  body?: ReactNode;
  action?: ReactNode;
  hilfe?: string;
}

interface Props {
  shop: Shop;
  staff: Staff[];
  /** heutige Termine und Nummern (live vom Tresen) */
  appointments: Appointment[];
  onEditShop: () => void;
}

export const Startklar = ({ shop, staff, appointments, onEditShop }: Props) => {
  const [dismissed, setDismissed] = useState(() => hasFlag(shop, 'dismissedAt'));
  const testlaufFlag = hasFlag(shop, 'testlaufAt');
  const everCalled = useEverCalled(shop.id, testlaufFlag || dismissed);
  const calledToday = appointments.some((a) => a.status === 'in-progress' || a.status === 'completed');
  const testlauf = testlaufFlag || everCalled || calledToday;

  // Erledigten Testlauf dauerhaft merken, dann muss niemand mehr nachsehen
  const saved = useRef(false);
  useEffect(() => {
    if (testlauf && !testlaufFlag && !saved.current) {
      saved.current = true;
      markOnboarding(shop.id, 'testlaufAt');
    }
  }, [testlauf, testlaufFlag, shop.id]);

  const joinUrl = `${window.location.origin}${APP_BASE_PATH}/public-join-queue?shopId=${shop.id}`;
  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [
      { key: 'laden', title: 'Laden eröffnet', done: true },
      {
        key: 'testlauf',
        title: 'Einmal selbst ausprobieren',
        done: testlauf,
        body: (
          <ol className="list-decimal space-y-1 ps-4">
            <li>Scann den QR-Code mit deinem Handy und zieh eine Nummer – so wie später deine Kunden. Nimm ein Gerät, auf dem du nicht angemeldet bist.</li>
            <li>Die Nummer erscheint hier in deiner Spalte. Tipp auf „Nächste Nummer aufrufen“.</li>
            <li>Auf dem Handy steht jetzt „Du bist dran“. Tipp hier auf „Fertig“.</li>
          </ol>
        ),
        action: (
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl bg-white p-2">
              <QRCodeSVG value={joinUrl} size={112} level="M" title="QR-Code zum Nummer-Ziehen" />
            </div>
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(joinUrl).then(() => toast.success('Link kopiert.'), () => toast.error('Kopieren ging nicht.'))}
            >
              <Copy className="me-2 h-4 w-4" aria-hidden="true" />
              Link kopieren
            </Button>
          </div>
        ),
        hilfe: 'testlauf',
      },
      {
        key: 'plakat',
        title: 'QR-Plakat aufhängen',
        done: hasFlag(shop, 'plakatAt'),
        body: 'Druck das Plakat aus und häng es an Tür oder Tresen – dort, wo Kunden es sehen, bevor sie sich hinsetzen.',
        action: (
          <Button asChild>
            <Link to="/plakat">Plakat drucken</Link>
          </Button>
        ),
        hilfe: 'plakat',
      },
    ];
    if (!shop.city?.trim() || !shop.street?.trim()) {
      list.push({
        key: 'adresse',
        title: 'Adresse ergänzen',
        done: false,
        body: 'Ohne Adresse finden dich Kunden nicht auf der Karte und nicht auf den Seiten „Friseur ohne Termin“.',
        action: <Button onClick={onEditShop}>Laden bearbeiten</Button>,
        hilfe: 'gefunden-werden',
      });
    }
    if (staff.length > 1) {
      list.push({
        key: 'team',
        title: 'Team einladen',
        done: staff.every((s) => Boolean(s.userId)),
        body: 'Wen du beim Einrichten mit E-Mail eingetragen hast, der hat seine Einladung schon bekommen. Allen anderen schick ihren Link unter „Team“. Damit legt die Person ein Passwort fest und sieht ihren eigenen Tag.',
        action: (
          <Button asChild>
            <Link to="/staff-management">Zum Team</Link>
          </Button>
        ),
        hilfe: 'team-einladen',
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testlauf, shop, staff]);

  const firstOpen = steps.find((s) => !s.done)?.key ?? '';
  const [expanded, setExpanded] = useState(firstOpen);
  useEffect(() => setExpanded(firstOpen), [firstOpen]);

  if (dismissed) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const dismiss = () => {
    setDismissed(true);
    markOnboarding(shop.id, 'dismissedAt');
  };

  if (allDone) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-foreground p-5 text-background sm:p-6" aria-label="Startklar">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal text-signal-foreground">
            <Check className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-display text-xl font-bold">Startklar.</p>
            <p className="text-sm text-background/75">Dein Laden ist eingerichtet. Ab jetzt reihen sich Kunden selbst ein.</p>
          </div>
        </div>
        <Button variant="signal" onClick={dismiss}>
          Ausblenden
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6" aria-labelledby="startklar-titel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="startklar-titel" className="font-display text-xl font-bold">
            Startklar machen
          </h2>
          <p className="text-sm text-muted-foreground">
            {doneCount} von {steps.length} erledigt · nichts davon ist Pflicht
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Liste ausblenden" title="Ausblenden">
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Fortschritt">
        <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 flex flex-col divide-y divide-border">
        {steps.map((step) => {
          const open = expanded === step.key && Boolean(step.body);
          return (
            <li key={step.key}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 py-2 text-start disabled:cursor-default"
                aria-expanded={step.body ? open : undefined}
                disabled={!step.body}
                onClick={() => setExpanded(open ? '' : step.key)}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2',
                    step.done ? 'border-foreground bg-foreground text-signal' : 'border-border',
                  )}
                >
                  {step.done && <Check className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className={cn('flex-1 font-semibold', step.done && 'text-muted-foreground line-through decoration-2')}>
                  {step.title}
                  <span className="sr-only">{step.done ? ' (erledigt)' : ' (offen)'}</span>
                </span>
                {step.body && <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />}
              </button>
              {open && (
                <div className="flex flex-col items-start gap-3 pb-4 ps-10 text-sm">
                  <div className="text-muted-foreground">{step.body}</div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {step.action}
                    {step.hilfe && <HilfeLink hilfe={step.hilfe} />}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
