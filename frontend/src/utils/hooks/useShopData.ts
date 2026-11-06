import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Shop } from '../firestore';
import { liveLesen, LiveFehlt } from '../live';
import { inLadenliste } from '../marketplace';
import { t } from '@/i18n';

const ladenOderNull = async (id: string): Promise<Shop | null> => {
  try {
    return (await liveLesen<{ laden: Shop }>(`live/laden/${encodeURIComponent(id)}`)).laden;
  } catch (error) {
    if (error instanceof LiveFehlt) return null;
    throw error;
  }
};

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
  // Datenbank nicht erreichbar (nicht verwechseln mit "Shop gibt es nicht")
  const [loadError, setLoadError] = useState<unknown>(null);
  // Laden aus dem QR-Code vom Betreiber gesperrt: eigener Hinweis statt leerer Ladenliste
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    const loadShops = async () => {
      setLoading(true);
      setLoadError(null);
      setUnavailable(false);
      try {
        // Vom QR-Code nur diesen einen Laden laden statt aller Läden der Plattform (über das Backend, utils/live.ts).
        // Ohne Verbindung ein Fehler (Meldung „Keine Verbindung“), nicht „Laden nicht gefunden“.
        if (shopIdFromQR) {
          const laden = await ladenOderNull(shopIdFromQR);
          if (!active) return;
          if (laden?.suspended) {
            // Vom Betreiber gesperrt: PublicJoinQueue zeigt den Hinweis an Stelle der Ladenauswahl
            setUnavailable(true);
            setShops([]);
            setSelectedShop('');
            setArrivedFromQR(false);
            return;
          }
          if (laden) {
            setShops([laden]);
            setSelectedShop(laden.id);
            setArrivedFromQR(true);
            return;
          }
          console.error('Shop from QR code not found:', shopIdFromQR);
          toast.error(t('Der Laden aus dem QR-Code wurde nicht gefunden'));
          setSelectedShop('');
          setArrivedFromQR(false);
        }
        const { laeden } = await liveLesen<{ laeden: Shop[] }>('live/laeden');
        // Ausgeblendete Läden nur, wenn sie über den Link gewählt sind (inLadenliste, utils/marketplace.ts)
        if (active) setShops(laeden.filter((s) => inLadenliste(s) || (s.id === shopIdFromQR && !s.suspended)));
      } catch (error) {
        console.error('Error loading shops:', error);
        if (!active) return;
        setLoadError(error);
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
    loadError,
    unavailable,
    arrivedFromQR,
    setArrivedFromQR
  };
};
