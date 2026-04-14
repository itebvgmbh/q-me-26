import { useState } from 'react';
import { toast } from 'sonner';

// UI Components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Types
import { Shop } from '../utils/firestore';

interface CreateShopFormProps {
  userId: string;
  onShopCreated: (shop: Shop) => void;
  createShop: (userId: string, shopData: any) => Promise<Shop>;
}

export const CreateShopForm = ({ userId, onShopCreated, createShop }: CreateShopFormProps) => {
  const [newShopData, setNewShopData] = useState({
    name: '',
    street: '',
    city: '',
    postalCode: '',
    phone: '',
    email: ''
  });

  const handleInputChange = (field: string, value: string) => {
    setNewShopData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    try {
      console.log('Creating shop with data:', { userId, ...newShopData });
      const createdShop = await createShop(userId, newShopData);
      console.log('Shop created successfully:', createdShop);
      onShopCreated(createdShop);
      toast.success('Shop erfolgreich erstellt');
    } catch (error: any) {
      console.error('Error creating shop:', error);
      toast.error('Fehler beim Erstellen des Shops: ' + (error.message || 'Unbekannter Fehler'));
    }
  };

  return (
    <form onSubmit={handleCreateShop} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Shop Name</Label>
        <Input
          id="name"
          value={newShopData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="street">Straße</Label>
        <Input
          id="street"
          value={newShopData.street}
          onChange={(e) => handleInputChange('street', e.target.value)}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="postalCode">PLZ</Label>
          <Input
            id="postalCode"
            value={newShopData.postalCode}
            onChange={(e) => handleInputChange('postalCode', e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="city">Ort</Label>
          <Input
            id="city"
            value={newShopData.city}
            onChange={(e) => handleInputChange('city', e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Telefon</Label>
        <Input
          id="phone"
          type="tel"
          value={newShopData.phone}
          onChange={(e) => handleInputChange('phone', e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">E-Mail</Label>
        <Input
          id="email"
          type="email"
          value={newShopData.email}
          onChange={(e) => handleInputChange('email', e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full">Shop erstellen</Button>
    </form>
  );
};