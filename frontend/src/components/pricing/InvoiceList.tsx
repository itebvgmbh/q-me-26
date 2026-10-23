import { useCallback, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadInvoice, listInvoices, type Invoice } from '../../utils/billing';

const euro = (cents: number) => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const day = (iso: string) => format(parseISO(iso), 'dd.MM.yyyy', { locale: de });

const STATUS_STYLE: Record<Invoice['status'], string> = {
  paid: 'bg-secondary text-secondary-foreground',
  open: 'bg-signal text-signal-foreground',
  uncollectible: 'bg-destructive text-destructive-foreground',
  void: 'bg-muted text-muted-foreground line-through',
};

/** Rechnungen des Ladens unter "Mein Tarif": PDF und E-Rechnung (XRechnung) zum Herunterladen */
export function InvoiceList({ shopId, refreshKey }: { shopId: string; refreshKey: string }) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    setError('');
    listInvoices(shopId)
      .then(setInvoices)
      .catch((e) => setError(e instanceof Error ? e.message : 'Die Rechnungen lassen sich gerade nicht laden.'));
  }, [shopId]);

  useEffect(() => {
    setInvoices(null);
    load();
  }, [load, refreshKey]);

  const download = async (invoice: Invoice, kind: 'pdf' | 'xrechnung') => {
    setBusy(`${invoice.id}-${kind}`);
    try {
      await downloadInvoice(shopId, invoice, kind);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="rechnungen">
      <div className="flex flex-col gap-1">
        <h2 id="rechnungen" className="font-display text-2xl font-extrabold">
          Rechnungen
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Das PDF ist dieselbe Rechnung, die du per E-Mail bekommst. Die E-Rechnung (XRechnung) liest dein
          Buchhaltungsprogramm oder dein Steuerbüro direkt ein, zum Beispiel DATEV, lexoffice oder sevDesk.
        </p>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-border bg-card p-5">
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>
            Nochmal versuchen
          </Button>
        </div>
      ) : invoices === null ? (
        <p className="text-sm text-muted-foreground">Rechnungen werden geladen …</p>
      ) : invoices.length === 0 ? (
        <p className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Noch keine Rechnung. Die erste kommt mit dem Beginn deines Abos, nach einer Testphase also erst danach.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-card px-5">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-display text-lg font-bold">
                  <span className="font-mono">{invoice.number}</span>
                  <span className={`rounded-full px-2.5 py-0.5 font-sans text-xs font-bold ${STATUS_STYLE[invoice.status] ?? ''}`}>
                    {invoice.statusText}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  vom {day(invoice.date)}
                  {invoice.periodStart && invoice.periodEnd && ` · Zeitraum ${day(invoice.periodStart)} bis ${day(invoice.periodEnd)}`}
                </p>
                <p className="text-sm">
                  <span className="font-mono">{euro(invoice.net)}</span> netto + <span className="font-mono">{euro(invoice.tax)}</span> USt. ={' '}
                  <span className="font-mono font-semibold">{euro(invoice.total)}</span>
                </p>
              </div>
              <div className="flex gap-2">
                {invoice.pdf && (
                  <Button variant="outline" size="sm" disabled={busy !== ''} onClick={() => download(invoice, 'pdf')}>
                    {busy === `${invoice.id}-pdf` ? 'Wird geladen …' : 'PDF'}
                  </Button>
                )}
                {invoice.einvoice && (
                  <Button variant="outline" size="sm" disabled={busy !== ''} onClick={() => download(invoice, 'xrechnung')}>
                    {busy === `${invoice.id}-xrechnung` ? 'Wird geladen …' : 'E-Rechnung'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
