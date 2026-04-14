import { useState } from 'react';
import { Customer, createCustomer, findCustomerByEmailAndShop } from '../utils/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { APP_BASE_PATH } from 'app';

interface Props {
  shopId: string;
  onCustomerCreated?: (customer: Customer) => void;
}

export const CreateCustomerForm = ({ shopId, onCustomerCreated }: Props) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdCustomer, setCreatedCustomer] = useState<Customer | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Suche zuerst, ob der Kunde bereits existiert
      if (email) {
        const existingCustomer = await findCustomerByEmailAndShop(email, shopId);
        if (existingCustomer) {
          // Kunde existiert bereits
          setCreatedCustomer(existingCustomer);
          if (onCustomerCreated) {
            onCustomerCreated(existingCustomer);
          }
          toast.info('Kunde existiert bereits und wurde abgerufen');
          return;
        }
      }
      
      // Wenn nicht gefunden, erstelle neuen Kunden
      const customerData = await createCustomer({
        shopId,
        name,
        email,
        phone,
      });

      setCreatedCustomer(customerData);
      if (onCustomerCreated) {
        onCustomerCreated(customerData);
      }
      toast.success('Kunde erfolgreich angelegt');

      // Reset form
      setName('');
      setEmail('');
      setPhone('');
    } catch (error) {
      console.error('Error creating customer:', error);
      toast.error('Fehler beim Anlegen des Kunden');
    } finally {
      setLoading(false);
    }
  };

  const getActivationLink = (customer: Customer) => {
    return `${window.location.origin}${APP_BASE_PATH}/activate?token=${customer.activationToken}`;
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Max Mustermann"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">E-Mail</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="max@beispiel.de"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Telefon (optional)</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+49 123 456789"
          />
        </div>

        <Button type="submit" disabled={loading}>
          {loading ? 'Wird angelegt...' : 'Kunde anlegen'}
        </Button>
      </form>

      {createdCustomer && (
        <div className="rounded-lg border p-4 space-y-2">
          <h3 className="font-medium">Kunde erfolgreich angelegt</h3>
          <p className="text-sm text-muted-foreground">
            Der Kunde kann sein Konto über folgenden Link aktivieren:
          </p>
          <div className="p-2 bg-muted rounded break-all text-sm font-mono">
            {getActivationLink(createdCustomer)}
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              navigator.clipboard.writeText(getActivationLink(createdCustomer));
              toast.success('Link in die Zwischenablage kopiert');
            }}
          >
            Link kopieren
          </Button>
        </div>
      )}
    </div>
  );
};
