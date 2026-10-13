import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Shop, getShopById, getShops } from '../firestore';

/**
 * Custom hook for fetching and managing shop data
 * @param shopIdFromQR Optional shop ID from QR code to preselect
 * @returns Shop data and selection state
 */
export const useShopData = (shopIdFromQR: string | null) => {
  const [shops, setShops] = useState<Shop[]>([]);
  // Vom QR-Code sofort vorauswählen: Leistungen und Personen laden dann gleichzeitig mit dem Shop
  const [selectedShop, setSelectedShop] = useState<string>(shopIdFromQR || '');
  const [loading, setLoading] = useState(true);
  const [arrivedFromQR, setArrivedFromQR] = useState(!!shopIdFromQR);

  useEffect(() => {
    let active = true;
    const loadShops = async () => {
      setLoading(true);
      try {
        // Vom QR-Code nur diesen einen Shop laden statt aller Shops der Plattform
        if (shopIdFromQR) {
          const shop = await getShopById(shopIdFromQR);
          if (!active) return;
          if (shop) {
            setShops([shop]);
            setSelectedShop(shop.id);
            setArrivedFromQR(true);
            return;
          }
          console.error('Shop from QR code not found:', shopIdFromQR);
          toast.error('Der Shop aus dem QR-Code wurde nicht gefunden');
          setSelectedShop('');
          setArrivedFromQR(false);
        }
        const allShops = await getShops();
        if (active) setShops(allShops);
      } catch (error) {
        console.error('Error loading shops:', error);
        if (active) toast.error('Fehler beim Laden der Shops');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadShops();
    return () => {
      active = false;
    };
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
