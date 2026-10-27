import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { HilfeLink } from './HilfeLink';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { Shop as ShopProfileType, updateShop } from '../utils/firestore';
import { uploadImage } from '../utils/firestore/storage';
import { INDUSTRIES } from '../utils/industries';
import { Loader2, Upload, X } from 'lucide-react';
import { OpeningHoursEditor } from './OpeningHoursEditor';
import { defaultHours, hoursFromLegacy, hoursProblem, normalizeHours } from '../utils/opening-hours';
import { MAX_ONLINE_LEAD_MINUTES, onlineLeadMinutes } from '../utils/booking-rules';

interface Props {
  shop: ShopProfileType;
  onUpdate: (updatedShop: ShopProfileType) => void;
  onCancel: () => void;
}

export const EditShopForm = ({ shop, onUpdate, onCancel }: Props) => {
  const [formData, setFormData] = useState<Partial<ShopProfileType>>(() => ({
    name: shop?.name || '',
    street: shop?.street || shop?.address || '',
    city: shop?.city || '',
    postalCode: shop?.postalCode || '',
    ownerName: shop?.ownerName || '',
    phone: shop?.phone || '',
    email: shop?.email || '',
    website: shop?.website || '',
    description: shop?.description || '',
    businessHours: shop?.businessHours || '',
    businessHoursByDay: shop?.businessHoursByDay || [],
    industry: shop?.industry || '',
    logoUrl: shop?.logoUrl || '',
    // Vorlaufzeit für Online-Termine in ms (utils/booking-rules.ts); ältere Läden haben sie als Text
    timeSlotBuffer: onlineLeadMinutes(shop) * 60000
  }));
  
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Optimierte Logo-Upload-Funktion
  const handleLogoUpload = async (file: File) => {
    if (!file) return;
    
    // Dateigröße prüfen - max 1MB
    const MAX_SIZE = 1024 * 1024; // 1MB
    if (file.size > MAX_SIZE) {
      toast.error(t('Datei zu groß. Maximal 1 MB, deine Datei: {groesse}MB', { groesse: (file.size / (1024 * 1024)).toFixed(2) }));
      return;
    }
    
    // Nur Bilder zulassen
    if (!file.type.startsWith('image/')) {
      toast.error(t('Nur Bilddateien erlaubt'));
      return;
    }
    
    // Komprimiere das Bild, wenn es JPEG oder PNG ist
    let fileToUpload = file;
    if (file.type === 'image/jpeg' || file.type === 'image/png') {
      try {
        // Erstelle eine kleine Vorschau zur Komprimierung
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = document.createElement('img');
        
        // Lade das Bild
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = URL.createObjectURL(file);
        });
        
        // Berechne die neue Größe (max 200x200px)
        const MAX_DIM = 200;
        let width = img.width;
        let height = img.height;
        
        if (width > height && width > MAX_DIM) {
          height = Math.round(height * (MAX_DIM / width));
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width = Math.round(width * (MAX_DIM / height));
          height = MAX_DIM;
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Konvertiere Canvas zu Blob mit niedriger Qualität
        const blob = await new Promise<Blob | null>(
          (resolve) => canvas.toBlob(resolve, file.type, 0.7) // 70% Qualität
        );
        
        if (blob) {
          fileToUpload = new File([blob], file.name, { type: file.type });
          console.log(`Bild komprimiert von ${file.size}B auf ${fileToUpload.size}B`);
        }
        
        // Clean up
        URL.revokeObjectURL(img.src);
      } catch (error) {
        console.error('Fehler bei Bildkomprimierung:', error);
        // Weiter mit Originalfile
      }
    }
    
    setIsUploading(true);
    // Lade-Toast mit fester ID, damit Erfolg/Fehler ihn ersetzen (vorher blieb er für immer stehen)
    const toastId = toast.loading(t('Logo wird hochgeladen …'));
    
    try {
      // Vorher fehlte der Pfad – Logos landeten unter "undefined/…"
      const logoUrl = await uploadImage(fileToUpload, `shop-logos/${shop.id}`);
      
      // Form-Daten aktualisieren
      setFormData(prev => ({
        ...prev,
        logoUrl
      }));
      
      toast.success(t('Logo hochgeladen.'), { id: toastId });
    } catch (error) {
      console.error('Upload fehlgeschlagen:', error);
      toast.error(t('Das Logo konnte nicht hochgeladen werden.'), { id: toastId });
    } finally {
      setIsUploading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shop?.id) {
      console.error('No shop ID available');
      return;
    }
    // Ende vor Beginn o. Ä. würde den Tag sonst stillschweigend schließen
    if (formData.businessHoursByDay?.length) {
      const problem = hoursProblem(normalizeHours(formData.businessHoursByDay));
      if (problem) {
        toast.error(problem);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // Shop-Daten direkt aktualisieren
      const updatedShop = await updateShop(shop.id, formData);
      onUpdate(updatedShop);
      toast.success(t('Laden-Profil aktualisiert'));
    } catch (error: any) {
      console.error('Error updating shop:', error);
      toast.error(t('Fehler beim Aktualisieren'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form id="edit-shop-form" onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t('Name des Ladens')}</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          required
        />
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">{t('Adresse')}</p>
          <p className="text-sm text-muted-foreground">
            {t('Ohne Ort erscheint dein Laden nicht auf der Karte.')} <HilfeLink hilfe="gefunden-werden" />
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <Label htmlFor="street" className="text-xs">{t('Straße und Hausnummer')}</Label>
            <Input
              id="street"
              value={formData.street}
              onChange={(e) => handleInputChange('street', e.target.value)}
              placeholder={t('Beispielstraße 123')}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="postalCode" className="text-xs">{t('Postleitzahl')}</Label>
              <Input
                id="postalCode"
                value={formData.postalCode}
                onChange={(e) => handleInputChange('postalCode', e.target.value)}
                placeholder="12345"
              />
            </div>
            <div>
              <Label htmlFor="city" className="text-xs">{t('Ort')}</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleInputChange('city', e.target.value)}
                placeholder="Berlin"
              />
            </div>
          </div>
        </div>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="ownerName">{t('Name des Inhabers')}</Label>
        <Input
          id="ownerName"
          value={formData.ownerName}
          onChange={(e) => handleInputChange('ownerName', e.target.value)}
          placeholder={t('Max Mustermann')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">{t('Telefon')}</Label>
        <Input
          id="phone"
          type="tel"
          dir="ltr"
          value={formData.phone}
          onChange={(e) => handleInputChange('phone', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t('E-Mail')}</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => handleInputChange('email', e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="website">{t('Webseite')}</Label>
        <Input
          id="website"
          type="text"
          inputMode="url"
          dir="ltr"
          value={formData.website}
          onChange={(e) => handleInputChange('website', e.target.value)}
          placeholder={t('www.dein-laden.de')}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('Öffnungszeiten')}</Label>
        <p className="text-sm text-muted-foreground">
          {t('Gelten für den ganzen Laden. Wann jede Person arbeitet, stellst du unter „Team“ ein.')} <HilfeLink hilfe="oeffnungszeiten" />
        </p>
        {!formData.businessHoursByDay?.length && (
          <p className="text-sm text-muted-foreground">
            {formData.businessHours
              ? t('Noch keine Öffnungszeiten je Tag hinterlegt (bisher: {zeiten} an allen Tagen). Sobald du hier etwas änderst, gelten diese Zeiten.', { zeiten: formData.businessHours })
              : t('Noch keine Öffnungszeiten je Tag hinterlegt. Sobald du hier etwas änderst, gelten diese Zeiten.')}
          </p>
        )}
        <OpeningHoursEditor
          value={formData.businessHoursByDay?.length ? formData.businessHoursByDay : hoursFromLegacy(formData.businessHours) ?? defaultHours()}
          onChange={(hours) => setFormData((prev) => ({ ...prev, businessHoursByDay: hours }))}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="industry">{t('Branche')}</Label>
        <Select 
          value={formData.industry} 
          onValueChange={(value) => handleInputChange('industry', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('Branche auswählen')} />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((industry) => (
              <SelectItem key={industry.id} value={industry.id}>
                {t(industry.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground mt-1">
          {t('Hilft Kunden bei der Suche.')}
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="logo">{t('Logo')}</Label>
        <div className="flex flex-col space-y-3">
          {/* Aktuelles Logo anzeigen */}
          {formData.logoUrl && (
            <div className="relative w-24 h-24 rounded-md overflow-hidden border border-border">
              <img 
                src={formData.logoUrl} 
                alt={t('Logo des Ladens')} 
                className="w-full h-full object-cover"
              />
              <button 
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, logoUrl: '' }))}
                className="absolute top-0 end-0 bg-black bg-opacity-50 text-white p-1 rounded-es-md"
                aria-label={t('Logo entfernen')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          
          <div className="flex items-center space-x-2 rtl:space-x-reverse">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isSubmitting}
              className="flex items-center space-x-2 rtl:space-x-reverse"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('Wird hochgeladen...')}</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>{t('Logo hochladen')}</span>
                </>
              )}
            </Button>
          </div>
          
          <input
            type="file"
            id="logo"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLogoUpload(file);
              e.target.value = '';
            }}
          />
          <p className="text-sm text-muted-foreground">
            {t('Maximale Größe: 1MB. Empfohlene Größe: 200x200 Pixel.')}
            {isUploading && <span className="block mt-1 text-foreground">{t('Wird hochgeladen …')}</span>}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="timeSlotBuffer">{t('Vorlaufzeit für Online-Termine (Minuten)')}</Label>
        <Input
          id="timeSlotBuffer"
          type="number"
          inputMode="numeric"
          min="0"
          max={MAX_ONLINE_LEAD_MINUTES}
          step="5"
          className="w-32"
          value={String(Math.round(Number(formData.timeSlotBuffer || 0) / 60000))}
          onChange={(e) => {
            // In Minuten eingeben, in Millisekunden speichern (als Zahl, nicht als Text)
            const minutes = Math.max(0, Math.min(MAX_ONLINE_LEAD_MINUTES, parseInt(e.target.value, 10) || 0));
            setFormData((prev) => ({ ...prev, timeSlotBuffer: minutes * 60000 }));
          }}
          aria-describedby="timeSlotBuffer-hint"
        />
        <p id="timeSlotBuffer-hint" className="text-sm text-muted-foreground mt-1">
          {t('So weit im Voraus muss online gebucht werden. Bei 30 ist um 10:00 online frühestens 10:30 frei. Nummer ziehen und Termine, die du selbst einträgst, gehen immer sofort. 0 = keine Vorlaufzeit.')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{t('Beschreibung')}</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => handleInputChange('description', e.target.value)}
          placeholder={t('Was macht deinen Laden aus?')}
          className="h-32"
        />
      </div>

      <div className="flex justify-end space-x-2 pt-4 mt-4 rtl:space-x-reverse">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting || isUploading}
        >
          {t('Abbrechen')}
        </Button>
        <Button type="submit" disabled={isSubmitting || isUploading}>
          {isSubmitting ? t('Speichern...') : t('Änderungen speichern')}
        </Button>
      </div>
    </form>
  );
};
