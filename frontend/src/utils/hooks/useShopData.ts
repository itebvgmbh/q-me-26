import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { Shop } from '../firestore';
import { firestore as db } from '../firestore-client';
import { isConnectionError, retryWithSimpleConnection } from '../connection';

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
        // Vom QR-Code nur diesen einen Shop laden statt aller Shops der Plattform.
        // "FromServer": ohne Verbindung ein Fehler statt still einer leeren Antwort.
        if (shopIdFromQR) {
          const snap = await getDocFromServer(doc(db, 'shops', shopIdFromQR));
          if (!active) return;
          if (snap.exists() && snap.data().suspended) {
            // Vom Betreiber gesperrt: PublicJoinQueue zeigt den Hinweis an Stelle der Ladenauswahl
            setUnavailable(true);
            setShops([]);
            setSelectedShop('');
            setArrivedFromQR(false);
            return;
          }
          if (snap.exists()) {
            setShops([{ id: snap.id, ...snap.data() } as Shop]);
            setSelectedShop(snap.id);
            setArrivedFromQR(true);
            return;
          }
          console.error('Shop from QR code not found:', shopIdFromQR);
          toast.error('Der Shop aus dem QR-Code wurde nicht gefunden');
          setSelectedShop('');
          setArrivedFromQR(false);
        }
        const snapshot = await getDocsFromServer(collection(db, 'shops'));
        if (active) setShops(snapshot.docs.filter((d) => !d.data().suspended).map((d) => ({ id: d.id, ...d.data() }) as Shop));
      } catch (error) {
        console.error('Error loading shops:', error);
        if (!active) return;
        if (isConnectionError(error) && retryWithSimpleConnection()) return;
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
