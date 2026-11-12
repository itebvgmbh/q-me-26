import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Globe, Mail, Pencil, Phone, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { KarteiHinweis } from '../components/kartei/KarteiHinweis';
import { deleteCustomer } from '../utils/datenschutz';
import { aendereKunde, ladeKunde, speichereBesuchsnotiz, type KarteiKunde, type KarteiTermin, type KundenAenderung, type KundenSeite } from '../utils/firestore/kartei';
import { abstandEinheit } from '../utils/kartei-logik';
import { useLadenWahl } from '../utils/laden-kontext';
import { LiveFehlt } from '../utils/live';
import { euro } from '../utils/plans';
import { datumsLocale, t, tn } from '@/i18n';

const NOTIZ_MAX = 2000;
const feld = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Kundenseite der Kartei: Kontakt, Kennzahlen, Notiz fürs Team, kommende Termine und der Verlauf mit Preis und
 * Notiz je Besuch (z. B. Farbrezeptur). Notizen sieht nur das Team, nie der Kunde oder der Telefon-Assistent.
 * Backend: backend/app/libs/kartei.py. Löschen wie bisher (backend/app/libs/privacy.py).
 */
export default function Kunde() {
  const { kundeId = '' } = useParams();
  const navigate = useNavigate();
  const { laden: shop, laeden, fehler: ladenFehler, inhaber } = useLadenWahl();
  const shopId = shop?.id ?? '';
  const [seite, setSeite] = useState<KundenSeite | null>(null);
  const [fehler, setFehler] = useState<'weg' | 'fehler' | null>(null);
  const [runde, setRunde] = useState(0);

  useEffect(() => {
    if (!shopId || !kundeId) return;
    let aktiv = true;
    setFehler(null);
    ladeKunde(shopId, kundeId)
      .then((s) => aktiv && setSeite(s))
      .catch((e) => {
        console.error('Kunde nicht geladen:', e);
        if (aktiv) setFehler(e instanceof LiveFehlt ? 'weg' : 'fehler');
      });
    return () => {
      aktiv = false;
    };
  }, [shopId, kundeId, runde]);

  const zurueck = (
    <Link to={`/kunden?shopId=${encodeURIComponent(shopId)}`} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      {t('Alle Kunden')}
    </Link>
  );

  if (laeden === null && !ladenFehler) return <div className="mx-auto max-w-3xl px-4 py-16 text-muted-foreground sm:px-6">{t('Kunde wird geladen …')}</div>;
  if (!shop) return <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">{t('Dein Laden lädt gerade nicht.')}</div>;
  if (fehler) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10 sm:px-6">
        {zurueck}
        <p>{fehler === 'weg' ? t('Diesen Kunden gibt es nicht mehr.') : t('Der Kunde konnte nicht geladen werden. Versuch es gleich noch einmal.')}</p>
        {fehler === 'fehler' && (
          <Button variant="outline" className="w-fit" onClick={() => setRunde((r) => r + 1)}>
            {t('Neu laden')}
          </Button>
        )}
      </div>
    );
  }
  if (!seite) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10 sm:px-6">
        {zurueck}
        <div className="h-48 animate-pulse rounded-3xl bg-muted" aria-busy="true" aria-label={t('Kunde wird geladen …')} />
      </div>
    );
  }

  const { kunde, termine, kennzahlen: z, kartei } = seite;
  const jetzt = Date.now();
  const kommend = termine.filter((a) => a.start && a.start.getTime() > jetzt && (a.status === 'scheduled' || a.status === 'in-progress')).reverse();
  const verlauf = termine.filter((a) => !kommend.includes(a));
  const setKunde = (k: KarteiKunde) => setSeite((s) => (s ? { ...s, kunde: { ...s.kunde, ...k } } : s));
  const setTermin = (id: string, notiz: Partial<KarteiTermin>) =>
    setSeite((s) => (s ? { ...s, termine: s.termine.map((a) => (a.id === id ? { ...a, ...notiz } : a)) } : s));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      {zurueck}
      <Kopf shopId={shopId} kunde={kunde} onGeaendert={setKunde} />

      {kartei && z ? (
        <section aria-labelledby="zahlen" className="flex flex-col gap-3">
          <h2 id="zahlen" className="sr-only">{t('Kennzahlen')}</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kachel label={t('Besuche')} wert={String(z.besuche)} hinweis={z.erster ? t('seit {datum}', { datum: format(z.erster, t('MMM yyyy'), { locale: datumsLocale() }) }) : undefined} />
            <Kachel
              label={t('Zuletzt da')}
              wert={z.zuletzt ? format(z.zuletzt, t('d. MMM'), { locale: datumsLocale() }) : '–'}
              hinweis={z.zuletzt ? vorTagen(z.zuletzt) : t('noch nie da')}
            />
            <Kachel label={t('Kommt etwa')} wert={z.abstandTage ? abstandText(z.abstandTage) : '–'} hinweis={z.abstandTage ? undefined : t('ab 2 Besuchen')} text />
            <Kachel label={t('Umsatz')} wert={euro(z.umsatz)} hinweis={t('laut Preisliste')} />
          </dl>
          {(z.lieblingsLeistung || z.abgesagt > 0 || z.nichtGekommen > 0) && (
            <p className="text-sm text-muted-foreground">
              {[
                z.lieblingsLeistung &&
                  (z.lieblingsPerson ? t('Meist {leistung} bei {person}.', { leistung: z.lieblingsLeistung, person: z.lieblingsPerson }) : t('Meist {leistung}.', { leistung: z.lieblingsLeistung })),
                z.abgesagt > 0 && tn(z.abgesagt, '{n}-mal abgesagt.', '{n}-mal abgesagt.'),
                z.nichtGekommen > 0 && tn(z.nichtGekommen, '{n}-mal nicht gekommen.', '{n}-mal nicht gekommen.'),
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
        </section>
      ) : (
        <KarteiHinweis inhaber={inhaber} />
      )}

      {kartei && <TeamNotiz shopId={shopId} kunde={kunde} onGespeichert={setKunde} />}

      {kommend.length > 0 && (
        <section aria-labelledby="kommend" className="flex flex-col gap-3">
          <h2 id="kommend" className="font-display text-xl font-bold">{t('Kommende Termine')}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-card">
            {kommend.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <TerminZeile termin={a} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="verlauf" className="flex flex-col gap-3">
        <h2 id="verlauf" className="font-display text-xl font-bold">{t('Verlauf')}</h2>
        {verlauf.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Noch keine Termine.')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-card">
            {verlauf.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-4 py-3">
                <TerminZeile termin={a} />
                {kartei && a.status !== 'cancelled' && (
                  <BesuchsNotiz shopId={shopId} kundeId={kunde.id} termin={a} onGespeichert={(n) => setTermin(a.id, n)} />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {t('Hier stehen Termine, die für diesen Kunden eingetragen, mit seinem Konto oder seiner Handynummer gebucht oder am Tresen zugeordnet wurden.')}
        </p>
      </section>

      <Loeschen kunde={kunde} onGeloescht={() => navigate(`/kunden?shopId=${encodeURIComponent(shopId)}`)} />
    </div>
  );
}

const Kachel = ({ label, wert, hinweis, text }: { label: string; wert: string; hinweis?: string; text?: boolean }) => (
  <div className="flex flex-col gap-1 border-t-4 border-foreground pt-3">
    <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
    <dd className={text ? 'font-display text-xl font-bold leading-8' : 'font-mono text-2xl font-bold tabular-nums'}>{wert}</dd>
    {hinweis && <dd className="text-xs text-muted-foreground">{hinweis}</dd>}
  </div>
);

const vorTagen = (d: Date) => {
  const tage = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (tage <= 0) return t('heute');
  if (tage === 1) return t('gestern');
  return tn(tage, 'vor {n} Tag', 'vor {n} Tagen');
};

const abstandText = (tage: number) => {
  const { wert, einheit } = abstandEinheit(tage);
  return einheit === 'wochen' ? tn(wert, 'jede Woche', 'alle {n} Wochen') : tn(wert, 'jeden Tag', 'alle {n} Tage');
};

const statusText = (a: KarteiTermin) =>
  a.noShow
    ? t('Nicht gekommen')
    : a.status === 'cancelled'
      ? t('Abgesagt')
      : a.status === 'in-progress'
        ? t('Ist dran')
        : a.status === 'completed'
          ? t('Fertig')
          : a.start && a.start.getTime() > Date.now()
            ? t('Geplant')
            : '';

function TerminZeile({ termin: a }: { termin: KarteiTermin }) {
  const wer = [a.leistung, a.person && t('bei {name}', { name: a.person })].filter(Boolean).join(' ');
  const status = statusText(a);
  const abgesagt = a.status === 'cancelled';
  return (
    <div className={cn('flex items-start gap-3', abgesagt && 'text-muted-foreground')}>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{a.start ? format(a.start, t('EEE d. MMM yyyy, HH:mm'), { locale: datumsLocale() }) : '–'}</span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {wer || t('Leistung')}
          {a.source === 'telefon' && <Phone className="h-3 w-3" role="img" aria-label={t('Am Telefon gebucht')} />}
          {a.zugeordnet && a.source !== 'telefon' && <Globe className="h-3 w-3" role="img" aria-label={t('Ohne Konto gebucht und zugeordnet')} />}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-end">
        {a.preis > 0 && !abgesagt && <span className="font-mono text-sm font-semibold tabular-nums">{euro(a.preis)}</span>}
        {status && <span className="text-xs font-semibold">{status}</span>}
      </span>
    </div>
  );
}

function Kopf({ shopId, kunde, onGeaendert }: { shopId: string; kunde: KarteiKunde; onGeaendert: (k: KarteiKunde) => void }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [name, setName] = useState(kunde.name);
  const [phone, setPhone] = useState(kunde.phone ?? '');
  const [email, setEmail] = useState(kunde.email ?? '');
  const [busy, setBusy] = useState(false);

  const oeffnen = () => {
    setName(kunde.name);
    setPhone(kunde.phone ?? '');
    setEmail(kunde.email ?? '');
    setBearbeiten(true);
  };

  const speichern = async (e: React.FormEvent) => {
    e.preventDefault();
    // Nur, was sich geändert hat: Ändern zählt sonst als Aktivität und schiebt die Löschfrist hinaus
    const aenderung: KundenAenderung = {};
    if (name.trim() !== kunde.name) aenderung.name = name;
    if (phone.trim() !== (kunde.phone ?? '')) aenderung.phone = phone;
    if (!kunde.userId && email.trim().toLowerCase() !== (kunde.email ?? '')) aenderung.email = email;
    if (!Object.keys(aenderung).length) {
      setBearbeiten(false);
      return;
    }
    setBusy(true);
    try {
      onGeaendert(await aendereKunde(shopId, kunde.id, aenderung));
      setBearbeiten(false);
      toast.success(t('Gespeichert.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Das hat nicht geklappt.'));
    } finally {
      setBusy(false);
    }
  };

  if (bearbeiten) {
    return (
      <form onSubmit={speichern} className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t('Name')}
          <input className={feld} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t('Telefon')}
          <input className={feld} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} type="tel" inputMode="tel" autoComplete="off" dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t('E-Mail')}
          <input
            className={feld}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
            type="email"
            autoComplete="off"
            dir="ltr"
            disabled={Boolean(kunde.userId)}
          />
          {kunde.userId && <span className="text-xs font-normal text-muted-foreground">{t('Gehört zum verbundenen Konto.')}</span>}
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t('Moment …') : t('Speichern')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setBearbeiten(false)} disabled={busy}>
            {t('Abbrechen')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{kunde.name || t('Ohne Namen')}</h1>
        <Button variant="outline" size="sm" onClick={oeffnen}>
          <Pencil className="me-2 h-3.5 w-3.5" aria-hidden="true" />
          {t('Bearbeiten')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {kunde.phone && (
          <a href={`tel:${kunde.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
            <Phone className="h-4 w-4" aria-hidden="true" /> <bdi dir="ltr">{kunde.phone}</bdi>
          </a>
        )}
        {kunde.email && (
          <a href={`mailto:${kunde.email}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
            <Mail className="h-4 w-4" aria-hidden="true" /> <bdi dir="ltr">{kunde.email}</bdi>
          </a>
        )}
      </div>
      <p className="flex flex-wrap gap-2 text-xs font-semibold">
        {kunde.userId && <span className="rounded-full bg-foreground px-2.5 py-0.5 text-background">{t('Konto verbunden')}</span>}
        {kunde.source === 'telefon' && <span className="rounded-full border border-border px-2.5 py-0.5">{t('Vom Telefon-Assistenten angelegt')}</span>}
        {kunde.source === 'online' && <span className="rounded-full border border-border px-2.5 py-0.5">{t('Beim Online-Buchen angelegt')}</span>}
        {kunde.angelegt && (
          <span className="px-1 py-0.5 font-normal text-muted-foreground">
            {t('Angelegt am {datum}', { datum: format(kunde.angelegt, t('d. MMM yyyy'), { locale: datumsLocale() }) })}
          </span>
        )}
      </p>
    </header>
  );
}

function TeamNotiz({ shopId, kunde, onGespeichert }: { shopId: string; kunde: KarteiKunde; onGespeichert: (k: KarteiKunde) => void }) {
  const [text, setText] = useState(kunde.notiz);
  const [busy, setBusy] = useState(false);
  const geaendert = text.trim() !== kunde.notiz.trim();

  useEffect(() => setText(kunde.notiz), [kunde.notiz]);

  const speichern = async () => {
    setBusy(true);
    try {
      onGespeichert(await aendereKunde(shopId, kunde.id, { notiz: text }));
      toast.success(t('Notiz gespeichert.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Das hat nicht geklappt.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="notiz" className="flex flex-col gap-2">
      <h2 id="notiz" className="flex items-center gap-2 font-display text-xl font-bold">
        <StickyNote className="h-5 w-5" aria-hidden="true" />
        {t('Notiz fürs Team')}
      </h2>
      <textarea
        className={cn(feld, 'min-h-24')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={NOTIZ_MAX}
        placeholder={t('z. B. mag es kurz an den Seiten, trinkt gern einen Espresso')}
        aria-describedby="notiz-hinweis"
      />
      <p id="notiz-hinweis" className="text-xs text-muted-foreground">
        {t('Sieht nur dein Team, nie der Kunde. Bitte keine Angaben zur Gesundheit wie Allergien: Dafür bräuchtest du seine ausdrückliche Einwilligung.')}
        {kunde.notizGeaendert && ` ${t('Zuletzt geändert am {datum}.', { datum: format(kunde.notizGeaendert, t('d. MMM yyyy'), { locale: datumsLocale() }) })}`}
      </p>
      {geaendert && (
        <Button className="w-fit" onClick={speichern} disabled={busy}>
          {busy ? t('Moment …') : t('Notiz speichern')}
        </Button>
      )}
    </section>
  );
}

function BesuchsNotiz({
  shopId,
  kundeId,
  termin,
  onGespeichert,
}: {
  shopId: string;
  kundeId: string;
  termin: KarteiTermin;
  onGespeichert: (n: Partial<KarteiTermin>) => void;
}) {
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState(termin.notiz ?? '');
  const [busy, setBusy] = useState(false);

  const speichern = async () => {
    setBusy(true);
    try {
      const n = await speichereBesuchsnotiz(shopId, kundeId, termin.id, text);
      onGespeichert({ notiz: n.text ?? '', notizGeaendert: n.geaendert?.toDate?.() ?? null });
      setOffen(false);
      toast.success(text.trim() ? t('Notiz gespeichert.') : t('Notiz gelöscht.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Das hat nicht geklappt.'));
    } finally {
      setBusy(false);
    }
  };

  if (offen) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          className={cn(feld, 'min-h-20 text-sm')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={NOTIZ_MAX}
          placeholder={t('z. B. Farbe 7/1 + 6 %, 30 Min., Spitzen 2 cm')}
          aria-label={t('Notiz zu diesem Besuch')}
          autoFocus
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={speichern} disabled={busy}>
            {busy ? t('Moment …') : t('Speichern')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setText(termin.notiz ?? '');
              setOffen(false);
            }}
            disabled={busy}
          >
            {t('Abbrechen')}
          </Button>
        </div>
      </div>
    );
  }

  return termin.notiz ? (
    <button
      type="button"
      onClick={() => setOffen(true)}
      className="whitespace-pre-line rounded-xl bg-muted px-3 py-2 text-start text-sm"
    >
      {termin.notiz}
      <span className="sr-only"> – {t('Notiz zu diesem Besuch bearbeiten')}</span>
    </button>
  ) : (
    <button type="button" onClick={() => setOffen(true)} className="w-fit text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground">
      {t('Notiz zum Besuch')}
    </button>
  );
}

function Loeschen({ kunde, onGeloescht }: { kunde: KarteiKunde; onGeloescht: () => void }) {
  const [fragen, setFragen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loeschen = async () => {
    setBusy(true);
    try {
      const { cancelled } = await deleteCustomer(kunde.id);
      toast.success(
        cancelled
          ? tn(cancelled, '{name} gelöscht, {n} kommender Termin abgesagt.', '{name} gelöscht, {n} kommende Termine abgesagt.', { name: kunde.name })
          : t('{name} gelöscht.', { name: kunde.name }),
      );
      onGeloescht();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-6">
      {!fragen ? (
        <Button variant="ghost" className="w-fit text-destructive" onClick={() => setFragen(true)}>
          {t('Kunden löschen')}
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <p className="text-sm font-semibold">
            {kunde.userId
              ? t('{name} verschwindet aus deiner Liste, mit allen Notizen. Die Termine bleiben im Konto.', { name: kunde.name })
              : t('{name} wird mit allen Notizen gelöscht. Kommende Termine werden abgesagt, frühere verlieren den Namen.', { name: kunde.name })}
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" className="flex-1" onClick={loeschen} disabled={busy}>
              {busy ? t('Moment …') : t('Ja, löschen')}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setFragen(false)} disabled={busy}>
              {t('Behalten')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
