import { useEffect } from 'react';
import { useCurrentUser } from 'app';
import { linkAnonymousBookingsToUser } from '../utils/AnonymousBookingLinker';

/**
 * Diese Komponente beobachtet den Authentifizierungsstatus und verknüpft
 * anonyme Buchungen, wenn sich ein Benutzer anmeldet.
 */
export const AnonymousBookingHandler: React.FC = () => {
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    // Wir wollen nur handeln, wenn der Benutzer sich gerade angemeldet hat
    // (nicht bei jedem Render) und das Loading abgeschlossen ist
    if (user && !loading) {
      console.log('Benutzer hat sich angemeldet, prüfe auf anonyme Buchungen:', user.uid);
      linkAnonymousBookingsToUser(user.uid);
    }
  }, [user, loading]);

  // Diese Komponente rendert nichts sichtbares
  return null;
};
