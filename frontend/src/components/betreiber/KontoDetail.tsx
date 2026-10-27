import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  blockAccount,
  changeEmail,
  markVerified,
  sendPasswordMail,
  sendVerification,
  unblockAccount,
  type AdminAccount,
  type AdminShop,
} from '../../utils/betreiber';
import { ReasonDialog, type ReasonAction } from './ReasonDialog';
import { LoeschenDialog, type DeleteTarget } from './LoeschenDialog';
import { Fact, Section } from './LadenDetail';
import { ROLE_LABEL, fmtDateTime } from './format';

const VERIFY_STATUS: Record<string, string> = {
  verschickt: 'Bestätigungs-Mail verschickt.',
  bestaetigt: 'Die Adresse ist schon bestätigt.',
  testadresse: 'Testadresse – es geht keine Mail raus.',
  nicht_eingerichtet: 'Mailversand ist noch nicht eingerichtet (RESEND_API_KEY fehlt auf dem Server).',
};

/** Ein Konto im Betreiber-Bereich: Stand, Läden, Eingriffe */
export function KontoDetail({
  account,
  shopsById,
  onOpenShop,
  onChanged,
}: {
  account: AdminAccount;
  shopsById: Map<string, AdminShop>;
  onOpenShop: (id: string) => void;
  onChanged: () => void;
}) {
  const [action, setAction] = useState<ReasonAction | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [email, setEmail] = useState(account.email);
  const [busy, setBusy] = useState('');
  const isAdmin = account.markers.includes('BETREIBER');

  const run = async (key: string, fn: () => Promise<string | void>, done: string) => {
    setBusy(key);
    try {
      const message = await fn();
      toast.success(message || done);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy('');
    }
  };

  const shopLink = (id: string) => {
    const s = shopsById.get(id);
    return (
      <button key={id} type="button" className="text-start font-medium underline underline-offset-2" onClick={() => onOpenShop(id)}>
        {s ? `${s.name}${s.city ? `, ${s.city}` : ''}` : `Laden ${id} (gibt es nicht mehr)`}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Konto {account.nr} · {account.uid}
        </p>
        <h2 className="break-all font-display text-3xl font-extrabold tracking-[-0.02em]">{account.email || '(ohne E-Mail)'}</h2>
        {account.name && <p className="text-muted-foreground">{account.name}</p>}
        <div className="flex flex-wrap gap-1.5">
          {account.disabled && (
            <span className="rounded-full bg-destructive px-2.5 py-0.5 text-xs font-bold text-destructive-foreground">
              {account.blockedByAdmin ? 'Konto gesperrt' : 'Anmeldung gesperrt'}
            </span>
          )}
          {account.markers.filter((m) => m !== 'GESPERRT').map((m) => (
            <span key={m} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">
              {m}
            </span>
          ))}
        </div>
      </header>

      <Section title="Stand">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Fact label="Rolle">{ROLE_LABEL[account.role] || account.role}</Fact>
          <Fact label="E-Mail">{account.emailVerified === null ? '–' : account.emailVerified ? 'bestätigt' : 'unbestätigt'}</Fact>
          <Fact label="Angelegt">{fmtDateTime(account.created)}</Fact>
          <Fact label="Zuletzt angemeldet">{fmtDateTime(account.lastSignIn)}</Fact>
          <Fact label="Termine/Nummern als Kunde">
            {account.appointments}
            {account.upcoming ? ` (${account.upcoming} kommend)` : ''}
          </Fact>
          <Fact label="Anmeldung">{account.auth ? account.providers.join(', ') || 'Passwort' : 'kein Firebase-Konto'}</Fact>
        </dl>
        {account.shops.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Inhaber von</span>
            {account.shops.map(shopLink)}
          </div>
        )}
        {account.staff.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Im Team von</span>
            {account.staff.map((s) => shopLink(s.shopId))}
          </div>
        )}
      </Section>

      {account.auth && (
        <Section title="Anmeldung und E-Mail">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== '' || !account.email}
              onClick={() => run('pw', async () => `Passwort-Mail an ${await sendPasswordMail(account.uid)} verschickt.`, '')}
            >
              {busy === 'pw' ? 'Wird verschickt …' : 'Passwort-Mail schicken'}
            </Button>
            {!account.emailVerified && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== ''}
                  onClick={() => run('verify', async () => VERIFY_STATUS[(await sendVerification(account.uid)).status], '')}
                >
                  Bestätigungs-Mail schicken
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== ''} onClick={() => run('mark', () => markVerified(account.uid, true).then(() => undefined), 'Als bestätigt markiert.')}>
                  Als bestätigt markieren
                </Button>
              </>
            )}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run('email', async () => {
                const r = await changeEmail(account.uid, email);
                return r.changed ? `Neue Adresse ${r.email} – sie gilt jetzt als unbestätigt.` : 'Die Adresse war schon so.';
              }, '');
            }}
          >
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
              <Label htmlFor="konto-email">Anmelde-Adresse ändern</Label>
              <Input id="konto-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={busy !== '' || email.trim().toLowerCase() === account.email.toLowerCase()}>
              Ändern
            </Button>
          </form>
        </Section>
      )}

      {account.auth && !isAdmin && (
        <Section title="Sperren" tone="danger">
          {account.disabled ? (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() =>
                setAction({
                  title: 'Konto entsperren?',
                  text: 'Die Person kann sich wieder anmelden.',
                  confirm: 'Entsperren',
                  run: (reason) => unblockAccount(account.uid, reason),
                  done: 'Konto entsperrt.',
                })
              }
            >
              Entsperren …
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              className="w-fit"
              onClick={() =>
                setAction({
                  title: 'Konto sperren?',
                  text: 'Die Person wird abgemeldet und kommt nicht mehr hinein. Läden und Termine bleiben, wie sie sind.',
                  confirm: 'Sperren',
                  destructive: true,
                  reason: 'pflicht',
                  run: (reason) => blockAccount(account.uid, reason),
                  done: 'Konto gesperrt.',
                })
              }
            >
              Konto sperren …
            </Button>
          )}
        </Section>
      )}

      {!isAdmin && (
        <Section title="Löschen" tone="danger">
          {account.shops.length ? (
            <p className="text-sm text-muted-foreground">Inhaber-Konten gehen nur zusammen mit dem Laden: dort „Laden löschen“ und das Konto mitnehmen.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Wie „Konto löschen“ im Profil: kommende Termine abgesagt, frühere ohne Namen. Team-Einträge werden vom Konto gelöst.
              </p>
              <Button size="sm" variant="destructive" className="w-fit" onClick={() => setDeleting({ uid: account.uid })}>
                Konto löschen …
              </Button>
            </>
          )}
        </Section>
      )}

      <ReasonDialog action={action} onClose={() => setAction(null)} onDone={onChanged} />
      <LoeschenDialog target={deleting} onClose={() => setDeleting(null)} onDone={onChanged} />
    </div>
  );
}
