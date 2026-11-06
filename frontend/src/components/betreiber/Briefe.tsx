import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileDown, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  createWelle,
  discardWelle,
  loadBriefe,
  markHochgeladen,
  saveEinstellungen,
  startVersand,
  type BriefArt,
  type BriefEinstellungen,
  type BriefSalon,
  type BriefeDaten,
  type Schnittstelle,
  type Welle,
} from '../../utils/briefe';
import type { Kategorie } from '../../utils/verzeichnis';
import { Section } from './LadenDetail';
import { Chip, Pill } from './Verzeichnis';
import { euro, fmtDate, fmtDateTime } from './format';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Das hat nicht geklappt.');
const ART_LABEL: Record<BriefArt, string> = { brief: 'Erster Brief', erinnerung: 'Erinnerung' };
const SELECT = 'h-10 rounded-xl border border-input bg-card px-3 text-sm';
const anzahl = (n: number, art: BriefArt) => `${n} ${art === 'erinnerung' ? (n === 1 ? 'Erinnerung' : 'Erinnerungen') : n === 1 ? 'Brief' : 'Briefe'}`;

/**
 * Betreiber-Bereich, Reiter Briefe (requirements/briefversand.md): Salons aus dem Verzeichnis auswählen und anschreiben.
 * Zwei Wege: Sammel-PDF zum Hochladen bei PIN eBrief (Stufe A) oder direkt über die Schnittstelle von PIN (Stufe B, mit
 * Testmodus). Regeln stehen im Backend (app/libs/briefaktion.py).
 */
export function Briefe() {
  const [data, setData] = useState<BriefeDaten | null>(null);
  const [error, setError] = useState('');
  const [art, setArt] = useState<BriefArt>('brief');
  const [bezirk, setBezirk] = useState('');
  const [ortsteil, setOrtsteil] = useState('');
  const [plz, setPlz] = useState('');
  const [kategorie, setKategorie] = useState<Kategorie | ''>('');
  const [abgewaehlt, setAbgewaehlt] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');

  const reload = useCallback(async () => {
    try {
      setData(await loadBriefe());
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  // Läuft eine Welle über PIN, zeigt die Seite den Fortschritt
  const laeuft = Boolean(data?.wellen.some((w) => w.status === 'versendet'));
  useEffect(() => {
    if (!laeuft) return;
    const t = window.setInterval(reload, 3000);
    return () => window.clearInterval(t);
  }, [laeuft, reload]);

  const passend = useMemo(
    () =>
      (data?.eintraege ?? []).filter(
        (e) =>
          (!bezirk || e.bezirk === bezirk) &&
          (!ortsteil || e.ortsteil === ortsteil) &&
          (!plz.trim() || e.postalCode.startsWith(plz.trim())) &&
          (!kategorie || e.kategorie === kategorie),
      ),
    [data, bezirk, ortsteil, plz, kategorie],
  );

  if (error && !data) return <p className="rounded-3xl bg-destructive p-5 text-destructive-foreground">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Wird geladen …</p>;

  const { einstellungen, monat, schnittstelle } = data;
  const test = einstellungen.testmodus;
  const pinBereit = schnittstelle[test ? 'test' : 'echt'];
  const waehlbar = passend.filter((e) => !e.gruende[art]);
  const ausgeschlossen = passend.filter((e) => e.gruende[art]);
  const gewaehlt = waehlbar.filter((e) => !abgewaehlt.has(e.id));
  const kosten = Math.round(gewaehlt.length * einstellungen.preis * 100) / 100;
  const zuViele = gewaehlt.length > einstellungen.proWelle;
  const zuTeuer = monat.kosten + kosten > monat.grenze + 0.001;
  const bezirke = [...new Set(data.eintraege.map((e) => e.bezirk).filter(Boolean))].sort();
  const ortsteile = [...new Set(data.eintraege.filter((e) => !bezirk || e.bezirk === bezirk).map((e) => e.ortsteil).filter(Boolean))].sort();
  const offen = data.wellen.filter((w) => w.status === 'erzeugt');
  const faellig = data.eintraege.filter((e) => !e.gruende.erinnerung).length;
  const gesperrt = busy !== '' || laeuft || !gewaehlt.length || zuViele;

  const toggle = (id: string) =>
    setAbgewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });

  const run = async (was: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(was);
    try {
      await fn();
      toast.success(done);
      setAbgewaehlt(new Set());
    } catch (e) {
      toast.error(message(e));
    } finally {
      await reload();
      setBusy('');
    }
  };

  const alsPdf = () => {
    if (gesperrt || zuTeuer) return;
    if (!window.confirm(`${anzahl(gewaehlt.length, art)} für ${euro(kosten)} als PDF erzeugen? Danach lädt das PDF. Die Codes stehen nur darin.`)) return;
    run('pdf', () => createWelle(art, gewaehlt.map((e) => e.id)), 'PDF gespeichert. Bei PIN eBrief hochladen und danach hier „Hochgeladen“ klicken.');
  };

  const ueberPin = () => {
    if (gesperrt || (!test && zuTeuer)) return;
    const frage = test
      ? `${anzahl(gewaehlt.length, art)} an die Testumgebung von PIN schicken? Es wird nichts gedruckt, die Salons bleiben unverändert.`
      : `${anzahl(gewaehlt.length, art)} für ca. ${euro(kosten)} über PIN eBrief verschicken? Sie gehen sofort in den Druck.`;
    if (!window.confirm(frage)) return;
    run('pin', () => startVersand(art, gewaehlt.map((e) => e.id)), test ? 'Test läuft. Den Fortschritt siehst du unten.' : 'Versand läuft. Den Fortschritt siehst du unten.');
  };

  return (
    <div className="flex flex-col gap-4">
      {pinBereit && test && (
        <p className="rounded-3xl border-2 border-dashed border-foreground p-4 text-sm font-medium">
          Testmodus: „Über PIN“ geht an die Testumgebung von PIN eBrief. Es wird nichts gedruckt, die Salons bleiben unverändert, und
          Testwellen zählen nicht. Umschalten unten unter Einstellungen.
        </p>
      )}
      {offen.length > 0 && (
        <p className="rounded-3xl border border-foreground bg-signal/30 p-4 text-sm font-medium">
          {offen.length === 1 ? 'Eine Welle ist' : `${offen.length} Wellen sind`} erzeugt, aber noch nicht hochgeladen. Unten „Hochgeladen“ klicken, sobald
          das PDF bei PIN ist, oder verwerfen.
        </p>
      )}

      <Section title="Neue Welle">
        <div className="flex flex-wrap items-center gap-2">
          {(['brief', 'erinnerung'] as BriefArt[]).map((a) => (
            <Chip key={a} active={art === a} onClick={() => setArt(a)}>
              {ART_LABEL[a]}
              {a === 'erinnerung' && faellig > 0 && ` · ${faellig} fällig`}
            </Chip>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {art === 'brief'
            ? 'Für Salons, die noch keinen Brief bekommen haben.'
            : `Frühestens ${data.erinnerungTage} Tage nach dem ersten Brief, mit kürzerem Text und neuem Code. Danach bekommt der Salon keinen weiteren.`}
        </p>

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-bezirk">Bezirk</Label>
            <select
              id="b-bezirk"
              className={SELECT}
              value={bezirk}
              onChange={(e) => {
                setBezirk(e.target.value);
                setOrtsteil('');
              }}
            >
              <option value="">alle</option>
              {bezirke.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-ortsteil">Ortsteil</Label>
            <select id="b-ortsteil" className={SELECT} value={ortsteil} onChange={(e) => setOrtsteil(e.target.value)}>
              <option value="">alle</option>
              {ortsteile.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-plz">PLZ beginnt mit</Label>
            <Input id="b-plz" inputMode="numeric" placeholder="z. B. 13 oder 13403" value={plz} onChange={(e) => setPlz(e.target.value.replace(/\D/g, '').slice(0, 5))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-kategorie">Art</Label>
            <select id="b-kategorie" className={SELECT} value={kategorie} onChange={(e) => setKategorie(e.target.value as Kategorie | '')}>
              <option value="">Friseure und Barbershops</option>
              <option value="friseur">nur Friseure</option>
              <option value="barbershop">nur Barbershops</option>
            </select>
          </div>
        </div>

        <SalonListe salons={waehlbar} abgewaehlt={abgewaehlt} onToggle={toggle} onAlle={(an) => setAbgewaehlt(an ? new Set() : new Set(waehlbar.map((e) => e.id)))} />

        {ausgeschlossen.length > 0 && <Ausgeschlossen salons={ausgeschlossen} art={art} />}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <p className="text-sm" aria-live="polite">
            <strong className="tabular-nums">{anzahl(gewaehlt.length, art)}</strong> · ca. <strong>{euro(kosten)}</strong>
            <span className="text-muted-foreground">
              {' '}
              · diesen Monat schon {euro(monat.kosten)} von {euro(monat.grenze)}
            </span>
          </p>
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant={pinBereit ? 'outline' : 'signal'} disabled={gesperrt || zuTeuer} onClick={alsPdf}>
              <FileDown className="h-4 w-4" aria-hidden="true" />
              {busy === 'pdf' ? 'Wird erzeugt …' : `${anzahl(gewaehlt.length, art)} als PDF`}
            </Button>
            {pinBereit && (
              <Button variant="signal" disabled={gesperrt || (!test && zuTeuer)} onClick={ueberPin}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {busy === 'pin' ? 'Startet …' : test ? `${anzahl(gewaehlt.length, art)} als Test an PIN` : `${anzahl(gewaehlt.length, art)} über PIN`}
              </Button>
            )}
          </div>
        </div>
        {laeuft && <p className="text-sm font-semibold">Gerade läuft eine Welle über PIN. Neue Briefe gehen erst, wenn sie fertig ist.</p>}
        {zuViele && <p className="text-sm font-semibold text-destructive">Höchstens {anzahl(einstellungen.proWelle, 'brief')} je Welle. Wähl ein paar ab oder grenz die Auswahl ein.</p>}
        {!zuViele && zuTeuer && (
          <p className="text-sm font-semibold text-destructive">
            Damit wäre die Kostengrenze von {euro(monat.grenze)} in diesem Monat überschritten{pinBereit && test ? ' (für einen Test an PIN egal)' : ''}.
          </p>
        )}
        {!pinBereit && (
          <p className="text-xs text-muted-foreground">
            Versand direkt über PIN eBrief: Zugang für {test ? 'die Testumgebung' : 'den echten Versand'} fehlt noch (siehe Einstellungen). Bis dahin als PDF
            erzeugen und bei PIN hochladen.
          </p>
        )}
      </Section>

      <Wellen wellen={data.wellen} onChanged={reload} />

      <Einstellungen werte={einstellungen} schnittstelle={schnittstelle} onSaved={reload} />
    </div>
  );
}

function SalonListe({
  salons,
  abgewaehlt,
  onToggle,
  onAlle,
}: {
  salons: BriefSalon[];
  abgewaehlt: Set<string>;
  onToggle: (id: string) => void;
  onAlle: (an: boolean) => void;
}) {
  if (!salons.length) return <p className="rounded-2xl bg-muted p-4 text-sm">Für diese Auswahl kann gerade kein Salon einen Brief bekommen.</p>;
  const alleAn = salons.every((e) => !abgewaehlt.has(e.id));
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-start text-xs uppercase tracking-[0.06em] text-muted-foreground">
          <tr>
            <th className="w-10 p-3 text-start">
              <input type="checkbox" aria-label="Alle auswählen" className="h-4 w-4 accent-foreground" checked={alleAn} onChange={() => onAlle(!alleAn)} />
            </th>
            <th className="p-3 text-start">Salon</th>
            <th className="p-3 text-start">Anschrift</th>
            <th className="hidden p-3 text-start sm:table-cell">Ortsteil</th>
            <th className="hidden p-3 text-start sm:table-cell">Bisher</th>
          </tr>
        </thead>
        <tbody>
          {salons.map((e) => (
            <tr key={e.id} className={cn('border-t border-border', abgewaehlt.has(e.id) && 'text-muted-foreground')}>
              <td className="p-3">
                <input
                  type="checkbox"
                  aria-label={`${e.name} auswählen`}
                  className="h-4 w-4 accent-foreground"
                  checked={!abgewaehlt.has(e.id)}
                  onChange={() => onToggle(e.id)}
                />
              </td>
              <td className="p-3 font-medium">
                {e.pfad ? (
                  <a href={e.pfad} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                    {e.name}
                  </a>
                ) : (
                  e.name
                )}
              </td>
              <td className="p-3">
                {e.street}, {e.postalCode} {e.city}
              </td>
              <td className="hidden p-3 sm:table-cell">{e.ortsteil || '–'}</td>
              <td className="hidden p-3 sm:table-cell">{e.briefe ? `${e.briefe} · ${fmtDate(e.letzterBrief)}` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ausgeschlossen({ salons, art }: { salons: BriefSalon[]; art: BriefArt }) {
  const nachGrund = new Map<string, BriefSalon[]>();
  for (const e of salons) {
    const grund = e.gruende[art].startsWith('Erinnerung ab') ? 'Erinnerung noch nicht fällig' : e.gruende[art];
    nachGrund.set(grund, [...(nachGrund.get(grund) ?? []), e]);
  }
  return (
    <details className="rounded-2xl border border-border p-4 text-sm">
      <summary className="cursor-pointer font-medium">Nicht dabei: {salons.length}</summary>
      <ul className="mt-3 flex flex-col gap-2">
        {[...nachGrund.entries()].map(([grund, liste]) => (
          <li key={grund}>
            <span className="font-semibold">
              {liste.length} × {grund}
            </span>
            <span className="text-muted-foreground"> {liste.map((e) => (e.gruende[art].startsWith('Erinnerung ab') ? `${e.name} (${e.gruende[art].slice(14, -1)})` : e.name)).join(', ')}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const wellenStatus = (w: Welle) => {
  if (w.status === 'erzeugt') return 'noch nicht hochgeladen';
  if (w.status === 'versendet') return `wird verschickt · ${w.geschickt} von ${w.anzahl}`;
  if (w.status === 'abgebrochen') return 'abgebrochen';
  return `verschickt ${fmtDate(w.verschicktAm)}`;
};

function Wellen({ wellen, onChanged }: { wellen: Welle[]; onChanged: () => void }) {
  const [busy, setBusy] = useState('');
  const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
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
    <Section title="Wellen">
      <p className="text-sm text-muted-foreground">
        Als PDF: bei PIN eBrief hochladen (farbig, einseitig, nach je einer Seite trennen), danach hier „Hochgeladen“ klicken. Unzustellbare Briefe zeigt PIN
        dann im Portal; markier sie im Reiter Verzeichnis am Eintrag mit „Unzustellbar“. Über PIN verschickte Wellen melden Rückläufer selbst.
      </p>
      {!wellen.length ? (
        <p className="text-sm">Noch keine Welle.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {wellen.map((w) => (
            <li key={w.id} className={cn('flex flex-col gap-2 rounded-2xl border p-4', w.test ? 'border-dashed border-foreground/50' : 'border-border')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {ART_LABEL[w.art]} · {fmtDateTime(w.am)}
                </span>
                {w.test && <Pill tone="dark">Test</Pill>}
                <Pill tone={w.status === 'erzeugt' || w.status === 'versendet' ? 'signal' : w.status === 'abgebrochen' ? 'alarm' : 'muted'}>{wellenStatus(w)}</Pill>
                <span className="text-sm text-muted-foreground">
                  {w.weg === 'pin' ? 'über PIN' : 'als PDF'} · {anzahl(w.anzahl, w.art)}
                  {!w.test && ` · ${euro(w.kosten)}`}
                </span>
                {w.status === 'erzeugt' && (
                  <div className="ms-auto flex gap-2">
                    <Button size="sm" disabled={busy !== ''} onClick={() => run(w.id, () => markHochgeladen(w.id), 'Als verschickt vermerkt.')}>
                      {busy === w.id ? '…' : 'Hochgeladen'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== ''}
                      onClick={() =>
                        window.confirm('Welle verwerfen? Ihre Codes gelten dann nicht mehr. Nur verwerfen, wenn das PDF nicht bei PIN hochgeladen ist.') &&
                        run(w.id, () => discardWelle(w.id), 'Welle verworfen.')
                      }
                    >
                      Verwerfen
                    </Button>
                  </div>
                )}
              </div>
              {w.hinweis && <p className="text-sm font-semibold">{w.hinweis}</p>}
              {w.weg === 'pin' && w.status !== 'versendet' && (
                <p className="text-sm">
                  {w.geschickt} bei PIN angekommen{w.unklar > 0 && ` · ${w.unklar} warten noch auf Antwort von PIN`}
                  {w.fehler.length > 0 && ` · ${w.fehler.length} nicht verschickt`}
                </p>
              )}
              {w.fehler.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer">Nicht verschickt: {w.fehler.length} (wieder auswählbar)</summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {w.fehler.map((f) => (
                      <li key={f.id}>
                        <span className="font-medium">{f.name}</span>
                        <span className="text-muted-foreground"> – {f.grund}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {(w.status === 'verschickt' || w.status === 'abgebrochen') && !w.test && (
                <p className="text-sm">
                  <strong>{w.auswertung.uebernommen}</strong> übernommen · {w.auswertung.unzustellbar} unzustellbar · {w.auswertung.entfernt} Eintrag entfernt ·{' '}
                  {w.auswertung.keinePost} keine Post
                  {w.auswertung.kostenJeUebernahme !== null && <span className="text-muted-foreground"> · {euro(w.auswertung.kostenJeUebernahme)} je Übernahme</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Einstellungen({ werte, schnittstelle, onSaved }: { werte: BriefEinstellungen; schnittstelle: Schnittstelle; onSaved: () => void }) {
  const [form, setForm] = useState({ proWelle: String(werte.proWelle), proMonat: String(werte.proMonat), preis: String(werte.preis) });
  const [testmodus, setTestmodus] = useState(werte.testmodus);
  const [busy, setBusy] = useState(false);
  const zahl = (s: string) => Number(s.replace(',', '.'));
  const speichern = async () => {
    if (werte.testmodus && !testmodus && !window.confirm('Testmodus ausschalten? Dann gehen Briefe über PIN wirklich in den Druck und kosten Geld.')) return;
    setBusy(true);
    try {
      await saveEinstellungen({ proWelle: Math.round(zahl(form.proWelle)), proMonat: zahl(form.proMonat), preis: zahl(form.preis), testmodus });
      toast.success('Einstellungen gespeichert.');
      onSaved();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };
  const feld = (key: keyof typeof form, label: string, hint: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`b-${key}`}>{label}</Label>
      <Input id={`b-${key}`} inputMode="decimal" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
  return (
    <Section title="Einstellungen">
      <div className="grid gap-3 sm:grid-cols-3">
        {feld('proWelle', 'Höchstens Briefe je Welle', 'Mehr lässt sich nicht auswählen.')}
        {feld('proMonat', 'Kostengrenze je Monat in €', 'Erzeugte und verschickte Wellen im Kalendermonat, ohne Tests.')}
        {feld('preis', 'Preis je Brief in € (netto)', 'PIN eBrief farbig: 0,77 €. Steigt voraussichtlich im Januar 2027.')}
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-foreground" checked={testmodus} onChange={(e) => setTestmodus(e.target.checked)} />
        <span>
          <span className="font-medium">Testmodus für den Versand über PIN</span>
          <span className="block text-muted-foreground">Briefe gehen an die Testumgebung von PIN eBrief: nichts wird gedruckt, Salons bleiben unverändert.</span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        Zugang zu PIN eBrief: Testumgebung {schnittstelle.test ? 'eingerichtet' : 'fehlt'} · echter Versand {schnittstelle.echt ? 'eingerichtet' : 'fehlt'}
      </p>
      <Button variant="outline" className="self-start" disabled={busy} onClick={speichern}>
        {busy ? 'Speichert …' : 'Speichern'}
      </Button>
    </Section>
  );
}
