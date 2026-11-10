import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInhaberLaden } from '../utils/laden-kontext';
import { API_BESCHREIBUNG, ladeSchluessel, schluesselAnlegen, schluesselWiderrufen, type ApiSchluessel } from '../utils/api-schluessel';
import { datumsLocale, t } from '@/i18n';

/**
 * Schnittstelle (API): Der Inhaber erzeugt Schlüssel, mit denen eigene Programme (Webseite, Kasse) Kunden, Leistungen
 * und Termine des Ladens anlegen und lesen (backend/app/schnittstelle, requirements/termin-api.md). Der Schlüssel steht
 * nur einmal da, direkt nach dem Anlegen. Welcher Laden: oben in der Kopfzeile (utils/laden-kontext.tsx).
 */
export default function Schnittstelle() {
  const { laeden, laden } = useInhaberLaden();
  const shopId = laden?.id ?? '';
  const [stand, setStand] = useState<{ schluessel: ApiSchluessel[]; tarif: boolean } | null>(null);
  const [name, setName] = useState('');
  const [neu, setNeu] = useState<{ name: string; schluessel: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [fragen, setFragen] = useState('');

  const laden_ = useCallback(() => {
    if (!shopId) return;
    ladeSchluessel(shopId)
      .then(setStand)
      .catch((e) => toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.')));
  }, [shopId]);

  useEffect(() => {
    setStand(null);
    setNeu(null);
    laden_();
  }, [laden_]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
    } finally {
      setBusy('');
    }
  };

  const anlegen = () =>
    run('anlegen', async () => {
      const r = await schluesselAnlegen(shopId, name.trim());
      setNeu({ name: r.eintrag.name, schluessel: r.schluessel });
      setName('');
      laden_();
    });

  const widerrufen = (id: string) =>
    run(id, async () => {
      await schluesselWiderrufen(shopId, id);
      setFragen('');
      toast.success(t('Schlüssel widerrufen. Er geht ab sofort nicht mehr.'));
      laden_();
    });

  const kopieren = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(t('Kopiert.')),
      () => toast.error(t('Kopieren ging nicht. Markier den Text und kopier ihn von Hand.')),
    );

  const datum = (z?: { toDate(): Date } | null) => (z ? format(z.toDate(), t('d. MMMM yyyy, HH:mm'), { locale: datumsLocale() }) : '');

  if (laeden === null || (shopId && stand === null)) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-muted-foreground sm:px-6">{t('Wird geladen …')}</div>;
  }
  if (!laden) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <p>
          {t('Richte zuerst deinen Laden ein.')}{' '}
          <Link to="/shop-setup" className="font-semibold underline underline-offset-4">
            {t('Laden einrichten')}
          </Link>
        </p>
      </div>
    );
  }

  const schluessel = stand?.schluessel ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Schnittstelle (API)')}</h1>
        <p className="text-lg text-muted-foreground">
          {t('Verbinde Dranzeit mit deinen eigenen Programmen, zum Beispiel deiner Webseite oder deiner Kasse: Kunden anlegen, Leistungen auslesen, freie Zeiten abfragen, Termine buchen, verschieben und absagen.')}
        </p>
        <p>
          <a href={API_BESCHREIBUNG} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">
            {t('Beschreibung für Entwickler öffnen')}
          </a>
        </p>
      </header>

      {!stand?.tarif ? (
        <section className="flex flex-col items-start gap-3 rounded-3xl border border-border bg-card p-6">
          <p>{t('Die Schnittstelle gibt es ab dem Tarif Solo.')}</p>
          <Button asChild variant="outline">
            <Link to="/tarif">{t('Zum Tarif')}</Link>
          </Button>
        </section>
      ) : (
        <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6" aria-labelledby="neuer-schluessel">
          <h2 id="neuer-schluessel" className="font-display text-2xl font-extrabold">
            {t('Neuer Schlüssel')}
          </h2>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              anlegen();
            }}
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="schluessel-name">{t('Wofür ist er?')}</Label>
              <Input id="schluessel-name" value={name} maxLength={60} placeholder={t('z. B. Webseite')} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" variant="signal" disabled={busy !== ''}>
              {busy === 'anlegen' ? t('Wird erzeugt …') : t('Schlüssel erzeugen')}
            </Button>
          </form>
          {neu && (
            <div role="status" className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-signal bg-signal/10 p-4">
              <p className="font-semibold">{t('Dein Schlüssel „{name}“ – kopier ihn jetzt. Dranzeit zeigt ihn nur dieses eine Mal.', { name: neu.name })}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-xl bg-background px-3 py-2 font-mono text-sm">{neu.schluessel}</code>
                <Button variant="outline" onClick={() => kopieren(neu.schluessel)}>
                  <Copy className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('Kopieren')}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('Gib ihn nur an Programme auf einem Server, nie in eine Webseite oder App, die Kunden öffnen: Wer ihn hat, kann für deinen Laden buchen und Kundendaten lesen.')}
              </p>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="schluessel-liste">
        <h2 id="schluessel-liste" className="font-display text-2xl font-extrabold">
          {t('Deine Schlüssel')}
        </h2>
        {schluessel.length === 0 ? (
          <p className="text-muted-foreground">{t('Noch keine Schlüssel.')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {schluessel.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <KeyRound className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold">{s.name}</span>
                    <span className="break-all font-mono text-sm text-muted-foreground">{s.anfang}…</span>
                    <span className="text-sm text-muted-foreground">
                      {t('Angelegt am {datum}.', { datum: datum(s.angelegt) })}{' '}
                      {s.zuletzt_benutzt ? t('Zuletzt benutzt am {datum}.', { datum: datum(s.zuletzt_benutzt) }) : t('Noch nicht benutzt.')}
                    </span>
                  </div>
                </div>
                {fragen === s.id ? (
                  <div className="flex gap-2">
                    <Button variant="destructive" disabled={busy !== ''} onClick={() => widerrufen(s.id)}>
                      {busy === s.id ? t('Wird widerrufen …') : t('Ja, widerrufen')}
                    </Button>
                    <Button variant="outline" onClick={() => setFragen('')}>
                      {t('Abbrechen')}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setFragen(s.id)}>
                    {t('Widerrufen')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
