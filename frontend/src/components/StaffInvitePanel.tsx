import { useState } from 'react';
import { Check, Copy, Link2, Mail, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { Staff } from '../utils/firestore';
import { createStaffInvite, StaffInviteResult } from '../utils/staff-invitation';

interface Props {
  /** Gespeicherter Stand der Person (E-Mail aus der Datenbank, nicht aus einem offenen Formular) */
  staff: Staff;
  /** Ergebnis einer Einladung, die gerade schon verschickt wurde (z. B. "Per E-Mail einladen") */
  initialResult?: StaffInviteResult | null;
  /** Die E-Mail im Formular ist geändert, aber noch nicht gespeichert */
  emailUnsaved?: boolean;
  onChanged?: () => void;
}

const day = (t?: { toDate: () => Date }) => (t ? t.toDate().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

/**
 * Einladung für eine Person im Team: Link erstellen und weitergeben oder per E-Mail schicken.
 * Ein neuer Link ersetzt den alten. Den Link zeigt die Box nur direkt nach dem Erstellen – gespeichert wird nur ein Hash.
 */
export const StaffInvitePanel = ({ staff, initialResult = null, emailUnsaved = false, onChanged }: Props) => {
  const [result, setResult] = useState<StaffInviteResult | null>(initialResult);
  const [busy, setBusy] = useState<'link' | 'mail' | null>(null);
  const [error, setError] = useState('');
  const email = (staff.email || '').trim();

  if (staff.userId) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="h-4 w-4 text-foreground" aria-hidden="true" />
        Hat ein Konto und sieht „Mein Tag“.
      </p>
    );
  }

  const invite = async (sendEmail: boolean) => {
    setBusy(sendEmail ? 'mail' : 'link');
    setError('');
    try {
      const res = await createStaffInvite(staff.id, sendEmail);
      setResult(res);
      if (sendEmail && res.email_sent) toast.success(`Einladung an ${email} verschickt.`);
      else if (sendEmail) toast.error('Die E-Mail ging nicht raus. Schick den Link selbst.');
      else toast.success('Einladungslink erstellt.');
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  };

  const copy = () =>
    navigator.clipboard.writeText(result!.link).then(
      () => toast.success('Link kopiert.'),
      () => toast.error('Kopieren ging nicht. Markier den Link und kopier ihn von Hand.'),
    );
  const share = () => navigator.share({ title: 'Einladung ins Team', text: 'Damit siehst du deinen Tag bei Dranzeit:', url: result!.link }).catch(() => {});
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const expires = staff.inviteExpires?.toDate();
  const status = staff.inviteCreatedAt
    ? expires && expires < new Date()
      ? `Die Einladung vom ${day(staff.inviteCreatedAt)} ist abgelaufen.`
      : `Eingeladen am ${day(staff.inviteCreatedAt)}${staff.inviteEmailSentAt ? ` per E-Mail an ${staff.inviteEmailTo}` : ''}, gilt bis ${day(staff.inviteExpires)}. Noch nicht angenommen.`
    : '';
  const again = Boolean(staff.inviteCreatedAt || result);

  return (
    <div className="flex flex-col gap-3" data-testid="staff-invite">
      <p className="text-sm text-muted-foreground">
        Mit dem Link legt die Person ihr Konto an (oder meldet sich mit ihrem an) und sieht danach unter „Mein Tag“ ihre Kunden.
      </p>
      {status && !result && <p className="text-sm">{status}</p>}

      {result && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/40 p-3">
          {result.email_sent ? (
            <p className="text-sm font-medium">E-Mail an {email} ist verschickt. Du kannst den Link auch selbst weitergeben:</p>
          ) : result.email_problem ? (
            <p role="alert" className="text-sm text-destructive">
              {result.email_problem} Schick {staff.name} den Link selbst, z. B. per WhatsApp oder SMS:
            </p>
          ) : (
            <p className="text-sm font-medium">Schick {staff.name} diesen Link, z. B. per WhatsApp oder SMS:</p>
          )}
          <a href={result.link} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary hover:underline" data-testid="invite-link">
            {result.link}
          </a>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Link kopieren
            </Button>
            {canShare && (
              <Button type="button" variant="outline" size="sm" onClick={share}>
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Teilen
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="sm:flex-1" disabled={!!busy} onClick={() => invite(false)}>
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {busy === 'link' ? 'Wird erstellt …' : again ? 'Neuen Link erstellen' : 'Einladungslink erstellen'}
        </Button>
        <Button type="button" variant="outline" className="sm:flex-1" disabled={!!busy || !email || emailUnsaved} onClick={() => invite(true)}>
          <Mail className="h-4 w-4" aria-hidden="true" />
          {busy === 'mail' ? 'Wird verschickt …' : again ? 'Neu per E-Mail schicken' : 'Per E-Mail schicken'}
        </Button>
      </div>
      {emailUnsaved ? (
        <p className="text-xs text-muted-foreground">Speichere zuerst die geänderte E-Mail. Die Einladung geht an die gespeicherte Adresse.</p>
      ) : !email ? (
        <p className="text-xs text-muted-foreground">Für die E-Mail trag eine Adresse ein und speichere. Den Link kannst du auch ohne weitergeben.</p>
      ) : again ? (
        <p className="text-xs text-muted-foreground">Ein neuer Link ersetzt den alten, der alte gilt dann nicht mehr. Jeder Link gilt 14 Tage.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Der Link gilt 14 Tage.</p>
      )}
    </div>
  );
};
