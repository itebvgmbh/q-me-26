import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { isEmail } from '../utils/auth-helpers';
import { Shop, Service, Staff, createStaff, findTeamMemberByEmail, teamEmailMessage } from '../utils/firestore';
import { defaultWorkingHours } from '../utils/staff-utils';
import { workingHoursFromOpening } from '../utils/opening-hours';
import { createStaffInvite, StaffInviteResult } from '../utils/staff-invitation';
import { StaffInvitePanel } from './StaffInvitePanel';

export interface InviteStaffDialogProps {
  /** Shop that the staff will be invited to */
  shop: Shop;
  /** Leistungen des Ladens – die neue Person bekommt erst einmal alle */
  services: Service[];
  /** Nach dem Schließen: Team neu laden */
  onStaffInvited: () => void;
}

/**
 * Kurzweg: Name und E-Mail eintragen, die Person steht sofort im Team (alle Leistungen, Arbeitszeiten wie die
 * Öffnungszeiten) und bekommt die Einladung per E-Mail. Danach zeigt der Dialog ehrlich, ob die E-Mail rausging,
 * und immer auch den Link zum selbst Weitergeben.
 */
export const InviteStaffDialog = ({ shop, services, onStaffInvited }: InviteStaffDialogProps) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ staff: Staff; result: StaffInviteResult | null } | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && done) {
      setDone(null);
      setName('');
      setEmail('');
      onStaffInvited();
    }
  };

  const handleSubmit = async () => {
    setError('');
    const mail = email.trim();
    if (!name.trim()) return setError('Bitte trag einen Namen ein. So sehen Kunden die Person bei der Buchung.');
    if (!isEmail(mail)) return setError('Die E-Mail stimmt nicht. Bitte prüf sie noch einmal.');
    setSaving(true);
    try {
      const existing = await findTeamMemberByEmail(shop.id, mail);
      if (existing) return setError(teamEmailMessage(existing));
      const staff = await createStaff({
        name: name.trim(),
        email: mail,
        phone: '',
        role: '',
        shopId: shop.id,
        workingHours: shop.businessHoursByDay?.length ? workingHoursFromOpening(shop.businessHoursByDay) : defaultWorkingHours,
        serviceIds: services.map((s) => s.id),
        isActive: true,
        profileImageUrl: '',
        status: 'available',
        userId: '',
      });
      // Die Person steht jetzt im Team; scheitert nur die Einladung, zeigt die Box den Fehler und Knöpfe zum Wiederholen
      let result: StaffInviteResult | null = null;
      try {
        result = await createStaffInvite(staff.id, true);
      } catch (e) {
        console.error('Einladung fehlgeschlagen:', e);
      }
      setDone({ staff, result });
    } catch (e) {
      console.error('Error creating staff:', e);
      setError('Anlegen hat nicht geklappt. Bitte noch einmal.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Per E-Mail einladen</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>{done.staff.name} ist im Team.</DialogTitle>
              <DialogDescription>
                {done.result?.email_sent
                  ? `Die Einladung ist an ${done.staff.email} unterwegs.`
                  : 'Die Einladung ist noch nicht angekommen. Unten steht, was du tun kannst.'}{' '}
                Leistungen und Arbeitszeiten passt du unter „Bearbeiten“ an.
              </DialogDescription>
            </DialogHeader>
            {!done.result && (
              <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Die Einladung konnte nicht erstellt werden. Versuch es unten noch einmal.
              </p>
            )}
            <StaffInvitePanel staff={done.staff} initialResult={done.result} />
            <Button variant="signal" className="w-full" onClick={() => handleOpenChange(false)}>
              Fertig
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Per E-Mail einladen</DialogTitle>
              <DialogDescription>
                Die Person steht sofort im Team und bekommt einen Link. Damit legt sie ihr Konto an (oder meldet sich mit ihrem an) und sieht unter „Mein Tag“ ihre Kunden.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="invite-name">Name</Label>
                <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Max Mustermann" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-email">E-Mail</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="max@beispiel.de"
                  aria-invalid={error ? true : undefined}
                />
              </div>
              {error && (
                <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? 'Wird verschickt …' : 'Einladung senden'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
