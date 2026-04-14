import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ShopProfile as ShopProfileType, updateShop } from '../utils/firestore';

interface Props {
  shop: ShopProfileType;
  onUpdate: (updatedShop: ShopProfileType) => void;
  onCancel: () => void;
}

export const ShopProfileForm = ({ shop, onUpdate, onCancel }: Props) => {
  const [formData, setFormData] = useState<Partial<ShopProfileType>>(() => ({
    name: shop?.name || '',
    address: shop?.address || '',
    phone: shop?.phone || '',
    email: shop?.email || '',
    description: shop?.description || '',
    businessHours: shop?.businessHours || ''
  }));

  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const updatedShop = await updateShop(shop.id, formData);
      onUpdate(updatedShop);
      toast.success('Shop-Profil erfolgreich aktualisiert');
    } catch (error: any) {
      console.error('Error updating shop:', error);
      toast.error('Fehler beim Aktualisieren: ' + (error.message || 'Unbekannter Fehler'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Shop Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Adresse</Label>
        <Input
          id="address"
          value={formData.address}
          onChange={(e) => handleInputChange('address', e.target.value)}
          required
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
        <Label htmlFor="businessHours">Öffnungszeiten</Label>
        <Input
          id="businessHours"
          value={formData.businessHours}
          onChange={(e) => handleInputChange('businessHours', e.target.value)}
          placeholder="z.B. Mo-Fr 9:00-18:00, Sa 9:00-14:00"
        />
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

      <div className="flex justify-end space-x-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Speichern...' : 'Änderungen speichern'}
        </Button>
      </div>
    </form>
  );
};


