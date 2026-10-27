import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { APP_BASE_PATH } from 'app';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

interface QRCodeDisplayProps {
  shopId: string;
  shopName?: string;
}

/** QR-Code zum Einreihen – lokal erzeugt, ohne fremden Dienst */
export const QRCodeDisplay = ({ shopId, shopName }: QRCodeDisplayProps) => {
  const url = `${window.location.origin}${APP_BASE_PATH}/public-join-queue?shopId=${shopId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('Link kopiert.'));
    } catch {
      toast.error(t('Kopieren ging nicht. Halte den Link gedrückt und kopier ihn von Hand.'));
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-foreground p-5 text-background" aria-labelledby="qr-titel">
      <div>
        <h3 id="qr-titel" className="font-display text-xl font-bold">{t('Einreihen per QR-Code')}</h3>
        <p className="text-sm text-background/75">{t('Ausdrucken und an Tür oder Tresen hängen. Kunden scannen und ziehen eine Nummer – ohne App.')}</p>
      </div>
      <div className="self-center rounded-2xl bg-white p-4">
        <QRCodeSVG
          value={url}
          size={176}
          level="M"
          title={shopName ? t('QR-Code zum Einreihen bei {laden}', { laden: shopName }) : t('QR-Code zum Einreihen bei deinem Laden')}
        />
      </div>
      <p dir="ltr" className="break-all text-xs text-background/60">{url}</p>
      <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
        <Button variant="signal" onClick={copy} className="sm:flex-1 lg:flex-none">
          {t('Link kopieren')}
        </Button>
        <Button variant="outline" className="border-background/40 text-background hover:bg-background hover:text-foreground sm:flex-1 lg:flex-none" asChild>
          <Link to={`/public-join-queue?shopId=${shopId}`}>{t('So sieht’s der Kunde')}</Link>
        </Button>
      </div>
    </section>
  );
};
