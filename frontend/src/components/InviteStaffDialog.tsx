import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { isEmailInUse } from '../utils/auth-helpers';
import { Shop, createStaffInvitation } from '../utils/firestore';

/**
 * Props for InviteStaffDialog component
 */
export interface InviteStaffDialogProps {
  /** Shop that the staff will be invited to */
  shop: Shop;
  /** Callback function when staff invitation is successful */
  onStaffInvited: () => void;
}

/**
 * Dialog component for inviting new staff members via email
 * Creates a staff invitation and sends it to the specified email
 */
export const InviteStaffDialog = ({ shop, onStaffInvited }: InviteStaffDialogProps) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  /**
   * Handle invitation form submission
   */
  const handleSubmit = async () => {
    // Reset previous errors
    setEmailError(null);

    if (!email) {
      toast.error('Bitte geben Sie eine E-Mail-Adresse ein');
      return;
    }

    try {
      console.log('Checking if email is in use for invitation:', email);
      // Check if email is already in use
      const emailInUse = await isEmailInUse(email);
      console.log('Email in use result for invitation:', emailInUse);

      if (emailInUse) {
        console.log('Email already in use for invitation, showing error');
        const errorMessage = 'Diese E-Mail-Adresse wird bereits verwendet. Bitte wählen Sie eine andere E-Mail-Adresse.';
        toast.error(errorMessage, {
          duration: 5000,
          position: 'top-center',
          style: { background: '#f44336', color: 'white', fontWeight: 'bold' }
        });
        setEmailError(errorMessage);
        return;
      }

      const invitation = await createStaffInvitation(shop.id, email);
      // Email is now sent automatically in the createStaffInvitation function
      
      toast.success('Einladung erfolgreich erstellt und per E-Mail versendet');
      onStaffInvited();
      setOpen(false);
      setEmail('');
    } catch (error) {
      console.error('Error creating staff invitation:', error);
      toast.error('Fehler beim Erstellen der Einladung');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Mitarbeiter per E-Mail einladen</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neuen Mitarbeiter per E-Mail einladen</DialogTitle>
          <DialogDescription>
            Laden Sie einen neuen Mitarbeiter per E-Mail ein. Der Mitarbeiter erhält einen Link zur Registrierung.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
              placeholder="max@beispiel.de"
              className={emailError ? "border-red-500" : ""}
            />
            {emailError && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mt-2" role="alert">
                <strong className="font-bold">Fehler: </strong>
                <span className="block sm:inline">{emailError}</span>
              </div>
            )}
          </div>
          <Button onClick={handleSubmit} className="bg-primary hover:bg-primary/90 text-white font-bold">Einladung senden</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
