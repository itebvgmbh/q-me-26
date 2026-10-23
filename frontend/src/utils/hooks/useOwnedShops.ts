import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listShopsOfOwner, Shop } from '../firestore';

/**
 * Läden des Inhabers und der gewählte Laden. Gewählt ist ?shopId= aus der Adresse, sonst der erste –
 * so bleibt die Wahl beim Neuladen erhalten, und andere Seiten können direkt auf einen Laden verlinken.
 * shops ist null, solange geladen wird. Bei einem Fehler ist failed gesetzt (nicht "kein Laden" zeigen,
 * das würde zum Anlegen eines zweiten verleiten).
 */
export const useOwnedShops = (ownerId: string | undefined) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    listShopsOfOwner(ownerId)
      .then((list) => active && setShops(list))
      .catch((error) => {
        console.error('Error loading shops:', error);
        if (active) {
          setFailed(true);
          setShops([]);
        }
      });
    return () => {
      active = false;
    };
  }, [ownerId]);

  const wanted = searchParams.get('shopId');
  const shop = useMemo(() => shops?.find((s) => s.id === wanted) ?? shops?.[0] ?? null, [shops, wanted]);

  const selectShop = useCallback(
    (shopId: string) =>
      setSearchParams(
        (params) => {
          params.set('shopId', shopId);
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  /** Nach dem Bearbeiten den geänderten Laden in die Liste übernehmen */
  const replaceShop = useCallback((updated: Shop) => setShops((list) => list?.map((s) => (s.id === updated.id ? updated : s)) ?? list), []);

  return { shops, shop, selectShop, replaceShop, failed };
};
