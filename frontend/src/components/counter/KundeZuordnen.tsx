import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { UserCheck, UserPlus } from 'lucide-react';
import { nurTresen } from 'app';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createCustomer, getCustomerEntries, updateAppointment, type Appointment, type Customer } from '../../utils/firestore';
import { useUserProfile } from '../../utils/hooks/useUserProfile';
import { passtZurSuche, type KarteiEintrag } from '../../utils/kartei-logik';
import { t } from '@/i18n';

// Kundenliste je Laden kurz merken: Jede Schlange am Tresen fragt sonst einzeln nach
const MERKEN_MS = 60_000;
const merker = new Map<string, { zeit: number; liste: Promise<Customer[]> }>();

const kundenliste = (shopId: string, neu = false): Promise<Customer[]> => {
  const alt = merker.get(shopId);
  if (!neu && alt && Date.now() - alt.zeit < MERKEN_MS) return alt.liste;
  const liste = getCustomerEntries(shopId);
  merker.set(shopId, { zeit: Date.now(), liste });
  liste.catch(() => merker.delete(shopId));
  return liste;
};

const PLATZHALTER = ['Unbekannter Kunde', 'Laufkundschaft', 'Gast', 'Kunde gelöscht'];

/** Zu welchem Eintrag der Kundenliste gehört der Termin? Zugeordnet (kundeId) geht vor, sonst customerId: der
 *  Eintrag selbst oder sein verbundenes Konto (wie backend/app/libs/kartei.py) */
export const eintragZumTermin = (a: Appointment, kunden: Customer[]): Customer | null => {
  if (a.kundeId) return kunden.find((k) => k.id === a.kundeId) ?? null;
  const id = a.customerId;
  if (!id || id === 'walk-in') return null;
  return kunden.find((k) => k.id === id) ?? kunden.find((k) => k.userId === id) ?? null;
};

const alsEintrag = (k: Customer): KarteiEintrag => ({ id: k.id, name: k.name, email: k.email, phone: k.phone, angelegt: null });

const ziffern = (s?: string) => (s || '').replace(/\D/g, '').replace(/^(00|0)/, '').replace(/^49/, '');

/**
 * Am Tresen bei „Jetzt dran“: Wer ist das in der Kundenliste? Ist der Termin zugeordnet, steht der Name da (Inhaber und
 * Team: mit Link zur Kundenseite, für Notizen wie die Farbrezeptur). Sonst „Kunde zuordnen“: Vorschläge über Handynummer
 * und Namen, Suche, oder als neuen Kunden anlegen. Zugeordnet wird über kundeId (backend/app/libs/team_termine.py prüft,
 * dass der Eintrag zu diesem Laden gehört) – customerId bleibt, wie sie ist. Geht auch am Tablet.
 */
export function KundeZuordnen({ termin }: { termin: Appointment }) {
  const { user } = useUserProfile();
  const tablet = nurTresen(user);
  const [kunden, setKunden] = useState<Customer[] | null>(null);
  const [offen, setOffen] = useState(false);

  useEffect(() => {
    let aktiv = true;
    kundenliste(termin.shopId)
      .then((l) => aktiv && setKunden(l))
      .catch(() => aktiv && setKunden([]));
    return () => {
      aktiv = false;
    };
  }, [termin.shopId]);

  if (kunden === null) return null;
  const eintrag = eintragZumTermin(termin, kunden);
  const zugeordnet = (k: Customer) => {
    setKunden((l) => (l?.some((x) => x.id === k.id) ? l : [...(l || []), k]));
    setOffen(false);
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {eintrag ? (
        <>
          <span className="inline-flex items-center gap-1 font-semibold">
            <UserCheck className="h-4 w-4" aria-hidden="true" />
            {tablet ? (
              t('In der Kundenliste: {name}', { name: eintrag.name })
            ) : (
              <Link to={`/kunden/${encodeURIComponent(eintrag.id)}?shopId=${encodeURIComponent(termin.shopId)}`} className="underline underline-offset-2">
                {t('Kundenkartei: {name}', { name: eintrag.name })}
              </Link>
            )}
          </span>
          {termin.kundeId && (
            <button type="button" className="underline underline-offset-2" onClick={() => setOffen(true)}>
              {t('Ändern')}
            </button>
          )}
        </>
      ) : (
        <button type="button" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2" onClick={() => setOffen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {t('Kunde zuordnen')}
        </button>
      )}
      {offen && <ZuordnenDialog termin={termin} kunden={kunden} aktuell={eintrag} onFertig={zugeordnet} onSchliessen={() => setOffen(false)} />}
    </div>
  );
}

function ZuordnenDialog({
  termin,
  kunden,
  aktuell,
  onFertig,
  onSchliessen,
}: {
  termin: Appointment;
  kunden: Customer[];
  aktuell: Customer | null;
  onFertig: (k: Customer) => void;
  onSchliessen: () => void;
}) {
  const name = termin.customerName && !PLATZHALTER.includes(termin.customerName.trim()) ? termin.customerName.trim() : '';
  const [suche, setSuche] = useState('');
  const [busy, setBusy] = useState(false);
  const [neuName, setNeuName] = useState(name);
  const [neuTelefon, setNeuTelefon] = useState(termin.customerPhone || '');
  const [neu, setNeu] = useState(false);

  const vorschlaege = useMemo(() => {
    const tel = ziffern(termin.customerPhone);
    const n = name.toLocaleLowerCase('de');
    return kunden.filter(
      (k) => k.id !== aktuell?.id && ((tel.length >= 6 && ziffern(k.phone) === tel) || (n && (k.name || '').toLocaleLowerCase('de') === n)),
    );
  }, [kunden, termin.customerPhone, name, aktuell]);
  const treffer = useMemo(
    () =>
      suche.trim()
        ? kunden
            .filter((k) => k.id !== aktuell?.id && passtZurSuche(alsEintrag(k), suche))
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'))
            .slice(0, 20)
        : [],
    [kunden, suche, aktuell],
  );

  const zuordnen = async (k: Customer) => {
    setBusy(true);
    try {
      await updateAppointment(termin.id, { kundeId: k.id });
      kundenliste(termin.shopId, true).catch(() => {});
      toast.success(t('{name} zugeordnet.', { name: k.name }));
      onFertig(k);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
      setBusy(false);
    }
  };

  const loesen = async () => {
    setBusy(true);
    try {
      await updateAppointment(termin.id, { kundeId: '' });
      toast.success(t('Zuordnung gelöst.'));
      onSchliessen();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
      setBusy(false);
    }
  };

  const anlegen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!neuName.trim()) return;
    setBusy(true);
    try {
      const k = await createCustomer({ shopId: termin.shopId, name: neuName.trim(), email: '', phone: neuTelefon.trim() });
      await zuordnen(k);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Das hat nicht geklappt.'));
      setBusy(false);
    }
  };

  const Zeile = ({ k }: { k: Customer }) => (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{k.name || t('Ohne Namen')}</span>
        {(k.phone || k.email) && (
          <span className="block truncate text-xs text-muted-foreground">
            <bdi dir="ltr">{[k.phone, k.email].filter(Boolean).join(' · ')}</bdi>
          </span>
        )}
      </span>
      <Button size="sm" variant="outline" onClick={() => zuordnen(k)} disabled={busy}>
        {t('Zuordnen')}
      </Button>
    </li>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onSchliessen()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Kunde zuordnen')}</DialogTitle>
          <DialogDescription>
            {t('Dann steht dieser Besuch in der Kundenkartei, mit Leistung und Preis. Am Termin selbst ändert sich nichts.')}
          </DialogDescription>
        </DialogHeader>

        {vorschlaege.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Passt vielleicht')}</h3>
            <ul className="divide-y divide-border">
              {vorschlaege.map((k) => (
                <Zeile key={k.id} k={k} />
              ))}
            </ul>
          </section>
        )}

        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t('Suchen')}
          <input
            type="search"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder={t('Name, Telefon oder E-Mail')}
            className="h-11 rounded-xl border border-border bg-background px-3 text-base font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {suche.trim() &&
          (treffer.length ? (
            <ul className="divide-y divide-border">
              {treffer.map((k) => (
                <Zeile key={k.id} k={k} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('Niemand passt dazu.')}</p>
          ))}

        {!neu ? (
          <Button variant="outline" onClick={() => setNeu(true)} disabled={busy}>
            <UserPlus className="me-2 h-4 w-4" aria-hidden="true" />
            {t('Als neuen Kunden anlegen')}
          </Button>
        ) : (
          <form onSubmit={anlegen} className="flex flex-col gap-2 rounded-2xl border border-border p-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t('Name')}
              <input
                value={neuName}
                onChange={(e) => setNeuName(e.target.value)}
                required
                maxLength={80}
                className="h-11 rounded-xl border border-border bg-background px-3 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t('Telefon (freiwillig)')}
              <input
                value={neuTelefon}
                onChange={(e) => setNeuTelefon(e.target.value)}
                type="tel"
                inputMode="tel"
                dir="ltr"
                maxLength={40}
                className="h-11 rounded-xl border border-border bg-background px-3 text-base font-normal"
              />
            </label>
            <Button type="submit" disabled={busy || !neuName.trim()}>
              {busy ? t('Moment …') : t('Anlegen und zuordnen')}
            </Button>
          </form>
        )}

        {termin.kundeId && aktuell && (
          <button type="button" className="text-start text-sm font-semibold text-muted-foreground underline underline-offset-2" onClick={loesen} disabled={busy}>
            {t('Zuordnung zu {name} lösen', { name: aktuell.name })}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
