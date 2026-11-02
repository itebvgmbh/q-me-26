import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getShopsByOwnerId, type Shop } from '../utils/firestore';
import { merkeLaden, waehleLaden } from '../utils/laden-wahl';
import { ladeTelefon, speichereTelefon, zumWaehlen, type TelefonStand } from '../utils/telefon-assistent';
import { merke, t } from '@/i18n';

const HILFE = 'hilfe@dranzeit.de';
const NEU_PRUEFEN_MS = 5000; // so oft schaut die Seite nach dem Probeanruf

const WEGE = [
  { id: 'handy', titel: merke('Handy') },
  { id: 'telekom', titel: merke('Festnetz Telekom') },
  { id: 'fritzbox', titel: merke('Fritzbox') },
  { id: 'andere', titel: merke('Anderer Anbieter') },
] as const;
type Weg = (typeof WEGE)[number]['id'];

const Schritt = ({ nummer, titel, children }: { nummer: number; titel: string; children: ReactNode }) => (
  <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5">
    <h2 className="font-display text-xl font-bold">
      {nummer}. {titel}
    </h2>
    {children}
  </section>
);

const Code = ({ code, wann }: { code: string; wann: string }) => (
  <div className="flex flex-col gap-0.5">
    <code dir="ltr" className="w-fit rounded-lg bg-muted px-2 py-1 font-mono text-sm font-semibold">
      {code}
    </code>
    <span className="text-sm text-muted-foreground">{wann}</span>
  </div>
);

/** Wie der Laden die Umleitung einrichtet. Die Codes unterscheiden sich zwischen Handy (##…) und Festnetz (#…) */
const Anleitung = ({ weg, ziel }: { weg: Weg; ziel: string }) => {
  if (weg === 'fritzbox') {
    return (
      <>
        <p className="text-sm">{t('In der Fritzbox unter „Telefonie“, „Rufbehandlung“, „Rufumleitung“ eine neue Umleitung anlegen. Als Ziel trägst du die Nummer oben ein.')}</p>
        <p className="text-sm text-muted-foreground">{t('Erkennt der Probeanruf danach nichts, richte die Umleitung direkt bei deinem Telefonanbieter ein.')}</p>
      </>
    );
  }
  if (weg === 'andere') {
    return <p className="text-sm">{t('Such im Kundenportal deines Anbieters nach „Rufumleitung“ oder „Anrufweiterschaltung“. Richte sie für „bei Nichtmelden“ und „bei besetzt“ ein. Als Ziel trägst du die Nummer oben ein.')}</p>;
  }
  const handy = weg === 'handy';
  return (
    <>
      <p className="text-sm">{t('Gib diese Codes nacheinander ein und drück jeweils die Wähltaste:')}</p>
      <Code code={handy ? `**61*${ziel}**20#` : `*61*${ziel}#`} wann={t('wenn nach 20 Sekunden niemand rangeht')} />
      <Code code={handy ? `**67*${ziel}#` : `*67*${ziel}#`} wann={t('wenn besetzt ist')} />
      <p className="text-sm text-muted-foreground">
        {t('Zum Ausschalten:')}{' '}
        <code dir="ltr" className="font-mono">
          {handy ? '##61#' : '#61#'}
        </code>{' '}
        {t('und')}{' '}
        <code dir="ltr" className="font-mono">
          {handy ? '##67#' : '#67#'}
        </code>
      </p>
      {handy && <p className="text-sm text-muted-foreground">{t('Geht trotzdem die Mailbox ran, schalte sie bei deinem Anbieter aus.')}</p>}
    </>
  );
};

/**
 * Telefon-Assistent: Der Inhaber trägt die Nummer seines Ladens ein, richtet die Umleitung ein und macht einen
 * Probeanruf. Erkannt wird der Anruf im Backend (backend/app/apis/telefon_eingang), die Seite schaut alle paar Sekunden nach.
 */
export default function TelefonAssistent() {
  const { user } = useCurrentUser();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [shopId, setShopId] = useState('');
  const [stand, setStand] = useState<TelefonStand | null>(null);
  const [fehler, setFehler] = useState('');
  const [nummer, setNummer] = useState('');
  const [weg, setWeg] = useState<Weg>('handy');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    getShopsByOwnerId(user.uid)
      .then((list) => {
        setShops(list);
        setShopId((current) => current || waehleLaden(list)?.id || '');
      })
      .catch(() => setFehler(t('Die Daten des Ladens konnten nicht geladen werden.')));
  }, [user]);

  useEffect(() => {
    if (!shopId) return;
    merkeLaden(shopId);
    setStand(null);
    setFehler('');
    ladeTelefon(shopId)
      .then((neu) => {
        setStand(neu);
        setNummer(zumWaehlen(neu.anschluss || neu.vorschlag));
      })
      .catch((e) => setFehler(e instanceof Error ? e.message : t('Das hat nicht geklappt.')));
  }, [shopId]);

  const wartet = stand?.aktiv && stand.status === 'wartet';
  useEffect(() => {
    if (!wartet) return;
    const timer = window.setInterval(() => {
      ladeTelefon(shopId).then(setStand).catch(() => undefined);
    }, NEU_PRUEFEN_MS);
    return () => window.clearInterval(timer);
  }, [wartet, shopId]);

  const speichern = async (aktiv: boolean) => {
    setBusy(true);
    try {
      setStand(await speichereTelefon(shopId, aktiv, nummer));
      toast.success(aktiv ? t('Gespeichert.') : t('Ausgeschaltet.'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
    } finally {
      setBusy(false);
    }
  };

  const kopieren = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('Nummer kopiert.'));
    } catch {
      toast.error(t('Kopieren ging nicht.'));
    }
  };

  const seite = (inhalt: ReactNode) => (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Telefon-Assistent')}</h1>
        <p className="text-muted-foreground">{t('Geht im Laden niemand ran, nimmt eine KI den Anruf an. Sie nennt freie Termine, bucht sie, sagt die Wartezeit und zieht Nummern. Im ersten Satz sagt sie, dass sie eine KI ist.')}</p>
        {shops && shops.length > 1 && (
          <select
            aria-label={t('Laden wählen')}
            className="w-full max-w-xs rounded-xl border border-border bg-card px-3 py-2"
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </header>
      {inhalt}
    </div>
  );

  if (fehler) return seite(<p role="alert">{fehler}</p>);
  if (shops && !shops.length) return seite(<p>{t('Richte zuerst deinen Laden ein.')}</p>);
  if (!stand) return seite(<p className="text-muted-foreground">{t('Wird geladen')}</p>);
  if (!stand.freigegeben) {
    return seite(
      <p className="rounded-3xl border border-border bg-card p-5">
        {t('Der Telefon-Assistent ist für deinen Laden noch nicht freigeschaltet. Schreib uns an {mail}, wenn du ihn ausprobieren möchtest.', { mail: HILFE })}
      </p>,
    );
  }

  const ziel = zumWaehlen(stand.zielnummer);
  const aufgebraucht = stand.minuten >= stand.freiminuten;

  return seite(
    <>
      <Schritt nummer={1} titel={stand.eigeneNummer ? t('Einschalten') : t('Nummer deines Ladens')}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            speichern(true);
          }}
        >
          {!stand.eigeneNummer && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="laden-nummer">{t('Nummer, die Kunden anrufen')}</Label>
              <Input id="laden-nummer" type="tel" inputMode="tel" dir="ltr" placeholder="030 1234567" value={nummer} onChange={(e) => setNummer(e.target.value)} required />
              <p className="text-sm text-muted-foreground">{t('Der Assistent nimmt nur Anrufe an, die von dieser Nummer umgeleitet werden.')}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {stand.aktiv ? t('Speichern') : t('Einschalten')}
            </Button>
            {stand.aktiv && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => speichern(false)}>
                {t('Ausschalten')}
              </Button>
            )}
          </div>
        </form>
        {!stand.aktiv && stand.status !== 'aus' && (
          <p className="text-sm">{t('Ausgeschaltet. Anrufer hören nur noch eine kurze Ansage, bis du auch die Umleitung bei deinem Anbieter entfernst.')}</p>
        )}
      </Schritt>

      {stand.aktiv && (
        <>
          <Schritt nummer={2} titel={t('Umleitung einrichten')}>
            <p className="text-sm">{t('Leite die Anrufe deines Ladens auf diese Nummer um:')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <strong dir="ltr" className="font-mono text-xl">
                {ziel || t('Noch nicht eingerichtet')}
              </strong>
              {ziel && (
                <Button type="button" size="sm" variant="outline" onClick={() => kopieren(ziel)}>
                  {t('Kopieren')}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Wie telefonierst du im Laden?')}>
              {WEGE.map((w) => (
                <Button key={w.id} type="button" size="sm" variant={weg === w.id ? 'default' : 'outline'} aria-pressed={weg === w.id} onClick={() => setWeg(w.id)}>
                  {t(w.titel)}
                </Button>
              ))}
            </div>
            {ziel && <Anleitung weg={weg} ziel={ziel} />}
          </Schritt>

          <Schritt nummer={3} titel={t('Probeanruf')}>
            {stand.status === 'aktiv' ? (
              <p role="status" className="font-semibold">
                {t('Aktiv: Der Assistent nimmt ab, wenn im Laden niemand rangeht.')}
              </p>
            ) : (
              <>
                <p role="status">{t('Ruf jetzt deinen Laden von einem anderen Telefon an und geh nicht ran. Sobald der Assistent abnimmt, steht hier „Aktiv“.')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('Passiert nichts? Manche Anbieter schicken die Nummer deines Ladens nicht mit. Schreib uns an {mail}, dann bekommst du eine eigene Nummer.', { mail: HILFE })}
                </p>
              </>
            )}
          </Schritt>
        </>
      )}

      <p className="text-sm text-muted-foreground">
        {t('{minuten} von {frei} freien Minuten verbraucht.', { minuten: stand.minuten, frei: stand.freiminuten })}{' '}
        {aufgebraucht && t('Anrufer hören jetzt nur noch eine kurze Ansage. Schreib uns an {mail}.', { mail: HILFE })}
      </p>
    </>,
  );
}
