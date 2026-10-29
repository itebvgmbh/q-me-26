import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listShopsOfOwner, Shop } from '../firestore';
import { merkeLaden, waehleLaden } from '../laden-wahl';

/**
 * Läden des Inhabers und der gewählte Laden (utils/laden-wahl.ts): ?shopId= aus der Adresse, sonst der zuletzt auf
 * diesem Gerät gezeigte – so bleibt die Wahl beim Neuladen und auf den anderen Seiten erhalten.
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
  const shop = useMemo(() => (shops ? (waehleLaden(shops, wanted) ?? null) : null), [shops, wanted]);
  useEffect(() => {
    if (shop) merkeLaden(shop.id);
  }, [shop]);

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
