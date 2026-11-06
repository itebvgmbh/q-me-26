import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ReasonAction {
  title: string;
  text: string;
  confirm: string;
  destructive?: boolean;
  /** Grund ist Pflicht (steht nur im Protokoll auf dem Server) */
  reason?: 'pflicht' | 'frei' | 'keiner';
  run: (reason: string) => Promise<unknown>;
  done: string;
}

/** Rückfrage vor einem Eingriff, auf Wunsch mit Grund fürs Protokoll */
export function ReasonDialog({ action, onClose, onDone }: { action: ReasonAction | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(''), [action]);

  const mode = action?.reason ?? 'frei';
  const missing = mode === 'pflicht' && reason.trim().length < 3;

  const submit = async () => {
    if (!action || missing) return;
    setBusy(true);
    try {
      await action.run(reason.trim());
      toast.success(action.done);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{action?.title}</DialogTitle>
          <DialogDescription className="text-base text-foreground/80">{action?.text}</DialogDescription>
        </DialogHeader>
        {mode !== 'keiner' && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="betreiber-grund">Grund {mode === 'pflicht' ? '(Pflicht)' : '(freiwillig)'}</Label>
            <Textarea
              id="betreiber-grund"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Steht nur im Protokoll, der Laden sieht ihn nicht."
              maxLength={500}
            />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant={action?.destructive ? 'destructive' : 'default'} onClick={submit} disabled={busy || missing}>
            {busy ? 'Einen Moment …' : action?.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
