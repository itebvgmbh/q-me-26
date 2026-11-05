import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { probeTestCleanup, runTestCleanup, type TestCleanupProbe } from '../../utils/betreiber';

/**
 * „Testkonten aufräumen“: alle Konten mit Testadresse (Testskripte, @example.com u. ä.) samt ihren Läden und verwaiste
 * Testläden auf einmal (backend/app/libs/konten.py test_cleanup). Erst der Probelauf mit der Liste, gelöscht wird genau
 * diese Liste – mit Sicherung auf dem Server wie beim einzelnen Löschen (LoeschenDialog.tsx).
 */
export function TestkontenDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [probe, setProbe] = useState<TestCleanupProbe | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProbe(null);
    setError('');
    setConfirm('');
    probeTestCleanup()
      .then(setProbe)
      .catch((e) => setError(e instanceof Error ? e.message : 'Probelauf fehlgeschlagen.'));
  }, [open]);

  const empty = probe !== null && probe.uids.length === 0 && probe.shopIds.length === 0;
  const blocked = !probe || empty || probe.problems.length > 0;
  const matches = probe && confirm.trim().toLowerCase() === probe.confirmWord.toLowerCase();
  const upcoming = probe?.users.reduce((n, u) => n + u.upcoming, 0) ?? 0;
  // E-Mails im Probelauf sind klein geschrieben, am Laden wie angelegt
  const shopsOf = (email: string) => probe?.shops.filter((s) => (probe.owners[s.id] || '').toLowerCase() === email.toLowerCase()) ?? [];
  const orphans = probe ? shopsOf('') : [];

  const submit = async () => {
    if (!probe || blocked || !matches) return;
    setBusy(true);
    try {
      const res = await runTestCleanup(probe.uids, probe.shopIds, confirm.trim());
      if (res.left.length) toast.warning(`Aufgeräumt, aber es ist noch etwas übrig: ${res.left.join('; ')}`);
      else {
        const konten = res.result.accounts === 1 ? '1 Konto' : `${res.result.accounts} Konten`;
        const laeden = res.result.shops === 1 ? '1 Laden' : `${res.result.shops} Läden`;
        toast.success(`${konten} und ${laeden} gelöscht. Sicherung auf dem Server: ${res.backup}`);
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Aufräumen hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Testkonten aufräumen</DialogTitle>
          <DialogDescription className="text-base text-foreground/80">
            Löscht alle Konten mit Testadresse (aus den Testskripten, @example.com) samt ihren Läden, dazu verwaiste Testläden.
            Endgültig; vorher legt der Server eine Sicherung an. Echte Konten, Betreiber, die ITEBV GmbH und Läden mit Abo bleiben.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {!probe && !error && <p className="text-sm text-muted-foreground">Probelauf läuft …</p>}
        {empty && <p className="rounded-2xl bg-muted p-3 text-sm">Keine Testkonten da – nichts zu tun.</p>}

        {probe && !empty && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="font-semibold">
              Weg gehen {probe.users.length} {probe.users.length === 1 ? 'Konto' : 'Konten'} und {probe.shops.length}{' '}
              {probe.shops.length === 1 ? 'Laden' : 'Läden'}
              {upcoming > 0 && <span className="font-normal"> · {upcoming} kommende Termine werden abgesagt</span>}
            </p>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-2xl border border-border p-3" aria-label="Was gelöscht wird">
              {probe.users.map((u) => (
                <li key={u.uid}>
                  <p className="break-all font-semibold">{u.email || u.uid}</p>
                  <p className="text-muted-foreground">
                    {shopsOf(u.email)
                      .map((s) => s.name)
                      .join(', ') || 'kein Laden'}
                    {u.appointments ? ` · ${u.appointments} eigene Termine ohne Namen` : ''}
                    {u.staff ? ` · ${u.staff} Team-Einträge vom Konto gelöst` : ''}
                  </p>
                </li>
              ))}
              {orphans.map((s) => (
                <li key={s.id}>
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-muted-foreground">Laden ohne Inhaber-Konto</p>
                </li>
              ))}
            </ul>
            {probe.skipped.length > 0 && (
              <div className="rounded-2xl bg-muted p-3">
                <p className="font-semibold">Bleiben, obwohl Testadresse:</p>
                <ul className="list-disc ps-5">
                  {probe.skipped.map((s) => (
                    <li key={s.label} className="break-all">
                      {s.label} – {s.why}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {probe.problems.length > 0 && (
              <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
                <p className="font-semibold">So geht es nicht:</p>
                <ul className="list-disc ps-5">
                  {probe.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!blocked && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="testkonten-loeschen">
                  Zur Bestätigung <strong>{probe.confirmWord}</strong> eintippen
                </Label>
                <Input id="testkonten-loeschen" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {empty ? 'Schließen' : 'Abbrechen'}
          </Button>
          {!empty && (
            <Button variant="destructive" onClick={submit} disabled={busy || blocked || !matches}>
              {busy ? 'Wird aufgeräumt …' : 'Endgültig löschen'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
