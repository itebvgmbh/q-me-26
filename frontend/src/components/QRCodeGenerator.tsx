import React, { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, Copy, Download, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { APP_BASE_PATH } from 'app';

interface Props {
  shopId: string;
  shopName: string;
}

export const QRCodeGenerator: React.FC<Props> = ({ shopId, shopName }) => {
  const qrCodeRef = useRef<HTMLDivElement>(null);
  const deployedAppUrl = window.location.origin + APP_BASE_PATH;
  // Der QR-Code muss auf /public-join-queue verweisen, damit die anonyme Buchung funktioniert
  const qrCodeUrl = `${deployedAppUrl}/public-join-queue?shopId=${shopId}`;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(qrCodeUrl);
      toast.success('Link in die Zwischenablage kopiert');
    } catch (error) {
      console.error('Fehler beim Kopieren:', error);
      toast.error('Fehler beim Kopieren in die Zwischenablage');
    }
  };

  const downloadQRCode = () => {
    if (!qrCodeRef.current) return;
    
    const svg = qrCodeRef.current.querySelector('svg');
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL('image/png');
      
      const downloadLink = document.createElement('a');
      downloadLink.download = `${shopName.replace(/\s+/g, '-')}-QR-Code.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  const shareQRCode = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${shopName} - Q-ME Warteschlange`,
          text: `Schnell und einfach in die Warteschlange von ${shopName} einreihen.`,
          url: qrCodeUrl
        });
        toast.success('QR-Code erfolgreich geteilt');
      } catch (error) {
        console.error('Fehler beim Teilen:', error);
        toast.error('Fehler beim Teilen des QR-Codes');
      }
    } else {
      toast.error('Web Share API wird von Ihrem Browser nicht unterstützt');
      copyToClipboard();
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-5 w-5" />
          QR-Code für Ihren Shop
        </CardTitle>
        <CardDescription>
          Kunden können diesen QR-Code scannen, um direkt zur Warteschlangen-Buchung zu gelangen.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <div ref={qrCodeRef} className="bg-white p-4 rounded-md mb-4">
          <QRCodeSVG 
            value={qrCodeUrl} 
            size={200}
            level="H"
            includeMargin
            imageSettings={{
              src: "",
              height: 24,
              width: 24,
              excavate: true
            }}
          />
        </div>
        <p className="text-xs text-center text-gray-500 max-w-xs mb-4">
          {qrCodeUrl}
        </p>
      </CardContent>
      <CardFooter className="flex justify-center gap-2">
        <Button variant="outline" size="sm" onClick={copyToClipboard}>
          <Copy className="h-4 w-4 mr-2" />
          Kopieren
        </Button>
        <Button variant="outline" size="sm" onClick={downloadQRCode}>
          <Download className="h-4 w-4 mr-2" />
          Herunterladen
        </Button>
        <Button variant="outline" size="sm" onClick={shareQRCode}>
          <Share2 className="h-4 w-4 mr-2" />
          Teilen
        </Button>
      </CardFooter>
    </Card>
  );
};
