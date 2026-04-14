import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { APP_BASE_PATH } from 'app';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface QRCodeDisplayProps {
  shopId: string;
}

export const QRCodeDisplay = ({ shopId }: QRCodeDisplayProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>QR-Code für Warteschlange</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center space-y-4">
        <div className="p-4 bg-white rounded-lg shadow-sm">
          {/* Log the URL to help debug iOS issues */}
          {console.log('QR code URL:', `${window.location.origin}${APP_BASE_PATH}/public-join-queue?shopId=${shopId}`)}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${window.location.origin}${APP_BASE_PATH}/public-join-queue?shopId=${shopId}`}
            alt="QR Code für Warteschlangen-Buchung"
            width={200}
            height={200}
          />
        </div>
        <p className="text-sm text-center text-gray-600">
          Kunden können diesen QR-Code scannen, um direkt zur Warteschlangen-Buchung zu gelangen.
        </p>
        <div className="flex flex-col space-y-2 w-full">
          <Button
            variant="outline"
            onClick={() => {
              // Use the same direct URL format as the QR code
              const qrUrl = `${window.location.origin}${APP_BASE_PATH}/public-join-queue?shopId=${shopId}`;
              console.log('Copied URL:', qrUrl);
              navigator.clipboard.writeText(qrUrl);
              toast.success('Link in die Zwischenablage kopiert');
            }}
          >
            Link kopieren
          </Button>
          <Link to={`/public-join-queue?shopId=${shopId}`} className="w-full">
            <Button variant="outline" className="w-full">Link testen</Button>
          </Link>
          <p className="text-xs text-center text-gray-500 mt-2">
            Drucken Sie den QR-Code aus und platzieren Sie ihn gut sichtbar in Ihrem Shop.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};