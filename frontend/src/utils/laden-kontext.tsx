import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useUserProfile } from './hooks/useUserProfile';
import { getShopById, getStaffEntriesByUserId, listShopsOfOwner, type Shop } from './firestore';
import { merkeLaden, waehleLaden } from './laden-wahl';

/**
 * Der gewählte Laden – einmal für die ganze App statt auf jeder Seite einzeln. Gewählt wird oben in der Kopfzeile
 * (components/LadenWahlKopf.tsx), die Seiten darunter zeigen nur diesen Laden.
 *  - Inhaber: seine Läden (Heute, Kalender, Laden mit Team, Leistungen, Tarif …)
 *  - Mitarbeiter: die Läden, in deren Team sie stehen („Mein Tag“)
 * Welcher: ?shopId= (bzw. ?staffId= bei Mitarbeitern, z. B. aus einer Push-Nachricht) auf den Seiten des Ladens, sonst
 * die Wahl in dieser Sitzung, sonst der zuletzt auf diesem Gerät gezeigte (utils/laden-wahl.ts).
 */

/** Seiten, die zum gewählten Laden gehören: nur dort steht die Auswahl in der Kopfzeile und zählt ?shopId= */
const LADEN_SEITEN = [
  '/shop-dashboard',
  '/kalender',
  '/shop-profile',
  '/staff-management',
  '/service-management',
  '/tarif',
  '/telefon-assistent',
  '/schnittstelle',
  '/auswertung',
  '/plakat',
  '/employee-dashboard',
  '/kunden',
];

export const istLadenSeite = (pathname: string) => LADEN_SEITEN.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export type LadenWahl = {
  /** Läden des Kontos; null, solange sie laden */
  laeden: Shop[] | null;
  laden: Shop | null;
  /** Laden ging nicht – nicht „kein Laden“ zeigen, das würde zum Anlegen eines zweiten verleiten */
  fehler: boolean;
  /** true: Läden als Inhaber; false: Läden, in deren Team das Konto steht */
  inhaber: boolean;
  waehle: (shopId: string) => void;
  /** Nach dem Bearbeiten den geänderten Laden übernehmen (Name in der Kopfzeile) */
  ersetze: (shop: Shop) => void;
};

const Kontext = createContext<LadenWahl | null>(null);

type Stand = { uid: string; inhaber: boolean; laeden: Shop[]; staffZuLaden: Record<string, string> };

export const LadenProvider = ({ children }: { children: ReactNode }) => {
  const { user, profile, loading } = useUserProfile();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const aufLadenSeite = istLadenSeite(pathname);
  const uid = user?.uid;
  const inhaber = profile?.role !== 'employee';

  // Erst laden, wenn eine Seite des Ladens gebraucht wird – Kunden und Startseite fragen nichts nach
  const [gebraucht, setGebraucht] = useState(aufLadenSeite);
  useEffect(() => {
    if (aufLadenSeite) setGebraucht(true);
  }, [aufLadenSeite]);

  const [stand, setStand] = useState<Stand | null>(null);
  const [fehler, setFehler] = useState(false);
  const [runde, setRunde] = useState(0);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);

  useEffect(() => {
    if (!gebraucht || loading || !uid) return;
    let aktiv = true;
    (async () => {
      try {
        let neu: Stand;
        if (inhaber) {
          neu = { uid, inhaber, laeden: await listShopsOfOwner(uid), staffZuLaden: {} };
        } else {
          const eintraege = await getStaffEntriesByUserId(uid);
          const ids = [...new Set(eintraege.map((e) => e.shopId))];
          // Für die Auswahl genügt der Name; fehlt der Laden (gesperrt), bleibt der Eintrag trotzdem wählbar
          const laeden = await Promise.all(
            ids.map(async (id) => (await getShopById(id).catch(() => null)) ?? ({ id, name: id } as Shop)),
          );
          laeden.sort((a, b) => a.name.localeCompare(b.name, 'de'));
          neu = { uid, inhaber, laeden, staffZuLaden: Object.fromEntries(eintraege.map((e) => [e.id, e.shopId])) };
        }
        if (aktiv) {
          setFehler(false);
          setStand(neu);
        }
      } catch (error) {
        console.error('Läden konnten nicht geladen werden:', error);
        if (aktiv) {
          setFehler(true);
          setStand({ uid, inhaber, laeden: [], staffZuLaden: {} });
        }
      }
    })();
    return () => {
      aktiv = false;
    };
  }, [gebraucht, loading, uid, inhaber, runde]);

  // Nach Abmelden oder Kontowechsel gilt der alte Stand nicht mehr
  const passend = stand && stand.uid === uid && stand.inhaber === inhaber ? stand : null;
  const laeden = passend?.laeden ?? null;

  const shopParam = aufLadenSeite ? searchParams.get('shopId') : null;
  const staffParam = aufLadenSeite ? searchParams.get('staffId') : null;
  const gewuenscht = shopParam ?? (staffParam ? passend?.staffZuLaden[staffParam] ?? null : null);

  const laden = useMemo(() => {
    if (!laeden) return null;
    return laeden.find((s) => s.id === gewuenscht) ?? laeden.find((s) => s.id === gewaehlt) ?? waehleLaden(laeden, null) ?? null;
  }, [laeden, gewuenscht, gewaehlt]);

  useEffect(() => {
    if (!laden) return;
    setGewaehlt(laden.id);
    merkeLaden(laden.id);
  }, [laden?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unbekannter Laden in der Adresse – gerade eingerichtet, übernommen oder neu ins Team geholt: einmal neu nachfragen
  const nachgefragt = useRef(new Set<string>());
  const unbekannt = laeden && ((shopParam && !laeden.some((s) => s.id === shopParam)) || (staffParam && !gewuenscht)) ? (shopParam ?? staffParam) : null;
  useEffect(() => {
    if (!unbekannt || nachgefragt.current.has(unbekannt)) return;
    nachgefragt.current.add(unbekannt);
    setStand(null);
    setRunde((r) => r + 1);
  }, [unbekannt]);

  const waehle = useCallback(
    (shopId: string) => {
      setGewaehlt(shopId);
      merkeLaden(shopId);
      // Sonst hielte ?shopId= bzw. ?staffId= in der Adresse den alten Laden fest
      if (searchParams.has('shopId') || searchParams.has('staffId')) {
        setSearchParams(
          (params) => {
            params.delete('shopId');
            params.delete('staffId');
            return params;
          },
          { replace: true },
        );
      }
    },
    [searchParams, setSearchParams],
  );

  const ersetze = useCallback(
    (shop: Shop) => setStand((s) => (s ? { ...s, laeden: s.laeden.map((l) => (l.id === shop.id ? { ...l, ...shop } : l)) } : s)),
    [],
  );

  const wert = useMemo<LadenWahl>(() => ({ laeden, laden, fehler, inhaber, waehle, ersetze }), [laeden, laden, fehler, inhaber, waehle, ersetze]);
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
};

/** Der gewählte Laden für Seiten innerhalb der App (router.tsx legt LadenProvider darum) */
export const useLadenWahl = (): LadenWahl => {
  const wahl = useContext(Kontext);
  if (!wahl) throw new Error('useLadenWahl außerhalb von LadenProvider');
  return wahl;
};

/** Für Seiten nur für Inhaber: Mitarbeiter haben dort keinen Laden (wie früher listShopsOfOwner → []) */
export const useInhaberLaden = (): LadenWahl => {
  const wahl = useLadenWahl();
  return wahl.inhaber ? wahl : { ...wahl, laeden: wahl.laeden && [], laden: null };
};

export type KopfLadenWahl = LadenWahl & { laden: Shop; laeden: Shop[] };

/**
 * Für die Kopfzeile (components/LadenWahlKopf.tsx): die Wahl, wenn es dort etwas zu wählen gibt – mehrere Läden und
 * eine Seite, die zum Laden gehört. Sonst null, auch ohne LadenProvider (Seite „nicht gefunden“). Bei einem Laden
 * steht sein Name auf der Seite.
 */
export const useKopfLadenWahl = (): KopfLadenWahl | null => {
  const wahl = useContext(Kontext);
  const { pathname } = useLocation();
  if (!wahl?.laden || !wahl.laeden || wahl.laeden.length < 2 || !istLadenSeite(pathname)) return null;
  return wahl as KopfLadenWahl;
};
