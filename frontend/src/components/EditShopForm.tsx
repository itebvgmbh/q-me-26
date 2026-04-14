import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ShopProfile as ShopProfileType, updateShop } from '../utils/firestore';
import { uploadImage } from '../utils/firestore/storage';
import { INDUSTRIES } from '../utils/industries';
import { Loader2, Upload, X } from 'lucide-react';
import { BusinessHoursEditor } from './BusinessHoursEditor';
import { BusinessHoursDay } from '../utils/firestore/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
    description: shop?.description || '',
    businessHours: shop?.businessHours || '',
    businessHoursByDay: shop?.businessHoursByDay || [],
    industry: shop?.industry || '',
    logoUrl: shop?.logoUrl || '',
    timeSlotBuffer: shop?.timeSlotBuffer ?? 60000 // Standard: 1 Minute (60000 ms)
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
      toast.error(`Datei zu groß. Maximum: 1MB, Ihre Datei: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
      return;
    }
    
    // Nur Bilder zulassen
    if (!file.type.startsWith('image/')) {
      toast.error('Nur Bilddateien erlaubt');
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
    toast.loading('Logo wird hochgeladen...');
    
    try {
      // Logo direkt hochladen
      const logoUrl = await uploadImage(fileToUpload);
      
      // Form-Daten aktualisieren
      setFormData(prev => ({
        ...prev,
        logoUrl
      }));
      
      toast.success('Logo erfolgreich hochgeladen');
    } catch (error) {
      console.error('Upload fehlgeschlagen:', error);
      toast.error('Logo konnte nicht hochgeladen werden');
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

    setIsSubmitting(true);

    try {
      // Shop-Daten direkt aktualisieren
      const updatedShop = await updateShop(shop.id, formData);
      onUpdate(updatedShop);
      toast.success('Shop-Profil aktualisiert');
    } catch (error: any) {
      console.error('Error updating shop:', error);
      toast.error('Fehler beim Aktualisieren');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form id="edit-shop-form" onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Shop Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          required
        />
      </div>

      <div className="space-y-4">
        <Label htmlFor="street">Adressdaten</Label>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <Label htmlFor="street" className="text-xs">Straße und Hausnummer</Label>
            <Input
              id="street"
              value={formData.street}
              onChange={(e) => handleInputChange('street', e.target.value)}
              placeholder="Beispielstraße 123"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="postalCode" className="text-xs">Postleitzahl</Label>
              <Input
                id="postalCode"
                value={formData.postalCode}
                onChange={(e) => handleInputChange('postalCode', e.target.value)}
                placeholder="12345"
                required
              />
            </div>
            <div>
              <Label htmlFor="city" className="text-xs">Ort</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleInputChange('city', e.target.value)}
                placeholder="Berlin"
                required
              />
            </div>
          </div>
        </div>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="ownerName">Name des Inhabers</Label>
        <Input
          id="ownerName"
          value={formData.ownerName}
          onChange={(e) => handleInputChange('ownerName', e.target.value)}
          placeholder="Max Mustermann"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Telefon</Label>
        <Input
          id="phone"
          type="tel"
          value={formData.phone}
          onChange={(e) => handleInputChange('phone', e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">E-Mail</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => handleInputChange('email', e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Tabs defaultValue="advanced" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="simple">Einfach</TabsTrigger>
            <TabsTrigger value="advanced">Erweitert</TabsTrigger>
          </TabsList>
          <TabsContent value="simple" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="businessHours">Öffnungszeiten (einfach)</Label>
              <Input
                id="businessHours"
                value={formData.businessHours}
                onChange={(e) => handleInputChange('businessHours', e.target.value)}
                placeholder="z.B. 9:00-18:00"
              />
              <p className="text-sm text-gray-500">
                Einfaches Format für allgemeine Öffnungszeiten. Für tagesspezifische Zeiten, verwenden Sie die erweiterte Ansicht.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="advanced">
            <BusinessHoursEditor 
              businessHours={formData.businessHoursByDay as BusinessHoursDay[]}
              onChange={(hours) => setFormData(prev => ({ ...prev, businessHoursByDay: hours }))}
            />
          </TabsContent>
        </Tabs>
      </div>

      <div className="space-y-2">
        <Label htmlFor="industry">Branche</Label>
        <Select 
          value={formData.industry} 
          onValueChange={(value) => handleInputChange('industry', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Branche auswählen" />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((industry) => (
              <SelectItem key={industry.id} value={industry.id}>
                {industry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-gray-500 mt-1">
          Wählen Sie die Branche, die am besten zu Ihrem Geschäft passt.
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="logo">Shop Logo</Label>
        <div className="flex flex-col space-y-3">
          {/* Aktuelles Logo anzeigen */}
          {formData.logoUrl && (
            <div className="relative w-24 h-24 rounded-md overflow-hidden border border-gray-200">
              <img 
                src={formData.logoUrl} 
                alt="Shop Logo" 
                className="w-full h-full object-cover"
              />
              <button 
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, logoUrl: '' }))}
                className="absolute top-0 right-0 bg-black bg-opacity-50 text-white p-1 rounded-bl-md"
                aria-label="Logo entfernen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          
          <div className="flex items-center space-x-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isSubmitting}
              className="flex items-center space-x-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Wird hochgeladen...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Logo hochladen</span>
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
          <p className="text-sm text-gray-500">
            Maximale Größe: 1MB. Empfohlene Größe: 200x200 Pixel.
            {isUploading && <span className="block mt-1 text-blue-500">Upload läuft... Bitte warten Sie.</span>}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="timeSlotBuffer">Zeitpuffer für Termine (in Minuten)</Label>
        <Input
          id="timeSlotBuffer"
          type="number"
          min="1"
          max="120"
          value={String(Math.round((formData.timeSlotBuffer as number) / 60000))}
          onChange={(e) => {
            // Umrechnung von Minuten in Millisekunden
            const minutes = parseInt(e.target.value) || 1;
            const milliseconds = Math.max(1, Math.min(120, minutes)) * 60000;
            handleInputChange('timeSlotBuffer', String(milliseconds));
          }}
        />
        <p className="text-sm text-gray-500 mt-1">
          Definiert den minimalen Zeitabstand zwischen jetzt und dem frühestmöglichen Buchungszeitpunkt.
          Verhindert, dass Kunden Termine für die unmittelbare Zukunft buchen können.
          Empfohlen: 30-60 Minuten.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Beschreibung</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => handleInputChange('description', e.target.value)}
          placeholder="Beschreiben Sie Ihren Shop und Ihre Dienstleistungen..."
          className="h-32"
        />
      </div>

      <div className="flex justify-end space-x-2 pt-4 mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting || isUploading}
        >
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting || isUploading}>
          {isSubmitting ? 'Speichern...' : 'Änderungen speichern'}
        </Button>
      </div>
    </form>
  );
};
