import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  STATUS_LABEL,
  TAGE_REIHE,
  TAG_NAME,
  confirmTakeover,
  createByHand,
  deleteEintrag,
  importSalon,
  loadVerzeichnis,
  rejectTakeover,
  saveEintrag,
  searchGoogle,
  setStatus,
  tagAlsText,
  textAlsTag,
  type Eintrag,
  type EintragDaten,
  type EintragStatus,
  type Kategorie,
  type Leistung,
  type Liste,
  type Tag,
  type Treffer,
} from '../../utils/verzeichnis';
import { Fact, Section } from './LadenDetail';
import { fmtDate, fmtDateTime } from './format';

const FILTERS: { id: string; label: string; test: (e: Eintrag) => boolean }[] = [
  { id: 'entwurf', label: 'Entwürfe', test: (e) => !e.shopId && e.status === 'entwurf' },
  { id: 'online', label: 'Online', test: (e) => !e.shopId && e.status === 'online' },
  { id: 'offline', label: 'Offline', test: (e) => !e.shopId && e.status === 'offline' },
  { id: 'entfernt', label: 'Vom Salon entfernt', test: (e) => e.status === 'entfernt' },
  { id: 'laeden', label: 'Dranzeit-Läden', test: (e) => Boolean(e.shopId) },
  { id: 'alle', label: 'Alle', test: () => true },
];

const KATEGORIE_LABEL: Record<Kategorie, string> = { friseur: 'Friseur', barbershop: 'Barbershop' };

const message = (e: unknown) => (e instanceof Error ? e.message : 'Das hat nicht geklappt.');
const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
      active ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-foreground/10',
    )}
  >
    {children}
  </button>
);

const Pill = ({ children, tone }: { children: ReactNode; tone?: 'signal' | 'muted' | 'dark' | 'alarm' }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
      tone === 'signal' && 'bg-signal text-signal-foreground',
      tone === 'dark' && 'bg-foreground text-background',
      tone === 'alarm' && 'bg-destructive text-destructive-foreground',
      (!tone || tone === 'muted') && 'border border-border bg-muted text-muted-foreground',
    )}
  >
    {children}
  </span>
);

const statusTone = (s: EintragStatus) => (s === 'online' ? 'signal' : s === 'entfernt' ? 'alarm' : 'muted');

/** Betreiber-Bereich, Reiter Verzeichnis: Salons ohne Dranzeit finden, anlegen, prüfen, veröffentlichen */
export function Verzeichnis() {
  const [data, setData] = useState<Liste | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('entwurf');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | 'neu' | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadVerzeichnis());
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const entries = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const needle = query.trim().toLowerCase();
    return (data?.eintraege ?? []).filter(
      (e) => f.test(e) && (!needle || [e.name, e.city, e.ortsteil, e.bezirk, e.street, e.website].some((v) => (v || '').toLowerCase().includes(needle))),
    );
  }, [data, filter, query]);

  if (error && !data) return <p className="rounded-3xl bg-destructive p-5 text-destructive-foreground">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Wird geladen …</p>;

  const vorschlaege = data.eintraege.filter((e) => e.vorschlag);
  const current = selected && selected !== 'neu' ? data.eintraege.find((e) => e.id === selected) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {(!data.status.google || !data.status.ai) && (
        <p className="rounded-3xl border border-border bg-card p-4 text-sm">
          {!data.status.google && 'Die Google-Suche ist nicht eingerichtet (GOOGLE_MAPS_API_KEY). '}
          {!data.status.ai && 'Das Auslesen von Webseiten ist nicht eingerichtet (ANTHROPIC_API_KEY). '}
          Anlegen von Hand geht trotzdem.
        </p>
      )}

      {vorschlaege.length > 0 && <Vorschlaege entries={vorschlaege} onChanged={reload} />}

      <Finden status={data.status} onImported={reload} onNew={() => setSelected('neu')} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} {data.eintraege.filter(f.test).length}
            </Chip>
          ))}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-9" placeholder="Name, Ort, Straße" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Einträge durchsuchen" />
          </div>
        </div>
        <EintragTabelle entries={entries} onOpen={setSelected} />
      </section>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-background sm:max-w-2xl">
          <SheetTitle className="sr-only">{current ? `Eintrag ${current.name}` : 'Salon von Hand anlegen'}</SheetTitle>
          <SheetDescription className="sr-only">Angaben prüfen, veröffentlichen oder offline nehmen</SheetDescription>
          {selected === 'neu' && (
            <EintragEditor
              key="neu"
              onSaved={(e) => {
                reload();
                setSelected(e.id);
              }}
              onClose={() => setSelected(null)}
            />
          )}
          {current && <EintragEditor key={current.id} entry={current} onSaved={reload} onClose={() => setSelected(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// --- Übernahme -------------------------------------------------------------------------------------------------------

function Vorschlaege({ entries, onChanged }: { entries: Eintrag[]; onChanged: () => void }) {
  const [busy, setBusy] = useState('');
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-signal p-5 text-signal-foreground">
      <h2 className="font-display text-xl font-bold">Übernahme bestätigen</h2>
      <p className="text-sm">
        Diese Salons haben sich bei Dranzeit angemeldet. Bestätigen heißt: Die Seite im Verzeichnis wird ihre Seite – Adresse und Ranking bleiben,
        ab sofort mit Nummer ziehen.
      </p>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-background/90 p-3 text-foreground">
            <div className="min-w-0">
              <p className="font-semibold">
                {e.name} <span className="font-normal text-muted-foreground">↔ Laden „{e.vorschlag!.name}“</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {[e.street, e.city].filter(Boolean).join(', ')} · {e.vorschlag!.grund}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy !== ''} onClick={() => run(`ok-${e.id}`, () => confirmTakeover(e.id, e.vorschlag!.shopId), 'Übernommen.')}>
                Übernehmen
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== ''}
                onClick={() => run(`no-${e.id}`, () => rejectTakeover(e.id, e.vorschlag!.shopId), 'Abgelehnt – der Laden bekommt eine eigene Seite.')}
              >
                Nicht derselbe
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Finden und anlegen ----------------------------------------------------------------------------------------------

type ImportState = { state: 'wartet' | 'liest' | 'fertig' | 'fehler'; text?: string };

const waehlbar = (t: Treffer) => Boolean(t.website) && !t.eintragId && !t.shopId && !t.geschlossen && t.kategorie !== null;

function Finden({ status, onImported, onNew }: { status: Liste['status']; onImported: () => void; onNew: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Treffer[]>([]);
  const [next, setNext] = useState('');
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, ImportState>>({});
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState('');

  const search = async (more = false) => {
    if (query.trim().length < 3) return;
    setSearching(true);
    try {
      const r = await searchGoogle(query.trim(), more ? next : '');
      setHits((h) => (more ? [...h, ...r.treffer] : r.treffer));
      setNext(r.nextPageToken);
      if (!more) {
        setPicked(new Set());
        setProgress({});
      }
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSearching(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Nacheinander, zwei gleichzeitig: jede Webseite dauert bis zu einer Minute */
  const runImport = async () => {
    const queue = hits.filter((t) => picked.has(t.placeId));
    if (!queue.length) return;
    setRunning(true);
    setProgress((p) => ({ ...p, ...Object.fromEntries(queue.map((t) => [t.placeId, { state: 'wartet' as const }])) }));
    let ok = 0;
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const hit = t;
        setProgress((p) => ({ ...p, [hit.placeId]: { state: 'liest' } }));
        try {
          const e = await importSalon({ website: hit.website, placeId: hit.placeId, name: hit.name, address: hit.address });
          ok += 1;
          setProgress((p) => ({ ...p, [hit.placeId]: { state: 'fertig', text: e.fehlt.length ? `fehlt: ${e.fehlt.join(', ')}` : 'vollständig' } }));
          setHits((h) => h.map((x) => (x.placeId === hit.placeId ? { ...x, eintragId: e.id } : x)));
        } catch (e) {
          setProgress((p) => ({ ...p, [hit.placeId]: { state: 'fehler', text: message(e) } }));
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setPicked(new Set());
    setRunning(false);
    toast.success(`${ok} ${ok === 1 ? 'Entwurf' : 'Entwürfe'} angelegt. Bitte prüfen und veröffentlichen.`);
    onImported();
  };

  const fromWebsite = async () => {
    if (!url.trim()) return;
    setRunning(true);
    try {
      const e = await importSalon({ website: url.trim() });
      toast.success(`„${e.name}“ als Entwurf angelegt.`);
      setUrl('');
      onImported();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setRunning(false);
    }
  };

  const selectable = hits.filter(waehlbar);

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-bold">Salons finden</h2>
        <p className="text-sm text-muted-foreground">
          Google dient nur zum Finden. Angelegt wird, was auf der Webseite des Salons steht (Impressum, Preise, Öffnungszeiten) – als Entwurf, den du
          prüfst.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="z. B. Friseur Prenzlauer Berg, Barbershop Wedding"
          aria-label="Suche bei Google"
          disabled={!status.google}
        />
        <Button type="submit" disabled={searching || !status.google || query.trim().length < 3}>
          <Search className="h-4 w-4" aria-hidden="true" />
          {searching ? 'Sucht …' : 'Suchen'}
        </Button>
      </form>

      {hits.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {hits.length} Treffer, {selectable.length} neu mit eigener Webseite
            </span>
            <Button size="sm" variant="ghost" disabled={running} onClick={() => setPicked(new Set(selectable.map((t) => t.placeId)))}>
              Alle neuen auswählen
            </Button>
            <Button size="sm" variant="ghost" disabled={running || picked.size === 0} onClick={() => setPicked(new Set())}>
              Auswahl leeren
            </Button>
            <Button size="sm" className="ml-auto" disabled={running || picked.size === 0} onClick={runImport}>
              {running ? 'Liest Webseiten …' : `Ausgewählte anlegen (${picked.size})`}
            </Button>
          </div>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {hits.map((t) => {
              const p = progress[t.placeId];
              const can = waehlbar(t);
              return (
                <li key={t.placeId} className={cn('flex items-start gap-3 p-3', !can && !p && 'opacity-60')}>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-foreground"
                    checked={picked.has(t.placeId)}
                    disabled={!can || running}
                    onChange={() => toggle(t.placeId)}
                    aria-label={`${t.name} auswählen`}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {t.name}
                      {t.kategorie ? <Pill>{KATEGORIE_LABEL[t.kategorie]}</Pill> : <Pill>andere Branche</Pill>}
                      {t.eintragId && <Pill tone="dark">im Verzeichnis</Pill>}
                      {t.shopId && <Pill tone="signal">bei Dranzeit</Pill>}
                      {t.geschlossen && <Pill tone="alarm">geschlossen</Pill>}
                    </p>
                    <p className="text-sm text-muted-foreground">{t.address}</p>
                    <p className="truncate text-sm">
                      {t.website ? (
                        <a href={t.website} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                          {t.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">
                          keine eigene Webseite{t.websiteFremd ? ` (nur ${host(t.websiteFremd)})` : ''} – nur von Hand
                        </span>
                      )}
                    </p>
                    {p && (
                      <p className={cn('text-sm', p.state === 'fehler' ? 'text-destructive' : 'text-muted-foreground')} role="status">
                        {p.state === 'wartet' && 'wartet …'}
                        {p.state === 'liest' && 'liest Webseite …'}
                        {p.state === 'fertig' && `Entwurf angelegt · ${p.text}`}
                        {p.state === 'fehler' && p.text}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Suchergebnisse: Google Maps</p>
            {next && (
              <Button size="sm" variant="outline" disabled={searching || running} onClick={() => search(true)}>
                Weitere Treffer
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="verzeichnis-url">Von einer Webseite anlegen</Label>
          <Input id="verzeichnis-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="salon-beispiel.de" disabled={!status.ai} />
        </div>
        <Button variant="outline" disabled={running || !url.trim() || !status.ai} onClick={fromWebsite}>
          Lesen und anlegen
        </Button>
        <Button variant="ghost" onClick={onNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Von Hand
        </Button>
      </div>
    </section>
  );
}

// --- Liste -----------------------------------------------------------------------------------------------------------

function EintragTabelle({ entries, onOpen }: { entries: Eintrag[]; onOpen: (id: string) => void }) {
  if (!entries.length) return <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">Keine Einträge in dieser Auswahl.</p>;
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="hidden bg-muted/60 text-left text-xs uppercase tracking-[0.06em] text-muted-foreground md:table-header-group">
          <tr>
            <th className="px-4 py-3 font-semibold">Salon</th>
            <th className="px-4 py-3 font-semibold">Ort</th>
            <th className="px-4 py-3 font-semibold">Stand</th>
            <th className="px-4 py-3 text-right font-semibold">Wünsche</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((e) => (
            <tr
              key={e.id}
              tabIndex={0}
              onClick={() => onOpen(e.id)}
              onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onOpen(e.id))}
              className="grid cursor-pointer grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none md:table-row md:p-0"
            >
              <td className="col-span-2 md:px-4 md:py-3">
                <span className="font-semibold">{e.name || '(ohne Name)'}</span>
                {e.shopId && (
                  <span className="ml-2">
                    <Pill tone="signal">Dranzeit</Pill>
                  </span>
                )}
                <span className="block text-xs text-muted-foreground">{e.kategorie ? KATEGORIE_LABEL[e.kategorie] : ''}</span>
              </td>
              <td className="md:px-4 md:py-3">{[e.ortsteil, e.city].filter(Boolean).join(', ') || '–'}</td>
              <td className="md:px-4 md:py-3">
                <Pill tone={statusTone(e.status)}>{STATUS_LABEL[e.status] ?? e.status}</Pill>
                {e.shopFehlt && <span className="ml-2 text-xs text-destructive">Laden fehlt</span>}
                {e.fehlt.length > 0 && <span className="block text-xs text-muted-foreground">fehlt: {e.fehlt.join(', ')}</span>}
              </td>
              <td className="tabular-nums md:px-4 md:py-3 md:text-right">{e.wuensche || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Bearbeiten ------------------------------------------------------------------------------------------------------

type Form = {
  name: string;
  kategorie: Kategorie;
  street: string;
  postalCode: string;
  city: string;
  ortsteil: string;
  bezirk: string;
  phone: string;
  website: string;
  beschreibung: string;
  schwerpunkte: string;
  ohneTermin: string;
  slug: string;
  services: Leistung[];
  zeiten: Record<number, string>;
};

const formFrom = (e?: Eintrag): Form => {
  const hours = new Map((e?.businessHoursByDay ?? []).map((d) => [d.dayOfWeek, d]));
  return {
    name: e?.name ?? '',
    kategorie: e?.kategorie ?? 'friseur',
    street: e?.street ?? '',
    postalCode: e?.postalCode ?? '',
    city: e?.city ?? 'Berlin',
    ortsteil: e?.ortsteil ?? '',
    bezirk: e?.bezirk ?? '',
    phone: e?.phone ?? '',
    website: e?.website ?? '',
    beschreibung: e?.beschreibung ?? '',
    schwerpunkte: (e?.schwerpunkte ?? []).join(', '),
    ohneTermin: e?.ohneTermin ?? '',
    slug: e?.slug ?? '',
    services: e?.services ?? [],
    zeiten: Object.fromEntries(TAGE_REIHE.map((d) => [d, tagAlsText(hours.get(d))])),
  };
};

function EintragEditor({ entry, onSaved, onClose }: { entry?: Eintrag; onSaved: (e: Eintrag) => void; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => formFrom(entry));
  const [busy, setBusy] = useState('');
  const isShop = Boolean(entry?.shopId);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  /** null, wenn eine Öffnungszeit nicht lesbar ist (Meldung schon gezeigt) */
  const daten = (): EintragDaten | null => {
    const tage: Tag[] = [];
    for (const d of TAGE_REIHE) {
      const t = textAlsTag(d, form.zeiten[d] ?? '');
      if (!t) {
        toast.error(`Öffnungszeit am ${TAG_NAME[d]} so schreiben: 09:00–12:00, 13:00–18:00 (leer = geschlossen).`);
        return null;
      }
      tage.push(t);
    }
    const schwerpunkte = form.schwerpunkte.split(',').map((s) => s.trim()).filter(Boolean);
    if (isShop) {
      return { kategorie: form.kategorie, ortsteil: form.ortsteil, bezirk: form.bezirk, beschreibung: form.beschreibung, schwerpunkte, slug: form.slug };
    }
    return {
      name: form.name,
      kategorie: form.kategorie,
      street: form.street,
      postalCode: form.postalCode,
      city: form.city,
      ortsteil: form.ortsteil,
      bezirk: form.bezirk,
      phone: form.phone,
      website: form.website,
      beschreibung: form.beschreibung,
      schwerpunkte,
      ohneTermin: form.ohneTermin,
      services: form.services.filter((s) => s.name.trim()),
      businessHoursByDay: tage,
      ...(entry ? { slug: form.slug } : {}),
    };
  };

  const run = async (key: string, fn: () => Promise<Eintrag | void>, done: string) => {
    setBusy(key);
    try {
      const result = await fn();
      toast.success(done);
      if (result) {
        setForm(formFrom(result));
        onSaved(result);
      } else if (entry) onSaved(entry);
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy('');
    }
  };

  const save = async (publish = false) => {
    const d = daten();
    if (!d) return;
    if (!entry) {
      await run('save', () => createByHand(d), 'Als Entwurf angelegt.');
      return;
    }
    await run(
      publish ? 'publish' : 'save',
      async () => {
        const saved = await saveEintrag(entry.id, d);
        if (publish) await setStatus(entry.id, 'online');
        return { ...saved, status: publish ? 'online' : saved.status };
      },
      publish ? 'Veröffentlicht.' : 'Gespeichert.',
    );
  };

  const changeStatus = (status: 'online' | 'offline' | 'entwurf', done: string) =>
    entry && run(`status-${status}`, async () => ({ ...entry, status: (await setStatus(entry.id, status)).status as EintragStatus }), done);

  const reread = () => {
    if (!entry) return;
    if (!window.confirm('Webseite neu lesen? Name, Adresse, Zeiten, Preise und Text werden mit dem Stand der Webseite überschrieben.')) return;
    run('reread', () => importSalon({ website: form.website || entry.website, eintragId: entry.id, name: entry.name }), 'Neu gelesen.');
  };

  const remove = async () => {
    if (!entry || !window.confirm(`„${entry.name}“ endgültig löschen? Die Seite verschwindet (404).`)) return;
    setBusy('delete');
    try {
      await deleteEintrag(entry.id);
      toast.success('Gelöscht.');
      onSaved(entry);
      onClose();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy('');
    }
  };

  const field = (key: keyof Form, label: string, props: Partial<ComponentProps<typeof Input>> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`v-${key}`}>{label}</Label>
      <Input id={`v-${key}`} value={form[key] as string} onChange={(e) => set(key, e.target.value as never)} {...props} />
    </div>
  );

  return (
    <div className="flex flex-col gap-5 pt-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {entry && <Pill tone={statusTone(entry.status)}>{STATUS_LABEL[entry.status] ?? entry.status}</Pill>}
          {isShop && <Pill tone="signal">Dranzeit-Laden</Pill>}
          {entry?.wuensche ? <Pill tone="dark">{entry.wuensche} Wünsche</Pill> : null}
        </div>
        <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em]">{entry ? entry.name || '(ohne Name)' : 'Salon von Hand anlegen'}</h2>
        {entry?.pfad && (
          <p className="text-sm">
            {entry.status === 'online' ? (
              <a href={entry.pfad} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                {entry.pfad} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-muted-foreground">{entry.pfad} (erst nach dem Veröffentlichen erreichbar)</span>
            )}
          </p>
        )}
        {isShop && (
          <p className="text-sm text-muted-foreground">
            Name, Adresse, Zeiten und Preise pflegt der Laden selbst. Hier nur Kategorie, Ortsteil und Text der Seite.
            {entry?.shopFehlt && ' Den Laden gibt es nicht mehr oder er ist gesperrt – die Seite ist aus.'}
          </p>
        )}
        {!entry && (
          <p className="text-sm text-muted-foreground">
            Für Salons ohne eigene Webseite. Nur Angaben, die du selbst geprüft hast (Ladenschild, Aushang, Anruf) – nichts aus Google übernehmen.
          </p>
        )}
      </header>

      <Section title="Angaben">
        <div className="grid gap-3 sm:grid-cols-2">
          {!isShop && field('name', 'Name')}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-kategorie">Kategorie</Label>
            <select
              id="v-kategorie"
              className="h-11 rounded-xl border border-input bg-card px-3 text-sm"
              value={form.kategorie}
              onChange={(e) => set('kategorie', e.target.value as Kategorie)}
            >
              <option value="friseur">Friseur</option>
              <option value="barbershop">Barbershop</option>
            </select>
          </div>
          {!isShop && field('street', 'Straße und Hausnummer')}
          {!isShop && field('postalCode', 'PLZ', { inputMode: 'numeric', maxLength: 5 })}
          {!isShop && field('city', 'Ort')}
          {field('ortsteil', 'Ortsteil', { placeholder: 'von OpenStreetMap' })}
          {field('bezirk', 'Bezirk', { placeholder: 'von OpenStreetMap' })}
          {!isShop && field('phone', 'Telefon')}
          {!isShop && field('website', 'Webseite')}
          {entry && field('slug', 'Adresse der Seite (letzter Teil)')}
        </div>
      </Section>

      <Section title="Text und Schwerpunkte">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-beschreibung">Beschreibung (2–4 Sätze, sachlich, nur Fakten von der Webseite)</Label>
          <Textarea id="v-beschreibung" rows={5} value={form.beschreibung} maxLength={800} onChange={(e) => set('beschreibung', e.target.value)} />
          <p className="text-xs text-muted-foreground">{form.beschreibung.length} Zeichen</p>
        </div>
        {field('schwerpunkte', 'Schwerpunkte (mit Komma getrennt, höchstens 6)')}
        {!isShop && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-ohne">Ohne Termin?</Label>
            <select id="v-ohne" className="h-11 rounded-xl border border-input bg-card px-3 text-sm" value={form.ohneTermin} onChange={(e) => set('ohneTermin', e.target.value)}>
              <option value="">unbekannt</option>
              <option value="ja">ja, laut Webseite</option>
              <option value="nein">nein, nur mit Termin</option>
            </select>
          </div>
        )}
      </Section>

      {!isShop && (
        <Section title="Öffnungszeiten">
          <p className="text-xs text-muted-foreground">Je Tag z. B. „09:00–18:00“ oder mit Pause „09:00–12:00, 13:00–18:00“. Leer heißt geschlossen.</p>
          <div className="grid gap-2">
            {TAGE_REIHE.map((d) => (
              <div key={d} className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
                <Label htmlFor={`v-tag-${d}`}>{TAG_NAME[d]}</Label>
                <Input
                  id={`v-tag-${d}`}
                  value={form.zeiten[d] ?? ''}
                  placeholder="geschlossen"
                  onChange={(e) => setForm((f) => ({ ...f, zeiten: { ...f.zeiten, [d]: e.target.value } }))}
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      {!isShop && (
        <Section title={`Preise (${form.services.length})`}>
          <div className="flex flex-col gap-2">
            {form.services.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_auto_auto] items-center gap-2 sm:grid-cols-[1fr_8rem_6rem_auto_auto]">
                <Input
                  aria-label="Leistung"
                  value={s.name}
                  onChange={(e) => set('services', form.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <Input
                  aria-label="Gruppe"
                  className="hidden sm:block"
                  placeholder="Gruppe"
                  value={s.category}
                  onChange={(e) => set('services', form.services.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}
                />
                <Input
                  aria-label="Preis in Euro"
                  inputMode="decimal"
                  value={String(s.price ?? '')}
                  onChange={(e) =>
                    set('services', form.services.map((x, j) => (j === i ? { ...x, price: Number(e.target.value.replace(',', '.')) || 0 } : x)))
                  }
                />
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    className="accent-foreground"
                    checked={s.priceFrom}
                    onChange={(e) => set('services', form.services.map((x, j) => (j === i ? { ...x, priceFrom: e.target.checked } : x)))}
                  />
                  ab
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${s.name || 'Leistung'} entfernen`}
                  onClick={() => set('services', form.services.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" className="self-start" onClick={() => set('services', [...form.services, { name: '', category: '', price: 0, priceFrom: false }])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Leistung
            </Button>
          </div>
        </Section>
      )}

      <div className="sticky bottom-0 -mx-6 flex flex-wrap gap-2 border-t border-border bg-background px-6 py-4">
        <Button disabled={busy !== ''} onClick={() => save(false)}>
          {busy === 'save' ? 'Speichert …' : entry ? 'Speichern' : 'Als Entwurf anlegen'}
        </Button>
        {entry && entry.status !== 'online' && (
          <Button variant="signal" disabled={busy !== ''} onClick={() => save(true)}>
            {busy === 'publish' ? 'Veröffentlicht …' : 'Speichern und veröffentlichen'}
          </Button>
        )}
        {entry && entry.status === 'online' && (
          <Button variant="outline" disabled={busy !== ''} onClick={() => changeStatus('offline', 'Offline genommen.')}>
            Offline nehmen
          </Button>
        )}
        {entry && !isShop && (form.website || entry.website) && (
          <Button variant="ghost" disabled={busy !== ''} onClick={reread}>
            {busy === 'reread' ? 'Liest …' : 'Webseite neu lesen'}
          </Button>
        )}
        {entry && (!isShop || entry.shopFehlt) && (
          <Button variant="ghost" className="ml-auto text-destructive" disabled={busy !== ''} onClick={remove}>
            Löschen
          </Button>
        )}
      </div>

      {entry && (
        <Section title="Herkunft">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Angelegt">{fmtDate(entry.angelegtAm)}</Fact>
            <Fact label="Veröffentlicht">{fmtDate(entry.veroeffentlichtAm)}</Fact>
            <Fact label="Webseite gelesen">{fmtDateTime(entry.quelle?.gelesenAm)}</Fact>
            <Fact label="Google-Eintrag">{entry.googlePlaceId ? 'verknüpft (nur ID)' : '–'}</Fact>
            {entry.entferntAm && <Fact label="Vom Salon entfernt">{fmtDateTime(entry.entferntAm)} (Grund im Protokoll)</Fact>}
          </dl>
          {entry.quelle?.seiten?.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {entry.quelle.seiten.map((u) => (
                <li key={u} className="truncate">
                  <a href={u} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                    {u}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {entry.altePfade?.length ? <p className="text-sm text-muted-foreground">Leitet weiter von: {entry.altePfade.join(', ')}</p> : null}
        </Section>
      )}
    </div>
  );
}
