import { InputHTMLAttributes, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Globe, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { StepIndicator } from '../components/StepIndicator';
import { QueueOption } from '../components/queue/QueueStepShell';
import { OpeningHoursEditor } from '../components/OpeningHoursEditor';
import { PlaceSearch } from '../components/setup/PlaceSearch';
import { ServicePicker } from '../components/setup/ServicePicker';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { HilfeLink } from '../components/HilfeLink';
import { INDUSTRIES, getIndustryById } from '../utils/industries';
import { getUserProfile } from '../utils/user-profile-service';
import { isEmail } from '../utils/auth-helpers';
import { DAY_SHORT, formatDayHours, hoursProblem, normalizeHours, WEEK_ORDER } from '../utils/opening-hours';
import {
  applyPlace,
  assignmentOf,
  clearDraft,
  createFromDraft,
  effectiveAssignment,
  emptyDraft,
  loadDraft,
  mergeWebsiteServices,
  newKey,
  peopleOf,
  saveDraft,
  setupStatus,
  SetupResult,
  ShopDraft,
  unassignedServices,
  websiteServices,
  withTemplates,
} from '../utils/shop-setup';
import { entwurfAus, offeneUebernahme, verbindeSeite, Verbindung, vergissUebernahme } from '../utils/uebernahme';
import type { ShopSetupStatusData } from '../brain/data-contracts';
import { intlSprache, merke, t, tn, tTeile } from '@/i18n';

/**
 * Laden einrichten – eine Frage pro Bildschirm, wie bei einer Steuer-App:
 * Laden finden (Google) → prüfen → Branche → Öffnungszeiten → Leistungen (Webseite + Vorlagen)
 * → selbst mitarbeiten? → Team → wer macht was → wer arbeitet wann → Zusammenfassung → fertig.
 * Fragen, die nichts ändern (z. B. "Kann jeder alles?" bei nur einer Person), werden übersprungen.
 * Kommt der Laden von seiner Seite im Salon-Verzeichnis (/uebernehmen), ist alles vorausgefüllt und es geht bei
 * „Stimmt das so?“ los; nach dem Anlegen wird die Seite verbunden (utils/uebernahme.ts).
 */

type Step = 'find' | 'check' | 'industry' | 'hours' | 'services' | 'owner' | 'team' | 'skills' | 'staffHours' | 'summary';
const ORDER: Step[] = ['find', 'check', 'industry', 'hours', 'services', 'owner', 'team', 'skills', 'staffHours', 'summary'];
const GROUPS: { label: string; steps: Step[] }[] = [
  { label: merke('Laden'), steps: ['find', 'check', 'industry'] },
  { label: merke('Zeiten'), steps: ['hours'] },
  { label: merke('Leistungen'), steps: ['services'] },
  { label: merke('Team'), steps: ['owner', 'team', 'skills', 'staffHours'] },
  { label: merke('Fertig'), steps: ['summary'] },
];

const host = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** "28 €" bzw. "ab 28 €" */
const preisText = (s: { price: number; priceFrom?: boolean }) => {
  const preis = s.price.toLocaleString(intlSprache());
  return s.priceFrom ? t('ab {preis} €', { preis }) : t('{preis} €', { preis });
};

const Problem = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
    {children}
  </p>
);

const Field = ({ id, label, hint, ...props }: { id: string; label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} className="h-12 text-base" {...props} />
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const Chip = ({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) => (
  <button
    type="button"
    aria-pressed={on}
    aria-label={label}
    onClick={onClick}
    className={cn(
      'min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors',
      on ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:border-foreground',
    )}
  >
    {children}
  </button>
);

const ShopSetup = () => {
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  const [draft, setDraft] = useState<ShopDraft | null>(null);
  const [status, setStatus] = useState<ShopSetupStatusData>({ google: false, ai: false });
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState('');
  const [website, setWebsite] = useState<{ state: 'idle' | 'reading' | 'done' | 'failed'; text?: string }>({ state: 'idle' });
  const [creating, setCreating] = useState('');
  const [result, setResult] = useState<SetupResult | null>(null);
  const [seite, setSeite] = useState<Verbindung | null>(null);
  const busy = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  // Start: Profil prüfen, Entwurf fortsetzen oder neu beginnen
  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login?next=/shop-setup');
      return;
    }
    let cancelled = false;
    (async () => {
      const [profile, st] = await Promise.all([getUserProfile(user.uid), setupStatus()]);
      if (cancelled) return;
      if (!profile || profile.role !== 'shopOwner') {
        navigate(profile ? '/' : '/role-selection');
        return;
      }
      setStatus(st);
      const fallbackName = profile.displayName || user.displayName || '';
      const saved = loadDraft(user.uid);
      const offen = offeneUebernahme();
      if (offen && saved?.verzeichnis?.eintragId === offen.eintrag.id) {
        // dieselbe Seite: weitermachen, einen später eingegebenen Code mitnehmen
        setDraft({ ...saved, verzeichnis: { ...saved.verzeichnis, code: offen.code || saved.verzeichnis.code } });
      } else if (offen && !saved?.progress?.shopId) {
        // Seite aus dem Verzeichnis übernehmen; ein angefangener Entwurf ohne angelegten Laden weicht
        setDraft(entwurfAus(offen, user.email || '', fallbackName));
        setQuery(offen.eintrag.name);
        return;
      } else {
        setDraft(saved ?? emptyDraft(user.email || '', fallbackName));
      }
      if (saved?.name) setQuery(saved.name);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user && draft && !result) saveDraft(user.uid, draft);
  }, [user, draft, result]);

  const people = useMemo(() => (draft ? peopleOf(draft) : []), [draft]);
  const chosenServices = useMemo(() => (draft ? draft.services.filter((s) => s.selected && s.name.trim()) : []), [draft]);

  const applies = (step: Step, d: ShopDraft): boolean => {
    const persons = peopleOf(d).length;
    if (step === 'skills') return persons > 1 && d.services.filter((s) => s.selected).length > 1;
    if (step === 'staffHours') return persons > 1;
    return true;
  };

  const go = (step: Step, d: ShopDraft = draft!) => {
    setProblem('');
    setDraft({ ...d, step });
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const next = (d: ShopDraft = draft!) => {
    const i = ORDER.indexOf(d.step as Step);
    const following = ORDER.slice(i + 1).find((s) => applies(s, d)) ?? 'summary';
    go(following, d);
  };
  const back = () => {
    const i = ORDER.indexOf(draft!.step as Step);
    const previous = [...ORDER.slice(0, i)].reverse().find((s) => applies(s, draft!));
    if (previous) go(previous);
  };
  const patch = (p: Partial<ShopDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  // Leistungen: Vorlagen der Branche bereitlegen, Webseite einmal automatisch lesen
  const step = (draft?.step as Step) || 'find';
  useEffect(() => {
    if (!draft || step !== 'services') return;
    // Vorlagen zur aktuellen Branche: beim ersten Mal und nach einem Branchenwechsel
    if (!draft.services.some((s) => s.source === 'template') || draft.templateIndustry !== draft.industry) {
      patch({ services: withTemplates(draft.services, draft.industry), templateIndustry: draft.industry });
    }
    if (status.ai && draft.website && draft.websiteRead !== draft.website && website.state !== 'reading') readWebsite(draft.website);
    const vonSeite = draft.services.filter((s) => s.source === 'website').length;
    if (draft.source === 'verzeichnis' && vonSeite && website.state === 'idle') {
      setWebsite({
        state: 'done',
        text: tn(vonSeite, '{n} Leistung von deiner Seite übernommen. Prüf kurz die Dauer, sie ist geschätzt.', '{n} Leistungen von deiner Seite übernommen. Prüf kurz die Dauer, sie ist geschätzt.'),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, status.ai]);

  const readWebsite = async (url: string) => {
    setWebsite({ state: 'reading' });
    patch({ websiteRead: url });
    try {
      const found = await websiteServices(url, draft?.industry);
      setDraft((d) => (d ? { ...d, services: mergeWebsiteServices(d.services, found.services) } : d));
      setWebsite({
        state: 'done',
        text: found.services.length
          ? tn(
              found.services.length,
              '{n} Leistung von {seite} übernommen. Prüf kurz Dauer und Preis.',
              '{n} Leistungen von {seite} übernommen. Prüf kurz Dauer und Preis.',
              { seite: host(url) },
            )
          : t('Auf {seite} habe ich keine Preisliste gefunden. Nimm die Vorschläge unten oder trag selbst ein.', { seite: host(url) }),
      });
    } catch (e) {
      setWebsite({ state: 'failed', text: (e as Error).message });
    }
  };

  if (loading || !user || !draft) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-10 sm:px-6" aria-busy="true" aria-label={t('Wird geladen')}>
        <div className="h-10 w-56 animate-pulse rounded-2xl bg-muted" />
        <div className="h-80 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }

  const industryName = getIndustryById(draft.industry)?.name;

  // --- Fertig ------------------------------------------------------------------------------------
  if (result) {
    const { shop, invitations } = result;
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Fertig')}</p>
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('{name} ist startklar.', { name: shop.name })}</h1>
          <p className="text-muted-foreground">{t('Ab jetzt können Kunden eine Nummer ziehen und Termine buchen. Alles lässt sich später unter „Mein Laden“, „Leistungen“ und „Team“ ändern.')}</p>
          <p className="text-muted-foreground">
            {tTeile('Am Tresen zeigt dir eine kurze Liste, was als Nächstes kommt: einmal selbst ausprobieren, Plakat aufhängen, fertig. <hilfe>Anleitung</hilfe>', {
              hilfe: (inhalt) => <HilfeLink hilfe="in-10-minuten-startklar">{inhalt}</HilfeLink>,
            })}
          </p>
        </div>
        {seite && (
          <SeiteBox
            seite={seite}
            onRetry={draft.verzeichnis ? async () => setSeite(await verbindeSeite(draft.verzeichnis!, shop.id)) : undefined}
          />
        )}
        {invitations.length > 0 && (
          <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 sm:p-6" aria-labelledby="einladungen">
            <h2 id="einladungen" className="font-display text-xl font-bold">{t('Einladungen fürs Team')}</h2>
            <p className="text-sm text-muted-foreground">
              {invitations.every((inv) => inv.emailSent)
                ? t('Jede Person hat ihren Einladungslink per E-Mail bekommen.')
                : t('Wer keine E-Mail bekommen hat, dem schick den Link selbst, z. B. per WhatsApp.')}{' '}
              {t('Damit legt die Person ihr Konto an und sieht ihren eigenen Tag. Die Links gelten 14 Tage, neue erstellst du unter „Team“ bei „Bearbeiten“.')}
            </p>
            <ul className="flex flex-col gap-2">
              {invitations.map((inv) => (
                <li key={`${inv.name}-${inv.email}`} className="flex flex-col gap-3 rounded-2xl border border-border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{inv.name}</span>
                    <span className="truncate text-sm text-muted-foreground">{inv.email}</span>
                    {inv.emailSent ? (
                      <span className="flex items-center gap-1 text-sm font-medium">
                        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {t('E-Mail verschickt')}
                      </span>
                    ) : (
                      inv.link && <span className="text-sm text-destructive">{inv.emailProblem || t('Keine E-Mail verschickt.')} {t('Schick den Link selbst.')}</span>
                    )}
                  </span>
                  {inv.link ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start sm:self-auto"
                      onClick={() => navigator.clipboard.writeText(inv.link).then(() => toast.success(t('Link kopiert.')), () => toast.error(t('Kopieren ging nicht.')))}
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      {t('Link kopieren')}
                    </Button>
                  ) : (
                    <span className="text-sm text-destructive sm:max-w-[12rem] sm:text-end">{t('Link fehlt. Unter „Team“ bei „Bearbeiten“ erstellen.')}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <QRCodeDisplay shopId={shop.id} shopName={shop.name} />
        <Button variant="signal" size="lg" className="self-start" onClick={() => navigate(`/shop-dashboard?shopId=${shop.id}`)}>
          {t('Zum Tresen')}
        </Button>
      </div>
    );
  }

  // --- Schritte ------------------------------------------------------------------------------------
  const finish = async () => {
    if (busy.current) return; // Doppelklick
    busy.current = true;
    setProblem('');
    let started = Boolean(draft.progress?.shopId);
    try {
      const res = await createFromDraft(user.uid, draft, setCreating, (progress) => {
        started = true;
        setDraft((d) => (d ? { ...d, progress } : d)); // landet über saveDraft auch im Browser
      });
      clearDraft(user.uid);
      if (draft.verzeichnis) {
        setCreating(t('Seite verbinden …'));
        setSeite(await verbindeSeite(draft.verzeichnis, res.shop.id)); // wirft nicht; Fehler zeigt die Fertig-Seite
      }
      setResult(res);
      window.scrollTo({ top: 0 });
    } catch (e) {
      console.error('Laden einrichten fehlgeschlagen:', e);
      setProblem(
        started
          ? t('Ein Teil ist schon gespeichert, der Rest noch nicht. Prüf dein Internet und tipp auf „Weiter anlegen“ – es entsteht kein zweiter Laden.')
          : t('Das Speichern hat nicht geklappt. Prüf dein Internet und versuch es noch einmal.'),
      );
    } finally {
      setCreating('');
      busy.current = false;
    }
  };

  let title = '';
  let intro: ReactNode = null;
  let body: ReactNode = null;
  let primary: { label: string; onClick: () => void; disabled?: boolean } | null = { label: t('Weiter'), onClick: () => next() };

  switch (step) {
    case 'find': {
      title = t('Wie heißt dein Laden?');
      intro = status.google
        ? t('Tipp den Namen und den Ort und wähl deinen Laden aus der Liste. Dann übernehme ich Adresse, Telefon, Webseite und Öffnungszeiten von Google. Nicht dabei? Einfach „Weiter“.')
        : t('Wie er draußen am Schild steht.');
      body = status.google ? (
        <div className="flex flex-col gap-4">
          <PlaceSearch
            query={query}
            onQueryChange={setQuery}
            onPicked={(place) => {
              if (place.closedPermanently) toast.warning(t('Google führt diesen Laden als dauerhaft geschlossen. Prüf die Angaben.'));
              next({ ...applyPlace(draft, place), step: 'find' });
            }}
          />
          <Button
            variant="ghost"
            className="h-auto min-h-11 self-start whitespace-normal text-start"
            onClick={() => next({ ...draft, source: 'manual', name: query.trim() || draft.name, step: 'find' })}
          >
            {t('Nicht bei Google? Selbst eintragen')}
          </Button>
        </div>
      ) : (
        <Field id="laden-name" label={t('Name des Ladens')} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      );
      // Auch mit Google-Suche ein „Weiter“: wer keinen Vorschlag antippt, trägt selbst ein
      primary = {
        label: t('Weiter'),
        disabled: !query.trim(),
        onClick: () => next({ ...draft, source: 'manual', name: query.trim(), step: 'find' }),
      };
      break;
    }
    case 'check': {
      title = t('Stimmt das so?');
      intro =
        draft.source === 'google'
          ? t('Von Google übernommen. Du kannst alles ändern.')
          : draft.source === 'verzeichnis'
            ? t('Von deiner Seite auf Dranzeit übernommen. Du kannst alles ändern.')
            : t('So finden dich deine Kunden. Nur der Name und die E-Mail sind Pflicht.');
      body = (
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <Field id="name" label={t('Name des Ladens')} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="sm:col-span-6">
            <Field id="strasse" label={t('Straße und Hausnummer')} autoComplete="street-address" value={draft.street} onChange={(e) => patch({ street: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Field id="plz" label={t('PLZ')} inputMode="numeric" autoComplete="postal-code" value={draft.postalCode} onChange={(e) => patch({ postalCode: e.target.value })} />
          </div>
          <div className="sm:col-span-4">
            <Field id="ort" label={t('Ort')} autoComplete="address-level2" hint={t('Mit Adresse findet man dich auf der Karte.')} value={draft.city} onChange={(e) => patch({ city: e.target.value })} />
          </div>
          <div className="sm:col-span-3">
            <Field id="telefon" label={t('Telefon')} type="tel" dir="ltr" autoComplete="tel" value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} />
          </div>
          <div className="sm:col-span-3">
            <Field id="email" label={t('E-Mail')} type="email" dir="ltr" autoComplete="email" value={draft.email} onChange={(e) => patch({ email: e.target.value })} />
          </div>
          <div className="sm:col-span-6">
            <Field
              id="webseite"
              label={t('Webseite')}
              type="url"
              inputMode="url"
              dir="ltr"
              placeholder={t('www.dein-laden.de')}
              hint={status.ai ? t('Steht hier eine Webseite, liest eine KI gleich deine Preisliste aus. Du prüfst die Vorschläge.') : undefined}
              value={draft.website}
              onChange={(e) => patch({ website: e.target.value })}
            />
          </div>
          {draft.source === 'verzeichnis' && (
            <Button
              variant="ghost"
              className="h-auto min-h-11 self-start whitespace-normal text-start sm:col-span-6"
              onClick={() => {
                vergissUebernahme();
                setQuery('');
                setDraft(emptyDraft(draft.email, draft.ownerName));
              }}
            >
              {t('Nicht dein Salon? Leer anfangen')}
            </Button>
          )}
        </div>
      );
      primary = {
        label: t('Ja, weiter'),
        onClick: () => {
          if (!draft.name.trim()) return setProblem(t('Wie heißt dein Laden?'));
          if (!isEmail(draft.email)) return setProblem(t('Bitte eine gültige E-Mail eintragen.'));
          next();
        },
      };
      break;
    }
    case 'industry': {
      title = t('Was für ein Laden ist das?');
      intro =
        draft.industryGuessed && industryName
          ? draft.source === 'verzeichnis'
            ? t('Laut deiner Seite: {branche}. Stimmt das?', { branche: industryName })
            : t('Laut Google: {branche}. Stimmt das?', { branche: industryName })
          : t('Danach richten sich die Vorschläge für deine Leistungen.');
      body = (
        <div className="flex flex-col gap-2">
          {INDUSTRIES.map((i) => (
            <QueueOption
              key={i.id}
              selected={draft.industry === i.id}
              title={i.name}
              meta={i.description}
              onClick={() => next({ ...draft, industry: i.id, industryGuessed: false, industryConfirmed: true })}
            />
          ))}
          {/* Vorlagen tauscht der Schritt "Leistungen" bei einem Wechsel selbst aus; eigene Anpassungen bleiben */}
          <QueueOption
            selected={draft.industryConfirmed && draft.industry === ''}
            title={t('Etwas anderes')}
            meta={t('Du trägst deine Leistungen selbst ein')}
            onClick={() => next({ ...draft, industry: '', industryGuessed: false, industryConfirmed: true })}
          />
        </div>
      );
      primary = null;
      break;
    }
    case 'hours': {
      title = t('Wann hast du geöffnet?');
      intro = !draft.hoursFromGoogle
        ? t('Tipp eine Vorlage an und pass sie an. Machst du mittags zu, trag eine Pause ein.')
        : draft.source === 'verzeichnis'
          ? t('So steht es auf deiner Seite. Mittagspausen gelten für alle – in der Zeit bucht niemand.')
          : t('So steht es bei Google. Mittagspausen gelten für alle – in der Zeit bucht niemand.');
      body = <OpeningHoursEditor value={draft.hours} onChange={(hours) => patch({ hours })} presets={!draft.hoursFromGoogle} />;
      primary = {
        label: t('Weiter'),
        onClick: () => {
          const p = hoursProblem(normalizeHours(draft.hours));
          if (p) return setProblem(p);
          next();
        },
      };
      break;
    }
    case 'services': {
      title = t('Was bietest du an?');
      intro = t('Tipp an, was man bei dir buchen kann. Dauer und Preis änderst du direkt.');
      body = (
        <div className="flex flex-col gap-5">
          {status.ai && (
            <WebsiteBox
              website={draft.website}
              state={website}
              onRead={(url) => {
                patch({ website: url });
                readWebsite(url);
              }}
            />
          )}
          <ServicePicker
            services={draft.services}
            onChange={(services) => patch({ services })}
            templateTitle={industryName ? t('Typisch für {branche}', { branche: industryName }) : t('Vorschläge')}
          />
        </div>
      );
      primary = {
        label: t('Weiter'),
        disabled: website.state === 'reading',
        onClick: () => {
          const selected = draft.services.filter((s) => s.selected);
          if (selected.length === 0) return setProblem(t('Wähl mindestens eine Leistung aus – sonst kann niemand buchen.'));
          if (selected.some((s) => !s.name.trim())) return setProblem(t('Eine Leistung hat noch keinen Namen.'));
          if (selected.some((s) => !(s.duration >= 5))) return setProblem(t('Jede Leistung braucht eine Dauer von mindestens 5 Minuten.'));
          next();
        },
      };
      break;
    }
    case 'owner': {
      title = t('Nimmst du selbst Kundschaft an?');
      intro = t('Dann bekommst du eigene Termine und eine eigene Schlange am Tresen.');
      body = (
        <div className="flex flex-col gap-2">
          <QueueOption selected={draft.ownerWorks === true} title={t('Ja, ich arbeite selbst mit')} onClick={() => next({ ...draft, ownerWorks: true })} />
          <QueueOption selected={draft.ownerWorks === false} title={t('Nein, nur mein Team')} onClick={() => next({ ...draft, ownerWorks: false })} />
        </div>
      );
      primary = null;
      break;
    }
    case 'team': {
      title = draft.ownerWorks ? t('Wer arbeitet noch mit?') : t('Wer arbeitet bei dir?');
      intro = t('Der Vorname reicht. Mit E-Mail bekommt die Person beim Eröffnen automatisch eine Einladung für ihren eigenen Tagesplan.');
      const setPerson = (key: string, p: Partial<{ name: string; email: string }>) =>
        patch({ team: draft.team.map((person) => (person.key === key ? { ...person, ...p } : person)) });
      body = (
        <div className="flex flex-col gap-3">
          {draft.ownerWorks && (
            <div className="rounded-2xl border border-foreground bg-background p-3">
              <Field id="ich" label={t('Du – so sehen Kunden dich')} placeholder={t('Dein Vorname')} value={draft.ownerName} onChange={(e) => patch({ ownerName: e.target.value })} />
            </div>
          )}
          {draft.team.map((person, i) => (
            <div key={person.key} className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Field id={`name-${person.key}`} label={t('Name')} autoFocus={!person.name && i === draft.team.length - 1} value={person.name} onChange={(e) => setPerson(person.key, { name: e.target.value })} />
              </div>
              <div className="flex-1">
                <Field id={`mail-${person.key}`} label={t('E-Mail (freiwillig)')} type="email" dir="ltr" value={person.email} onChange={(e) => setPerson(person.key, { email: e.target.value })} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="self-end"
                onClick={() => patch({ team: draft.team.filter((x) => x.key !== person.key) })}
                aria-label={t('{name} entfernen', { name: person.name || t('Person') })}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button variant="outline" className="self-start" onClick={() => patch({ team: [...draft.team, { key: newKey('p'), name: '', email: '' }] })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('Person hinzufügen')}
          </Button>
        </div>
      );
      const others = draft.team.filter((person) => person.name.trim());
      primary = {
        label: draft.ownerWorks && others.length === 0 ? t('Nur ich, weiter') : t('Weiter'),
        onClick: async () => {
          if (draft.ownerWorks && !draft.ownerName.trim()) return setProblem(t('Wie sollen Kunden dich sehen? Trag deinen Vornamen ein.'));
          if (draft.team.some((person) => !person.name.trim() && person.email.trim())) return setProblem(t('Bei einer Person fehlt der Name.'));
          if (peopleOf(draft).length === 0) return setProblem(t('Mindestens eine Person muss Termine annehmen – sonst gibt es keine freien Zeiten.'));
          const bad = others.find((person) => person.email.trim() && !isEmail(person.email));
          if (bad) return setProblem(t('Die E-Mail von {name} stimmt nicht.', { name: bad.name }));
          const emails = others.map((person) => person.email.trim().toLowerCase()).filter(Boolean);
          if (new Set(emails).size !== emails.length || (draft.ownerWorks && emails.includes(draft.email.trim().toLowerCase()))) {
            return setProblem(t('Jede E-Mail darf nur einmal vorkommen.'));
          }
          // Hat jemand schon ein Konto (z. B. als Kunde), meldet er sich beim Einladungslink damit an – kein Hindernis
          next({ ...draft, team: draft.team.filter((person) => person.name.trim()) });
        },
      };
      break;
    }
    case 'skills': {
      title = t('Kann jeder alles?');
      intro = t('Bei der Buchung sieht der Kunde dann nur, wer die gewählte Leistung auch macht.');
      const toggle = (personKey: string, serviceKey: string) => {
        const a = assignmentOf(draft, personKey);
        const current = a.serviceKeys.length ? a.serviceKeys : chosenServices.map((s) => s.key);
        const serviceKeys = current.includes(serviceKey) ? current.filter((k) => k !== serviceKey) : [...current, serviceKey];
        // leer hieße "alle" – also die letzte Leistung nicht abwählen lassen
        if (serviceKeys.length === 0) return setProblem(t('Jede Person braucht mindestens eine Leistung.'));
        setProblem('');
        patch({ assignments: { ...draft.assignments, [personKey]: { ...a, serviceKeys } } });
      };
      body = (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <QueueOption selected={draft.everyoneDoesAll === true} title={t('Ja, jeder macht alle Leistungen')} onClick={() => next({ ...draft, everyoneDoesAll: true })} />
            <QueueOption selected={draft.everyoneDoesAll === false} title={t('Nein, das ist verteilt')} onClick={() => patch({ everyoneDoesAll: false })} />
          </div>
          {draft.everyoneDoesAll === false &&
            people.map((p) => {
              const a = assignmentOf(draft, p.key);
              const picked = a.serviceKeys.length ? a.serviceKeys : chosenServices.map((s) => s.key);
              return (
                <fieldset key={p.key} className="flex flex-col gap-2 rounded-2xl border border-border bg-background p-3">
                  <legend className="px-1 font-semibold">{p.isOwner ? t('{name} (du)', { name: p.name }) : p.name}</legend>
                  <div className="flex flex-wrap gap-2">
                    {chosenServices.map((s) => (
                      <Chip key={s.key} on={picked.includes(s.key)} onClick={() => toggle(p.key, s.key)}>
                        {s.name}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
              );
            })}
        </div>
      );
      primary =
        draft.everyoneDoesAll === false
          ? {
              label: t('Weiter'),
              onClick: () => {
                const empty = people.find((p) => {
                  const keys = assignmentOf(draft, p.key).serviceKeys;
                  return keys.length > 0 && !keys.some((k) => chosenServices.some((s) => s.key === k));
                });
                if (empty) return setProblem(t('{name} braucht mindestens eine Leistung.', { name: empty.name }));
                const orphan = unassignedServices(draft);
                if (orphan.length) return setProblem(t('„{leistung}“ macht noch niemand – sonst kann man es nicht buchen.', { leistung: orphan[0].name }));
                next();
              },
            }
          : null;
      break;
    }
    case 'staffHours': {
      title = t('Arbeiten alle, wenn offen ist?');
      intro = t('Genauere Zeiten und Pausen einzelner Leute stellst du später unter „Team“ ein.');
      const openDays = WEEK_ORDER.filter((d) => normalizeHours(draft.hours)[d].isOpen);
      const toggleDay = (personKey: string, day: number) => {
        const a = assignmentOf(draft, personKey);
        const current = a.days.length ? a.days : openDays;
        const days = current.includes(day) ? current.filter((x) => x !== day) : [...current, day];
        if (days.length === 0) return setProblem(t('Jede Person braucht mindestens einen Arbeitstag.'));
        setProblem('');
        patch({ assignments: { ...draft.assignments, [personKey]: { ...a, days } } });
      };
      body = (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <QueueOption selected={draft.sameHours === true} title={t('Ja, immer zu den Öffnungszeiten')} onClick={() => next({ ...draft, sameHours: true })} />
            <QueueOption selected={draft.sameHours === false} title={t('Nein, an unterschiedlichen Tagen')} onClick={() => patch({ sameHours: false })} />
          </div>
          {draft.sameHours === false &&
            people.map((p) => {
              const a = assignmentOf(draft, p.key);
              const days = a.days.length ? a.days : openDays;
              return (
                <fieldset key={p.key} className="flex flex-col gap-2 rounded-2xl border border-border bg-background p-3">
                  <legend className="px-1 font-semibold">{p.isOwner ? t('{name} (du)', { name: p.name }) : p.name}</legend>
                  <div className="flex flex-wrap gap-2">
                    {openDays.map((d) => (
                      <Chip key={d} on={days.includes(d)} onClick={() => toggleDay(p.key, d)} label={t('{name} arbeitet {tag}', { name: p.name, tag: DAY_SHORT[d] })}>
                        {DAY_SHORT[d]}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
              );
            })}
        </div>
      );
      primary =
        draft.sameHours === false
          ? {
              label: t('Weiter'),
              onClick: () => {
                const none = people.find((p) => {
                  const days = assignmentOf(draft, p.key).days;
                  return days.length > 0 && !days.some((d) => openDays.includes(d));
                });
                if (none) return setProblem(t('{name} braucht mindestens einen Arbeitstag.', { name: none.name }));
                next();
              },
            }
          : null;
      break;
    }
    case 'summary': {
      title = t('Alles bereit?');
      intro = draft.progress?.shopId
        ? t('Ein Teil ist schon gespeichert. „Weiter anlegen“ ergänzt den Rest – ohne zweiten Laden.')
        : t('Prüf kurz. Mit „Laden eröffnen“ wird alles angelegt.');
      const hours = normalizeHours(draft.hours);
      const Section = ({ label, to, children }: { label: string; to: Step; children: ReactNode }) => (
        <section className="flex flex-col gap-2 rounded-2xl border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</h3>
            <Button variant="ghost" size="sm" onClick={() => go(to)} disabled={Boolean(creating)}>
              {t('Ändern')}
            </Button>
          </div>
          {children}
        </section>
      );
      body = (
        <div className="flex flex-col gap-3">
          <Section label={t('Laden')} to="check">
            <p className="font-semibold">{draft.name}</p>
            <p className="text-sm text-muted-foreground">
              {[draft.street, [draft.postalCode, draft.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || t('ohne Adresse')}
              {industryName ? ` · ${industryName}` : ''}
            </p>
          </Section>
          <Section label={t('Öffnungszeiten')} to="hours">
            <dl className="grid grid-cols-[3rem_1fr] gap-x-3 gap-y-1 text-sm">
              {WEEK_ORDER.map((d) => (
                <div key={d} className="contents">
                  <dt className="text-muted-foreground">{DAY_SHORT[d]}</dt>
                  <dd className="font-mono">{formatDayHours(hours[d])}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section label={tn(chosenServices.length, '{n} Leistung', '{n} Leistungen')} to="services">
            <ul className="flex flex-col gap-1 text-sm">
              {chosenServices.map((s) => (
                <li key={s.key} className="flex justify-between gap-3">
                  <span>{s.name}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {t('{dauer} Min.', { dauer: s.duration })} · {s.price ? preisText(s) : '–'}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section label={t('Team')} to="team">
            <ul className="flex flex-col gap-1 text-sm">
              {people.map((p) => {
                const a = effectiveAssignment(draft, p.key);
                const openDays = WEEK_ORDER.filter((d) => hours[d].isOpen);
                const detail = [
                  a.serviceKeys.length < chosenServices.length
                    ? tn(chosenServices.length, '{anzahl} von {n} Leistung', '{anzahl} von {n} Leistungen', { anzahl: a.serviceKeys.length })
                    : '',
                  a.days.length < openDays.length ? WEEK_ORDER.filter((d) => a.days.includes(d)).map((d) => DAY_SHORT[d]).join(' ') : '',
                ].filter(Boolean).join(' · ');
                return (
                  <li key={p.key} className="flex justify-between gap-3">
                    <span>{p.isOwner ? t('{name} (du)', { name: p.name }) : p.name}</span>
                    <span className="shrink-0 text-muted-foreground">{detail || t('alles, wenn offen ist')}</span>
                  </li>
                );
              })}
            </ul>
            {people.some((p) => !p.isOwner && p.email.trim()) && (
              <p className="text-sm text-muted-foreground">
                {t('Beim Eröffnen geht eine Einladung per E-Mail an {namen}.', {
                  namen: people.filter((p) => !p.isOwner && p.email.trim()).map((p) => p.name).join(', '),
                })}
              </p>
            )}
          </Section>
        </div>
      );
      primary = { label: creating || (draft.progress?.shopId ? t('Weiter anlegen') : t('Laden eröffnen')), disabled: Boolean(creating), onClick: finish };
      break;
    }
  }

  const groupIndex = GROUPS.findIndex((g) => g.steps.includes(step));

  return (
    <div ref={top} className="mx-auto flex max-w-2xl scroll-mt-20 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Laden einrichten')}</p>
        <StepIndicator currentStep={groupIndex + 1} totalSteps={GROUPS.length} labels={GROUPS.map((g) => t(g.label))} />
      </div>
      <section className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 sm:p-7" aria-labelledby="frage">
        <div className="flex flex-col gap-1">
          <h1 id="frage" className="font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
            {title}
          </h1>
          {intro && <p className="text-muted-foreground">{intro}</p>}
        </div>
        {body}
        {problem && <Problem>{problem}</Problem>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {step !== 'find' ? (
            <Button variant="ghost" onClick={back} disabled={Boolean(creating)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('Zurück')}
            </Button>
          ) : (
            <Link to="/shop-dashboard" className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline">
              {t('Später weitermachen')}
            </Link>
          )}
          {primary && (
            <Button variant="signal" size="lg" onClick={primary.onClick} disabled={primary.disabled}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : step === 'summary' ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
              {primary.label}
            </Button>
          )}
        </div>
      </section>
      <p className="text-center text-xs text-muted-foreground">
        {tTeile('Deine Antworten bleiben auf diesem Gerät gespeichert, bis der Laden angelegt ist. Unsicher? <hilfe>Schritt für Schritt erklärt</hilfe>', {
          hilfe: (inhalt) => (
            <HilfeLink hilfe="in-10-minuten-startklar" className="text-xs">
              {inhalt}
            </HilfeLink>
          ),
        })}
      </p>
    </div>
  );
};

/** Fertig-Seite: Was aus der übernommenen Seite im Salon-Verzeichnis geworden ist */
const SeiteBox = ({ seite, onRetry }: { seite: Verbindung; onRetry?: () => Promise<void> }) => {
  const [busy, setBusy] = useState(false);
  const adresse = `dranzeit.de${seite.pfad}`;
  const link = (
    <a href={seite.pfad} target="_blank" rel="noopener" className="font-semibold underline underline-offset-4" dir="ltr">
      {adresse}
    </a>
  );
  return (
    <section className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-5 sm:p-6" aria-labelledby="eigene-seite" role="status">
      <h2 id="eigene-seite" className="font-display text-xl font-bold">
        {seite.stand === 'verbunden' ? t('Deine Seite gehört jetzt zu deinem Laden') : t('Deine Seite im Salon-Verzeichnis')}
      </h2>
      {seite.stand === 'verbunden' && (
        <>
          <p className="text-muted-foreground">
            {tTeile('Auf <seite/> ziehen Kunden ab sofort eine Nummer. Die Adresse bleibt, so finden dich alle, die dich dort schon gesucht haben.', { seite: () => link })}
          </p>
          {seite.gruender && <p className="font-semibold">{t('Du bist Gründer: 3 Monate kostenlos. Danach Laden für 19 € im Monat, wenn du das Abo abschließt.')}</p>}
        </>
      )}
      {seite.stand === 'pruefen' && (
        <p className="text-muted-foreground">
          {tTeile('<seite/> verbinden wir mit deinem Laden, sobald wir kurz geprüft haben, dass es dein Salon ist.', { seite: () => link })}
        </p>
      )}
      {seite.stand === 'fehler' && (
        <>
          <p className="text-muted-foreground">
            {tTeile('<seite/> ist noch nicht verbunden: {grund}', { seite: () => link }, { grund: seite.text })}
          </p>
          {seite.nochmal && onRetry ? (
            <Button
              variant="outline"
              className="self-start"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onRetry().finally(() => setBusy(false));
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t('Noch einmal versuchen')}
            </Button>
          ) : (
            <p className="text-muted-foreground">{t('Wir verbinden sie, sobald wir geprüft haben, dass es dein Salon ist.')}</p>
          )}
        </>
      )}
    </section>
  );
};

/** Preisliste von der Webseite holen: Stand anzeigen, Adresse nachtragen, erneut versuchen */
const WebsiteBox = ({
  website,
  state,
  onRead,
}: {
  website: string;
  state: { state: 'idle' | 'reading' | 'done' | 'failed'; text?: string };
  onRead: (url: string) => void;
}) => {
  const [url, setUrl] = useState(website);
  if (state.state === 'reading') {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-foreground p-4 text-background" role="status">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t('Ich lese die Preisliste auf {seite} …', { seite: host(website || url) })}</p>
          <p className="text-sm text-background/75">{t('Das dauert bis zu einer Minute. Unten kannst du schon Vorschläge ankreuzen.')}</p>
        </div>
      </div>
    );
  }
  if (state.state === 'done') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4" role="status">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm">
          {state.text} <span className="text-muted-foreground">{t('Automatisch per KI ausgelesen – bitte Dauer und Preise prüfen.')}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-foreground/40 bg-background p-4">
      <div className="flex items-start gap-3">
        <Globe className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t('Preisliste von deiner Webseite holen')}</p>
          <p className="text-sm text-muted-foreground">
            {state.state === 'failed' ? state.text : t('Steht deine Preisliste online, liest eine KI Leistungen, Dauer und Preise aus. Prüf die Vorschläge, bevor du weitergehst.')}
          </p>
        </div>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) onRead(url.trim());
        }}
      >
        <label htmlFor="preisliste-url" className="sr-only">
          {t('Adresse deiner Webseite')}
        </label>
        <Input id="preisliste-url" type="text" inputMode="url" dir="ltr" placeholder={t('www.dein-laden.de')} value={url} onChange={(e) => setUrl(e.target.value)} className="h-11 flex-1" />
        <Button type="submit" variant="outline" disabled={!url.trim()}>
          {state.state === 'failed' ? t('Noch einmal') : t('Auslesen')}
        </Button>
      </form>
    </div>
  );
};

export default ShopSetup;
