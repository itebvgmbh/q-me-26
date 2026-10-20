import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { probeDeletion, runDeletion, type DeletionProbe } from '../../utils/betreiber';

export interface DeleteTarget {
  shopId?: string;
  uid?: string;
  /** Inhaber-Konto, das mit dem Laden gehen kann (nur wenn es sonst keinen Laden hat) */
  ownerUid?: string;
  ownerEmail?: string;
}

const COLLECTION_LABEL: Record<string, string> = {
  services: 'Leistungen',
  staff: 'Team',
  'staff-invitations': 'Einladungen',
  'recurring-breaks': 'feste Pausen',
  breaks: 'Pausen',
  appointments: 'Termine und Nummern',
  customers: 'Kunden-Einträge',
  schedules: 'Arbeitszeiten',
  shop_days: 'Tageszähler',
  earlier_slot_notifications: 'Früher-dran-Angebote',
  queue: 'alte Warteschlange',
  push_subscriptions: 'Push-Abos',
};

/** Löschen mit Probelauf: erst zeigen, was wegginge und was es verhindert, dann Namen eintippen */
export function LoeschenDialog({ target, onClose, onDone }: { target: DeleteTarget | null; onClose: () => void; onDone: () => void }) {
  const [withOwner, setWithOwner] = useState(false);
  const [probe, setProbe] = useState<DeletionProbe | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const shopIds = target?.shopId ? [target.shopId] : [];
  const uids = target?.uid ? [target.uid] : withOwner && target?.ownerUid ? [target.ownerUid] : [];
  const key = `${shopIds.join()}|${uids.join()}`;

  useEffect(() => {
    if (!target) {
      setWithOwner(false);
      return;
    }
    setProbe(null);
    setError('');
    setConfirm('');
    probeDeletion(shopIds, uids)
      .then(setProbe)
      .catch((e) => setError(e instanceof Error ? e.message : 'Probelauf fehlgeschlagen.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, target]);

  const blocked = !probe || probe.problems.length > 0;
  const matches = probe && confirm.trim().toLowerCase() === probe.confirmWord.toLowerCase();

  const submit = async () => {
    if (!probe || blocked || !matches) return;
    setBusy(true);
    try {
      const res = await runDeletion(shopIds, uids, confirm.trim());
      if (res.left.length) toast.warning(`Gelöscht, aber es ist noch etwas übrig: ${res.left.join('; ')}`);
      else toast.success(`Gelöscht. Sicherung auf dem Server: ${res.backup}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Löschen hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{target?.shopId ? 'Laden löschen' : 'Konto löschen'}</DialogTitle>
          <DialogDescription className="text-base text-foreground/80">
            Endgültig. Vorher legt der Server eine Sicherung an; ein gelöschtes Konto lässt sich daraus aber nicht mit Passwort
            wiederherstellen. Kommende Termine werden abgesagt, frühere verlieren Namen und Kontakt.
          </DialogDescription>
        </DialogHeader>

        {target?.shopId && target.ownerUid && (
          <label className="flex items-start gap-3 rounded-2xl bg-muted p-3 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={withOwner} onChange={(e) => setWithOwner(e.target.checked)} />
            <span>
              Inhaber-Konto <strong>{target.ownerEmail || target.ownerUid}</strong> mitlöschen
            </span>
          </label>
        )}

        {error && <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {!probe && !error && <p className="text-sm text-muted-foreground">Probelauf läuft …</p>}

        {probe && (
          <div className="flex flex-col gap-3 text-sm">
            {probe.shops.map((s) => (
              <div key={s.id} className="rounded-2xl border border-border p-3">
                <p className="font-semibold">Laden „{s.name}“</p>
                <p className="text-muted-foreground">
                  {Object.entries(s.related)
                    .map(([name, n]) => `${n} ${COLLECTION_LABEL[name] || name}`)
                    .join(' · ') || 'sonst nichts'}
                </p>
              </div>
            ))}
            {probe.users.map((u) => (
              <div key={u.uid} className="rounded-2xl border border-border p-3">
                <p className="font-semibold">Konto {u.email || u.uid}</p>
                <p className="text-muted-foreground">
                  {u.appointments} Termine ohne Namen{u.upcoming ? ` (davon ${u.upcoming} kommend → abgesagt)` : ''} · {u.customers}{' '}
                  Kunden-Einträge · {u.push} Push-Abos{u.staff ? ` · ${u.staff} Team-Einträge werden vom Konto gelöst` : ''}
                </p>
              </div>
            ))}
            {probe.foundersFreed > 0 && <p>Gründerplätze, die wieder frei werden: {probe.foundersFreed}</p>}
            {probe.problems.length > 0 && (
              <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
                <p className="font-semibold">So geht es nicht:</p>
                <ul className="list-disc pl-5">
                  {probe.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!blocked && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="betreiber-loeschen">
                  Zur Bestätigung <strong>{probe.confirmWord}</strong> eintippen
                </Label>
                <Input id="betreiber-loeschen" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy || blocked || !matches}>
            {busy ? 'Wird gelöscht …' : 'Endgültig löschen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
