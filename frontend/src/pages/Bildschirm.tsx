import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { QRCodeSVG } from 'qrcode.react';
import { APP_BASE_PATH } from 'app';
import { BrandMark } from '../components/brand/Logo';
import { HILFE_MAIL } from '../components/HilfeLink';
import { ShopLogo } from '../components/brand/ShopLogo';
import { hasFeature } from '../utils/plans';
import { useKeepScreenOn } from '../utils/native-app';
import { expectedStart, projectLane, waitingInOrder } from '../utils/queue-lane';
import type { Shop } from '../utils/firestore';
import type { PublicAppointment } from '../utils/firestore/public-appointments';
import { useLive } from '../utils/live';
import { t, tn } from '@/i18n';
import { inStoreApp } from '../utils/app-shell';

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

/** Was das Backend für den Bildschirm liefert (backend/app/apis/live: GET /live/bildschirm/{shopId}?tag=…) */
interface BildschirmLive {
  laden: Shop;
  /** Aktive Personen des Ladens, nur mit Namen */
  personen: { id: string; name: string }[];
  termine: PublicAppointment[];
  tag: string;
  kanaele: string[];
}

/**
 * Wartezimmer-Bildschirm für einen Fernseher im Laden: wer ist dran, wer kommt als Nächstes,
 * QR-Code zum Nummer-Ziehen. Öffentlich (der Fernseher meldet sich nicht an), zeigt nur Nummern. Die Daten kommen vom
 * Backend: nur die öffentlichen Kurzfassungen der Termine und die Namen der Personen (utils/live.ts). Laden und Team
 * lädt er jede Minute neu, Termine sofort bei jeder Änderung.
 * Gehört zum Tarif Laden (utils/plans.ts).
 */
export default function Bildschirm() {
  const { shopId = '' } = useParams();
  const [now, setNow] = useState(() => new Date());
  const today = dayKey(now);
  // Um Mitternacht kommt mit dem neuen Tag ein neuer Abruf, bis dahin bleibt der alte stehen
  const live = useLive<BildschirmLive>(shopId ? `bildschirm/${encodeURIComponent(shopId)}?tag=${today}` : null);
  const shop: Shop | null | undefined = live.fehlt ? null : live.daten ? live.daten.laden : undefined;
  const staff = live.daten?.personen;
  const appts = live.daten?.termine;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // Bildschirm bleibt an: in der App immer, im Browser, wo er es erlaubt
  useKeepScreenOn();

  const lanes = useMemo(() => {
    const nowMs = now.getTime();
    if (!staff || !appts) return [];
    return staff
      .map((person) => {
        // Wer wartet, bleibt stehen, bis er aufgerufen oder abgesagt wird (utils/queue-lane.ts)
        const mine = appts.filter((a) => a.staffId === person.id);
        const current = mine.filter((a) => a.status === 'in-progress');
        const next = waitingInOrder(mine);
        return { person, current, next, projection: projectLane(mine, nowMs) };
      })
      .filter((lane) => lane.current.length > 0 || lane.next.length > 0 || staff.length <= 4);
  }, [staff, appts, now]);

  if (shop === undefined) return <div className="min-h-screen bg-foreground" />;
  if (shop === null) {
    return <Message title={t('Diesen Laden gibt es nicht.')} text={t('Prüf den Link zum Bildschirm am Tresen.')} />;
  }
  if (shop.suspended) {
    return <Message title={t('Dieser Laden ist gerade gesperrt.')} text={t('Fragen beantworten wir unter {mail}.', { mail: HILFE_MAIL })} />;
  }
  if (!hasFeature(shop, 'bildschirm', now)) {
    return <Message title={t('Der Wartezimmer-Bildschirm gehört zum Tarif Laden.')} text={inStoreApp() ? '' : t('Unter „Tarif“ lässt er sich freischalten.')} />;
  }

  const joinUrl = `${window.location.origin}${APP_BASE_PATH}/public-join-queue?shopId=${shopId}`;
  const waiting = lanes.reduce((n, l) => n + l.next.length, 0);
  const label = (a: PublicAppointment) => a.referenceCode || '•';

  return (
    <div className="flex min-h-screen flex-col gap-[2vw] bg-foreground p-[2.5vw] text-background">
      <header className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <ShopLogo url={shop.logoUrl} className="h-[5vw] w-[5vw] min-h-12 min-w-12" />
          <h1 className="truncate font-display text-[3.2vw] font-extrabold leading-none tracking-[-0.03em]">{shop.name}</h1>
        </div>
        <p className="font-mono text-[3.2vw] font-bold tabular-nums">{format(now, 'HH:mm')}</p>
      </header>

      <main className="grid flex-1 grid-cols-[1fr_auto] gap-[2vw]">
        <section className="grid auto-rows-fr gap-[1.2vw]" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(lanes.length, 1), 4)}, minmax(0, 1fr))` }}>
          {lanes.length === 0 && (
            <div className="flex items-center justify-center rounded-[2vw] bg-background/[0.06] font-display text-[3vw] font-bold">{t('Gerade wartet niemand.')}</div>
          )}
          {lanes.map(({ person, current, next, projection }) => (
            <article key={person.id} className="flex min-w-0 flex-col gap-[1vw] rounded-[2vw] bg-background/[0.06] p-[1.6vw]">
              <h2 className="truncate font-display text-[2vw] font-bold">{person.name}</h2>
              <div className="flex flex-col gap-[0.4vw] rounded-[1.4vw] bg-signal p-[1.4vw] text-signal-foreground">
                <span className="text-[1vw] font-semibold uppercase tracking-[0.08em]">{t('Jetzt dran')}</span>
                <span className="font-mono text-[6vw] font-bold leading-none tracking-[-0.04em]">
                  {current.length > 0 ? current.map(label).join(' ') : '–'}
                </span>
              </div>
              <div className="flex flex-col gap-[0.6vw]">
                <span className="text-[1vw] font-semibold uppercase tracking-[0.08em] text-background/60">{t('Als Nächstes')}</span>
                {next.slice(0, 4).map((a) => (
                  <div key={a.id} className="flex items-baseline justify-between gap-2 font-mono">
                    <span className="text-[3vw] font-bold leading-none">{label(a)}</span>
                    <span className="text-[1.5vw] text-background/70">
                      {t('ca. {zeit}', { zeit: format(expectedStart(a, projection), 'HH:mm') })}
                    </span>
                  </div>
                ))}
                {next.length === 0 && <span className="text-[1.6vw] text-background/60">{t('frei')}</span>}
                {next.length > 4 && (
                  <span className="text-[1.4vw] text-background/60">{t('+ {anzahl} weitere', { anzahl: next.length - 4 })}</span>
                )}
              </div>
            </article>
          ))}
        </section>

        <aside className="flex w-[22vw] flex-col items-center justify-center gap-[1.2vw] rounded-[2vw] bg-background p-[1.6vw] text-center text-foreground">
          <p className="font-display text-[2vw] font-extrabold leading-tight">{t('Nummer ziehen ohne App')}</p>
          <QRCodeSVG value={joinUrl} size={512} className="h-auto w-full" marginSize={1} />
          <p className="text-[1.2vw] text-muted-foreground">
            {t('Scannen, Leistung wählen, draußen warten. Auf dem Handy siehst du, wann du dran bist.')}
          </p>
        </aside>
      </main>

      <footer className="flex items-center justify-between gap-4 text-[1.3vw] text-background/70">
        <span>{waiting === 0 ? t('Keine Wartenden') : tn(waiting, '{n} Person wartet', '{n} Personen warten')}</span>
        <span className="flex items-center gap-2 font-semibold text-background">
          <BrandMark inverted className="h-[2vw] w-[2vw]" /> Dranzeit
        </span>
      </footer>
    </div>
  );
}

const Message = ({ title, text }: { title: string; text: string }) => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-foreground p-8 text-center text-background">
    <p className="font-display text-4xl font-extrabold">{title}</p>
    <p className="text-lg text-background/70">{text}</p>
  </div>
);
