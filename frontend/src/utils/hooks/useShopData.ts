import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Shop, getShops } from '../firestore';

/**
 * Custom hook for fetching and managing shop data
 * @param shopIdFromQR Optional shop ID from QR code to preselect
 * @returns Shop data and selection state
 */
export const useShopData = (shopIdFromQR: string | null) => {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [arrivedFromQR, setArrivedFromQR] = useState(false);

  useEffect(() => {
    const loadShops = async () => {
      setLoading(true);
      try {
        const allShops = await getShops();
        setShops(allShops);
        
        // If shopId is provided in URL (from QR code), pre-select it
        if (shopIdFromQR) {
          const shopExists = allShops.some(shop => shop.id === shopIdFromQR);
          if (shopExists) {
            setSelectedShop(shopIdFromQR);
            setArrivedFromQR(true);
          } else {
            console.error('Shop from QR code not found:', shopIdFromQR);
            toast.error('Der Shop aus dem QR-Code wurde nicht gefunden');
          }
        }
        setLoading(false);
      } catch (error) {
        console.error('Error loading shops:', error);
        toast.error('Fehler beim Laden der Shops');
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
    setArrivedFromQR
  };
};
