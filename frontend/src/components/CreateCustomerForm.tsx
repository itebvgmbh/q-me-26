import { useState } from 'react';
import {
  Customer,
  activationExpired,
  activationLink,
  createCustomer,
  findCustomerByEmailAndShop,
  renewActivation,
} from '../utils/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { APP_BASE_PATH } from 'app';

interface Props {
  shopId: string;
  onCustomerCreated?: (customer: Customer) => void;
  /** Nach dem Anlegen: "Fertig" schließt den Dialog */
  onDone?: () => void;
}

const mailText = (customer: Customer, link: string) =>
  `Hallo ${customer.name},\n\n` +
  'hier ist dein Link für Dranzeit. Einmal öffnen und mit deinem Konto verbinden (oder schnell eins anlegen). ' +
  'Dann siehst du deine Termine bei uns und bekommst einen früheren Platz angeboten, wenn einer frei wird.\n\n' +
  `${link}\n`;

/** Kunde anlegen ("Mein Tag"): Eintrag für die Kundenliste plus Link, mit dem die Person ihr Konto verbindet */
export const CreateCustomerForm = ({ shopId, onCustomerCreated, onDone }: Props) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdCustomer, setCreatedCustomer] = useState<Customer | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Gibt es die Person schon (gleiche E-Mail), keinen zweiten Eintrag anlegen
      const existing = await findCustomerByEmailAndShop(email.trim(), shopId);
      let customer: Customer;
      if (existing) {
        // Abgelaufener Link: neuen erzeugen, sonst kommt die Person nie ans Ziel
        customer = activationExpired(existing) ? await renewActivation(existing) : existing;
        toast.info(`${customer.name} ist schon in deiner Kundenliste.`);
      } else {
        customer = await createCustomer({ shopId, name: name.trim(), email: email.trim(), phone: phone.trim() });
        toast.success('Kunde angelegt.');
      }

      setCreatedCustomer(customer);
      onCustomerCreated?.(customer);
      setName('');
      setEmail('');
      setPhone('');
    } catch (error) {
      console.error('Error creating customer:', error);
      toast.error('Der Kunde konnte nicht angelegt werden.');
    } finally {
      setLoading(false);
    }
  };

  if (createdCustomer) {
    const link = activationLink(createdCustomer, `${window.location.origin}${APP_BASE_PATH}`);
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast.success('Link kopiert.');
      } catch {
        toast.error('Kopieren klappt hier nicht. Markier den Link und kopier ihn von Hand.');
      }
    };
    const share = async () => {
      try {
        await navigator.share({ title: 'Dein Link für Dranzeit', text: mailText(createdCustomer, link).replace(`${link}\n`, ''), url: link });
      } catch {
        /* Teilen abgebrochen */
      }
    };
    const mailto = createdCustomer.email
      ? `mailto:${encodeURIComponent(createdCustomer.email)}?subject=${encodeURIComponent('Dein Link für Dranzeit')}&body=${encodeURIComponent(mailText(createdCustomer, link))}`
      : '';

    return (
      <div className="flex flex-col gap-4">
        {createdCustomer.userId ? (
          <p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <strong>{createdCustomer.name}</strong> hat das Konto schon verbunden. Termine, die du einträgst, stehen bei {createdCustomer.name} unter „Meine
            Termine“.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Schick {createdCustomer.name} diesen Link. Wer ihn öffnet und sich anmeldet (oder ein Konto anlegt), sieht die Termine, die du einträgst, unter
              „Meine Termine“ und bekommt frühere Plätze angeboten. Der Link gilt 30 Tage.
            </p>
            <p className="break-all rounded-2xl bg-muted p-3 font-mono text-sm" data-testid="activation-link">
              {link}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copy}>
                Link kopieren
              </Button>
              {typeof navigator.share === 'function' && (
                <Button variant="outline" onClick={share}>
                  Teilen
                </Button>
              )}
              {mailto && (
                <Button variant="outline" asChild>
                  <a href={mailto}>Per E-Mail schicken</a>
                </Button>
              )}
            </div>
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreatedCustomer(null)}>
            Weiteren Kunden anlegen
          </Button>
          {onDone && <Button onClick={onDone}>Fertig</Button>}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Max Mustermann" autoComplete="off" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-Mail</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="max@beispiel.de" autoComplete="off" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Telefon (freiwillig)</Label>
        <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 123 456789" autoComplete="off" />
      </div>

      <Button type="submit" disabled={loading} className="self-start">
        {loading ? 'Wird angelegt …' : 'Kunde anlegen'}
      </Button>
    </form>
  );
};
