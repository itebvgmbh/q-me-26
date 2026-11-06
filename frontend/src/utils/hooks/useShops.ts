
import { useState, useEffect } from 'react';
import { Shop, getShops } from '../firestore';
import { toast } from 'sonner';
import { t } from '@/i18n';

/**
 * Hook to fetch and manage shops
 * @param shopIdFromQR Optional shop ID from QR code to preselect
 * @returns Object containing shops data and state
 */
export const useShops = (shopIdFromQR: string | null) => {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [arrivedFromQR, setArrivedFromQR] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Effect to load shops and handle QR code selection
  useEffect(() => {
    const loadShops = async () => {
      setLoading(true);
      try {
        const allShops = await getShops();
        setShops(allShops);
        setError(null);
        
        // If shopId is provided in URL (from QR code), pre-select it
        if (shopIdFromQR) {
          const shopExists = allShops.some(shop => shop.id === shopIdFromQR);
          if (shopExists) {
            setSelectedShop(shopIdFromQR);
            setArrivedFromQR(true);
          } else {
            console.error('Shop from QR code not found:', shopIdFromQR);
            toast.error(t('Der Laden aus dem QR-Code wurde nicht gefunden'));
            setError(new Error('Shop from QR code not found'));
          }
        }
      } catch (error) {
        console.error('Error loading shops:', error);
        setError(error instanceof Error ? error : new Error('Failed to load shops'));
        toast.error(t('Die Läden konnten nicht geladen werden.'));
      } finally {
        setLoading(false);
      }
    };

    loadShops();
  }, [shopIdFromQR]);

  return {
    shops,
    selectedShop,
    setSelectedShop,
    loading,
    arrivedFromQR,
    setArrivedFromQR,
    error
  };
};
