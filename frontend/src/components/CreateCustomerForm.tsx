import { useState } from 'react';
import { Customer, createActivationLink, createCustomer, findCustomerByEmailAndShop } from '../utils/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { t, tTeile } from '@/i18n';

interface Props {
  shopId: string;
  onCustomerCreated?: (customer: Customer) => void;
  /** Nach dem Anlegen: "Fertig" schließt den Dialog */
  onDone?: () => void;
}

const mailText = (customer: Customer, link: string) =>
  t(
    'Hallo {name},\n\nhier ist dein Link für Dranzeit. Einmal öffnen und mit deinem Konto verbinden (oder schnell eins anlegen). Dann siehst du deine Termine bei uns jederzeit unter „Meine Termine“.',
    { name: customer.name },
  ) + `\n\n${link}\n`;

/** Kunde anlegen ("Mein Tag"): Eintrag für die Kundenliste plus Link, mit dem die Person ihr Konto verbindet */
export const CreateCustomerForm = ({ shopId, onCustomerCreated, onDone }: Props) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdCustomer, setCreatedCustomer] = useState<Customer | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);

  /** Link vom Backend holen; klappt das nicht, bleibt der Eintrag und es gibt "Link erzeugen" zum Wiederholen */
  const fetchLink = async (customer: Customer) => {
    setLink('');
    setLinkError('');
    if (customer.userId) return; // schon verbunden, braucht keinen Link
    setLinkBusy(true);
    try {
      setLink((await createActivationLink(customer.id)).link);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : t('Der Link konnte nicht erzeugt werden.'));
    } finally {
      setLinkBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Gibt es die Person schon (gleiche E-Mail), keinen zweiten Eintrag anlegen
      const existing = await findCustomerByEmailAndShop(email.trim(), shopId);
      let customer: Customer;
      if (existing) {
        // Den alten Link kennt nur noch die Person (gespeichert ist sein Hash): Es gibt einen neuen, der alte gilt dann nicht mehr
        customer = existing;
        toast.info(t('{name} ist schon in deiner Kundenliste.', { name: customer.name }));
      } else {
        customer = await createCustomer({ shopId, name: name.trim(), email: email.trim(), phone: phone.trim() });
        toast.success(t('Kunde angelegt.'));
      }

      await fetchLink(customer);
      setCreatedCustomer(customer);
      onCustomerCreated?.(customer);
      setName('');
      setEmail('');
      setPhone('');
    } catch (error) {
      console.error('Error creating customer:', error);
      toast.error(t('Der Kunde konnte nicht angelegt werden.'));
    } finally {
      setLoading(false);
    }
  };

  if (createdCustomer) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast.success(t('Link kopiert.'));
      } catch {
        toast.error(t('Kopieren klappt hier nicht. Markier den Link und kopier ihn von Hand.'));
      }
    };
    const share = async () => {
      try {
        await navigator.share({ title: t('Dein Link für Dranzeit'), text: mailText(createdCustomer, link).replace(`${link}\n`, ''), url: link });
      } catch {
        /* Teilen abgebrochen */
      }
    };
    const mailto = createdCustomer.email
      ? `mailto:${encodeURIComponent(createdCustomer.email)}?subject=${encodeURIComponent(t('Dein Link für Dranzeit'))}&body=${encodeURIComponent(mailText(createdCustomer, link))}`
      : '';

    return (
      <div className="flex flex-col gap-4">
        {createdCustomer.userId ? (
          <p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            {tTeile(
              '<fett>{name}</fett> hat das Konto schon verbunden. Termine, die du einträgst, stehen bei {name} unter „Meine Termine“.',
              { fett: (inhalt) => <strong>{inhalt}</strong> },
              { name: createdCustomer.name },
            )}
          </p>
        ) : !link ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <p>
              {tTeile('<fett>{name}</fett> steht in deiner Kundenliste.', { fett: (inhalt) => <strong>{inhalt}</strong> }, { name: createdCustomer.name })}{' '}
              {linkError ? t('Den Link konnten wir gerade nicht erzeugen: {fehler}', { fehler: linkError }) : t('Der Link wird erzeugt …')}
            </p>
            <Button variant="outline" disabled={linkBusy} onClick={() => fetchLink(createdCustomer)}>
              {t('Link erzeugen')}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t(
                'Schick {name} diesen Link. Wer ihn öffnet und sich anmeldet (oder ein Konto anlegt), sieht die Termine, die du einträgst, unter „Meine Termine“. Hakst du beim Termin „Bei früherem freien Termin benachrichtigen“ an, bieten wir frühere Plätze an. Der Link gilt 30 Tage. Brauchst du ihn später noch einmal, leg {name} mit derselben E-Mail erneut an: Du bekommst einen neuen Link, der alte gilt dann nicht mehr.',
                { name: createdCustomer.name },
              )}
            </p>
            <p className="break-all rounded-2xl bg-muted p-3 font-mono text-sm" data-testid="activation-link" dir="ltr">
              {link}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copy}>
                {t('Link kopieren')}
              </Button>
              {typeof navigator.share === 'function' && (
                <Button variant="outline" onClick={share}>
                  {t('Teilen')}
                </Button>
              )}
              {mailto && (
                <Button variant="outline" asChild>
                  <a href={mailto}>{t('Per E-Mail schicken')}</a>
                </Button>
              )}
            </div>
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreatedCustomer(null)}>
            {t('Weiteren Kunden anlegen')}
          </Button>
          {onDone && <Button onClick={onDone}>{t('Fertig')}</Button>}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t('Name')}</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('Max Mustermann')} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t('E-Mail')}</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder={t('max@beispiel.de')} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">{t('Telefon (freiwillig)')}</Label>
        <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 123 456789" autoComplete="off" />
      </div>

      <Button type="submit" disabled={loading} className="self-start">
        {loading ? t('Wird angelegt …') : t('Kunde anlegen')}
      </Button>
    </form>
  );
};
