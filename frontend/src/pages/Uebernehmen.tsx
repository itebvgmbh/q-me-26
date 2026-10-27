import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { auth, useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '../components/auth/AuthShell';
import { getShopsByOwnerId, type Shop } from '../utils/firestore';
import { getFoundersLeft } from '../utils/billing';
import { getUserProfile } from '../utils/user-profile-service';
import {
  codeAnzeigen,
  holeVorschau,
  merkeUebernahme,
  Offen,
  offeneUebernahme,
  pruefeCode,
  verbindeSeite,
  Verbindung,
} from '../utils/uebernahme';
import { t, tn, tTeile } from '@/i18n';
import { inStoreApp } from '../utils/app-shell';

/**
 * Seite übernehmen: Ein Salon aus dem Verzeichnis (/friseur/…) wird Dranzeit-Laden.
 * - Brief mit QR-Code: /uebernehmen#code=ABCDEFGHJK – Seite und Laden werden nach dem Einrichten sofort verbunden
 * - Knopf „Ist das dein Salon?“ auf der Seite: /uebernehmen?eintrag=<id> – vorausgefüllt, verbunden wird nach Prüfung
 * Gemerkt wird die Seite im Browser (utils/uebernahme.ts), damit sie Konto anlegen und Anmelden übersteht;
 * der Einrichtungsassistent (/shop-setup) füllt sich dann damit.
 */

type Rolle = 'gast' | 'laden' | 'anders';

const Rahmen = ({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) => (
  <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-10 sm:py-16">
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Seite übernehmen')}</p>
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{title}</h1>
      {intro && <p className="text-muted-foreground">{intro}</p>}
    </div>
    {children}
  </div>
);

const Karte = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">{children}</div>;

const Haken = ({ children }: { children: ReactNode }) => (
  <li className="flex items-start gap-2">
    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </li>
);

const CodeForm = ({ start, busy, onCode }: { start?: string; busy: boolean; onCode: (code: string) => void }) => {
  const [code, setCode] = useState(start || '');
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (code.trim()) onCode(code.trim());
      }}
    >
      <Label htmlFor="code">{t('Code aus unserem Brief')}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="code"
          dir="ltr"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCDE-FGHJK"
          value={code}
          onChange={(e) => setCode(codeAnzeigen(e.target.value))}
          className="h-12 flex-1 font-mono text-lg tracking-widest"
        />
        <Button type="submit" size="lg" variant="outline" disabled={busy || !code.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {t('Code prüfen')}
        </Button>
      </div>
    </form>
  );
};

const Uebernehmen = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading: userLoading } = useCurrentUser();
  const [offen, setOffen] = useState<Offen | null>(null);
  const [laden, setLaden] = useState(true);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [rolle, setRolle] = useState<Rolle | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [plaetze, setPlaetze] = useState<number | null>(null);
  const [verbunden, setVerbunden] = useState<{ shop: Shop; seite: Verbindung } | null>(null);

  const mitCode = async (code: string) => {
    setBusy(true);
    setFehler('');
    try {
      const res = await pruefeCode(code);
      const neu = { eintrag: res.eintrag, code: res.code };
      merkeUebernahme(neu);
      setOffen(neu);
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setBusy(false);
      setLaden(false);
    }
  };

  // Start: Code aus dem QR-Link (#code=…), sonst Seite aus ?eintrag=, sonst die gemerkte
  useEffect(() => {
    const code = new URLSearchParams(window.location.hash.slice(1)).get('code');
    const eintrag = params.get('eintrag');
    const gemerkt = offeneUebernahme();
    if (code) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search); // Code nicht in Verlauf und Lesezeichen
      mitCode(code);
    } else if (eintrag) {
      holeVorschau(eintrag)
        .then((vorschau) => {
          const neu = { eintrag: vorschau, code: gemerkt?.eintrag.id === vorschau.id ? gemerkt.code : undefined };
          merkeUebernahme(neu);
          setOffen(neu);
        })
        .catch((e: Error) => setFehler(e.message))
        .finally(() => setLaden(false));
    } else {
      setOffen(gemerkt);
      setLaden(false);
    }
    getFoundersLeft().then(setPlaetze);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wer ist angemeldet? Inhaber mit Laden können die Seite mit Code gleich mit einem bestehenden Laden verbinden
  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      setRolle('gast');
      return;
    }
    let cancelled = false;
    getUserProfile(user.uid)
      .then(async (profile) => {
        if (cancelled) return;
        if (profile?.role !== 'shopOwner') return setRolle(profile ? 'anders' : 'gast');
        const list = await getShopsByOwnerId(user.uid).catch(() => [] as Shop[]);
        if (cancelled) return;
        setShops(list);
        setRolle('laden');
      })
      .catch(() => !cancelled && setRolle('gast'));
    return () => {
      cancelled = true;
    };
  }, [user, userLoading]);

  if (laden || rolle === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        <span className="sr-only">{t('Wird geladen')}</span>
      </div>
    );
  }

  if (verbunden) {
    const { shop, seite } = verbunden;
    return (
      <Rahmen
        title={seite.stand === 'verbunden' ? t('Verbunden.') : t('Noch nicht verbunden.')}
        intro={
          seite.stand === 'verbunden'
            ? t('Deine Seite gehört jetzt zu {laden}. Kunden ziehen dort ab sofort eine Nummer.', { laden: shop.name })
            : seite.stand === 'fehler'
              ? seite.text
              : undefined
        }
      >
        <Karte>
          {seite.stand === 'verbunden' && seite.gruender && <p className="font-semibold">{(inStoreApp() ? t('Du bist Gründer: 3 Monate kostenlos.') : t('Du bist Gründer: 3 Monate kostenlos. Danach Laden für 19 € im Monat, wenn du das Abo abschließt.'))}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild size="lg" variant="signal">
              <Link to={`/shop-dashboard?shopId=${shop.id}`}>{t('Zum Tresen')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={seite.pfad}>{t('Seite ansehen')}</a>
            </Button>
          </div>
        </Karte>
      </Rahmen>
    );
  }

  // Ohne Seite: Code eingeben
  if (!offen) {
    return (
      <Rahmen title={t('Deine Seite auf Dranzeit')} intro={t('Gib den Code aus unserem Brief ein. Dann richtest du in ein paar Minuten deinen Laden ein, die Angaben deiner Seite sind schon ausgefüllt.')}>
        <Karte>
          {fehler && <FormError>{fehler}</FormError>}
          <CodeForm busy={busy} onCode={mitCode} />
        </Karte>
      </Rahmen>
    );
  }

  const e = offen.eintrag;
  const adresse = [e.street, [e.postalCode, e.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const offeneTage = (e.businessHoursByDay || []).filter((d) => d.isOpen).length;

  const verbinde = async (shop: Shop) => {
    setBusy(true);
    setFehler('');
    const seite = await verbindeSeite({ eintragId: e.id, pfad: e.pfad, code: offen.code }, shop.id);
    setBusy(false);
    if (seite.stand === 'fehler' && seite.nochmal) return setFehler(seite.text);
    setVerbunden({ shop, seite });
  };

  return (
    <Rahmen
      title={e.name}
      intro={offen.code ? t('Dein Code passt. Richte deinen Laden ein – danach gehört diese Seite dir.') : t('Ist das dein Salon? Richte deinen Laden ein, die Angaben dieser Seite sind schon ausgefüllt.')}
    >
      <Karte>
        <div className="flex flex-col gap-1">
          {adresse && <p className="font-semibold">{adresse}</p>}
          {e.pfad && (
            <a href={e.pfad} className="text-sm underline underline-offset-4" dir="ltr">
              dranzeit.de{e.pfad}
            </a>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{t('Das übernimmst du für deinen Laden:')}</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            <Haken>{t('Name, Adresse und Telefon')}</Haken>
            {offeneTage > 0 && <Haken>{t('Öffnungszeiten')}</Haken>}
            {e.services.length > 0 && <Haken>{tn(e.services.length, '{n} Leistung mit Preis', '{n} Leistungen mit Preisen')}</Haken>}
            <Haken>{t('Die Adresse deiner Seite – wer dich dort schon gefunden hat, zieht künftig gleich eine Nummer')}</Haken>
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">
          {plaetze && !inStoreApp()
            ? tn(plaetze, '30 Tage kostenlos, ohne Zahlungsdaten. Dazu noch {n} Gründerplatz: 3 Monate gratis, danach Laden für 19 € im Monat.', '30 Tage kostenlos, ohne Zahlungsdaten. Dazu noch {n} Gründerplätze: 3 Monate gratis, danach Laden für 19 € im Monat.')
            : t('30 Tage kostenlos, ohne Zahlungsdaten.')}
        </p>
        {fehler && <FormError>{fehler}</FormError>}

        {rolle === 'gast' && (
          <div className="flex flex-col gap-2">
            <Button size="lg" variant="signal" onClick={() => navigate(`/register-shop-owner?next=${encodeURIComponent('/shop-setup')}`)}>
              {t('Konto anlegen und loslegen')}
            </Button>
            <p className="text-sm text-muted-foreground">
              {tTeile('Schon ein Konto? <link>Anmelden</link>', {
                link: (inhalt) => (
                  <Link to={`/login?next=${encodeURIComponent('/uebernehmen')}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                    {inhalt}
                  </Link>
                ),
              })}
            </p>
          </div>
        )}

        {rolle === 'laden' && (
          <div className="flex flex-col gap-2">
            {offen.code && shops.length > 0 && (
              <>
                <p className="text-sm font-semibold">{t('Dein Laden ist schon bei Dranzeit? Dann verbinde die Seite damit:')}</p>
                {shops.map((shop) => (
                  <Button key={shop.id} size="lg" variant="signal" disabled={busy} onClick={() => verbinde(shop)}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {t('Mit {laden} verbinden', { laden: shop.name })}
                  </Button>
                ))}
              </>
            )}
            <Button size="lg" variant={offen.code && shops.length > 0 ? 'outline' : 'signal'} onClick={() => navigate('/shop-setup')}>
              {shops.length > 0 ? t('Neuen Laden einrichten') : t('Laden einrichten')}
            </Button>
          </div>
        )}

        {rolle === 'anders' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{t('Du bist mit einem Kundenkonto angemeldet. Für deinen Laden legst du ein eigenes Konto an.')}</p>
            <Button size="lg" variant="signal" onClick={() => auth.signOut().then(() => navigate(`/register-shop-owner?next=${encodeURIComponent('/shop-setup')}`))}>
              {t('Abmelden und Laden-Konto anlegen')}
            </Button>
          </div>
        )}
      </Karte>

      {!offen.code && (
        <Karte>
          <p className="text-sm text-muted-foreground">
            {t('Ohne Code verbinden wir die Seite mit deinem Laden, sobald wir kurz geprüft haben, dass es dein Salon ist. Hast du einen Brief von uns? Mit dem Code darin geht es sofort.')}
          </p>
          <CodeForm busy={busy} onCode={mitCode} />
        </Karte>
      )}
    </Rahmen>
  );
};

export default Uebernehmen;
