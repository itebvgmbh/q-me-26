import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserProfile } from '../utils/hooks/useUserProfile';
import { ersterStart, gespeichertesGeraet, startseite } from '../utils/geraet';

/**
 * Beim Start der App (Startseite, auch die vom Home-Bildschirm) gleich dorthin, wofür das Gerät da ist
 * (utils/geraet.ts): Tablet an den Tresen, Fernseher auf den Wartezimmer-Bildschirm – auch ohne Anmeldung.
 * Nur einmal je Sitzung, danach bleibt die Startseite erreichbar (Logo).
 */
export function GeraetStart() {
  const navigate = useNavigate();
  const { user, profile, loading } = useUserProfile();

  useEffect(() => {
    const geraet = gespeichertesGeraet();
    if (!geraet) return;
    if (geraet.rolle === 'bildschirm' && geraet.shopId) {
      if (ersterStart()) navigate(startseite(geraet, true), { replace: true });
      return;
    }
    if (loading || !user || !profile) return;
    if (profile.role !== 'shopOwner' && profile.role !== 'employee') return;
    if (ersterStart()) navigate(startseite(geraet, profile.role === 'shopOwner'), { replace: true });
  }, [loading, user, profile, navigate]);

  return null;
}
