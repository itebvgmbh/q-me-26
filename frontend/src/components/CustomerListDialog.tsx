import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Customer, getCustomerEntries } from '../utils/firestore';
import { deleteCustomer } from '../utils/datenschutz';

interface Props {
  shopId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Kundenliste ("Mein Tag"): wen der Laden angelegt hat, mit Löschen. Fristen: backend/app/libs/privacy.py */
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
          <DialogTitle>Kundenliste</DialogTitle>
          <DialogDescription>
            Kunden, die in deinem Laden angelegt wurden. Ohne verbundenes Konto löscht Dranzeit einen Eintrag von selbst, wenn 12 Monate kein
            Termin war.
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <p className="text-sm text-muted-foreground">Die Kundenliste konnte nicht geladen werden. Versuch es gleich noch einmal.</p>
        ) : customers === null ? (
          <div className="h-24 animate-pulse rounded-2xl bg-muted" aria-busy="true" aria-label="Kundenliste wird geladen" />
        ) : customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Kunden angelegt.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {customers.map((c) => (
              <CustomerRow key={c.id} customer={c} onDeleted={() => setCustomers((list) => (list || []).filter((x) => x.id !== c.id))} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};

function CustomerRow({ customer, onDeleted }: { customer: Customer; onDeleted: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const contact = [customer.email, customer.phone].filter(Boolean).join(' · ');

  const remove = async () => {
    setBusy(true);
    try {
      const { cancelled } = await deleteCustomer(customer.id);
      toast.success(cancelled ? `${customer.name} gelöscht, ${cancelled} kommende${cancelled === 1 ? 'r Termin' : ' Termine'} abgesagt.` : `${customer.name} gelöscht.`);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{customer.name || 'Ohne Namen'}</span>
          {contact && <span className="block truncate text-xs text-muted-foreground">{contact}</span>}
          {customer.userId && <span className="block text-xs font-semibold">Konto verbunden</span>}
        </span>
        {!asking && (
          <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
            Löschen
          </Button>
        )}
      </div>
      {asking && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
          <p className="text-sm font-semibold">
            {customer.userId
              ? `${customer.name} verschwindet aus deiner Liste. Die Termine bleiben im Konto.`
              : `${customer.name} wird gelöscht. Kommende Termine werden abgesagt, frühere verlieren den Namen.`}
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" className="flex-1" onClick={remove} disabled={busy}>
              {busy ? 'Moment …' : 'Ja, löschen'}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setAsking(false)} disabled={busy}>
              Behalten
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
