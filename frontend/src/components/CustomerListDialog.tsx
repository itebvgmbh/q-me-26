import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Customer, CustomerVisit, getCustomerEntries, getCustomerVisits } from '../utils/firestore';
import { deleteCustomer } from '../utils/datenschutz';
import { datumsLocale, t, tn } from '@/i18n';

interface Props {
  shopId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Kundenliste ("Mein Tag"): wen der Laden angelegt hat, auch der Telefon-Assistent nach einer Buchung, mit den Terminen
 * je Person und Löschen. Fristen: backend/app/libs/privacy.py, Telefon: backend/app/libs/telefon_kunden.py
 */
export const CustomerListDialog = ({ shopId, open, onOpenChange }: Props) => {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomers(null);
    setFailed(false);
    getCustomerEntries(shopId)
      .then(setCustomers)
      .catch(() => setFailed(true));
  }, [open, shopId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Kundenliste')}</DialogTitle>
          <DialogDescription>
            {t('Kunden, die in deinem Laden angelegt wurden, auch vom Telefon-Assistenten nach einer Buchung. Tipp auf einen Namen, dann siehst du die Termine. Ohne verbundenes Konto löscht Dranzeit einen Eintrag von selbst, wenn 12 Monate kein Termin war.')}
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <p className="text-sm text-muted-foreground">{t('Die Kundenliste konnte nicht geladen werden. Versuch es gleich noch einmal.')}</p>
        ) : customers === null ? (
          <div className="h-24 animate-pulse rounded-2xl bg-muted" aria-busy="true" aria-label={t('Kundenliste wird geladen')} />
        ) : customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Noch keine Kunden angelegt.')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {customers.map((c) => (
              <CustomerRow
                key={c.id}
                shopId={shopId}
                customer={c}
                onDeleted={() => setCustomers((list) => (list || []).filter((x) => x.id !== c.id))}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};

function CustomerRow({ shopId, customer, onDeleted }: { shopId: string; customer: Customer; onDeleted: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showVisits, setShowVisits] = useState(false);
  const contact = [customer.email, customer.phone].filter(Boolean).join(' · ');

  const remove = async () => {
    setBusy(true);
    try {
      const { cancelled } = await deleteCustomer(customer.id);
      toast.success(
        cancelled
          ? tn(cancelled, '{name} gelöscht, {n} kommender Termin abgesagt.', '{name} gelöscht, {n} kommende Termine abgesagt.', { name: customer.name })
          : t('{name} gelöscht.', { name: customer.name }),
      );
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 rounded-xl text-start"
          aria-expanded={showVisits}
          onClick={() => setShowVisits((v) => !v)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{customer.name || t('Ohne Namen')}</span>
            {contact && <span className="block truncate text-xs text-muted-foreground"><bdi dir="ltr">{contact}</bdi></span>}
            {customer.userId && <span className="block text-xs font-semibold">{t('Konto verbunden')}</span>}
            {customer.source === 'telefon' && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" aria-hidden="true" />
                {t('Vom Telefon-Assistenten angelegt')}
              </span>
            )}
          </span>
          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 transition-transform ${showVisits ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {!asking && (
          <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
            {t('Löschen')}
          </Button>
        )}
      </div>
      {showVisits && <CustomerVisits shopId={shopId} customerId={customer.id} />}
      {asking && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
          <p className="text-sm font-semibold">
            {customer.userId
              ? t('{name} verschwindet aus deiner Liste. Die Termine bleiben im Konto.', { name: customer.name })
              : t('{name} wird gelöscht. Kommende Termine werden abgesagt, frühere verlieren den Namen.', { name: customer.name })}
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" className="flex-1" onClick={remove} disabled={busy}>
              {busy ? t('Moment …') : t('Ja, löschen')}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setAsking(false)} disabled={busy}>
              {t('Behalten')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Termine einer Person, neueste zuerst. Abgesagte zählen nicht als Besuch. */
function CustomerVisits({ shopId, customerId }: { shopId: string; customerId: string }) {
  const [visits, setVisits] = useState<CustomerVisit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    getCustomerVisits(shopId, customerId)
      .then((v) => current && setVisits(v))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [shopId, customerId]);

  if (failed) return <p className="text-sm text-muted-foreground">{t('Die Termine konnten nicht geladen werden. Versuch es gleich noch einmal.')}</p>;
  if (visits === null) return <div className="h-12 animate-pulse rounded-2xl bg-muted" aria-busy="true" aria-label={t('Termine werden geladen')} />;
  if (visits.length === 0) return <p className="text-sm text-muted-foreground">{t('Noch keine Termine.')}</p>;

  const now = Date.now();
  const vorbei = (v: CustomerVisit) => Boolean(v.startTime && v.startTime.toMillis() <= now);
  const besuche = visits.filter((v) => v.status !== 'cancelled' && vorbei(v)).length;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-muted/50 p-3">
      <p className="text-xs font-semibold">{tn(besuche, '{n} Besuch', '{n} Besuche')}</p>
      <ul className="flex flex-col gap-2">
        {visits.map((v) => {
          const start = v.startTime?.toDate();
          const wer = [v.leistung, v.person && t('bei {name}', { name: v.person })].filter(Boolean).join(' ');
          const abgesagt = v.status === 'cancelled';
          return (
            <li key={v.id} className={`flex items-start gap-2 text-sm ${abgesagt ? 'text-muted-foreground' : ''}`}>
              <span className={`min-w-0 flex-1 ${abgesagt ? 'line-through' : ''}`}>
                <span className="block font-medium">{start ? format(start, t('EEE d. MMM yyyy, HH:mm'), { locale: datumsLocale() }) : '–'}</span>
                {wer && <span className="block text-xs text-muted-foreground">{wer}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {v.source === 'telefon' && <Phone className="h-3 w-3" role="img" aria-label={t('Am Telefon gebucht')} />}
                {visitLabel(v.status, vorbei(v))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Abgesagt, Ist dran, Fertig; ein Termin, der noch kommt, ist „Geplant“. Vorbei und nicht abgehakt: nichts. */
const visitLabel = (status: CustomerVisit['status'], vorbei: boolean): string =>
  status === 'cancelled' ? t('Abgesagt') : status === 'in-progress' ? t('Ist dran') : status === 'completed' ? t('Fertig') : vorbei ? '' : t('Geplant');
