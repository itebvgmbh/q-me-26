import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Stadtseiten, Salon-Verzeichnis, Hilfe und Einbau-Kasten liefert das Backend (backend/app/seo.py,
 * backend/app/verzeichnis_seiten.py, backend/app/hilfe, backend/app/einbau.py). Solange Caddy diese Pfade noch nicht ans Backend gibt (deploy/caddy-domain.py), landet der Aufruf
 * in der App – dann zum gleichen Inhalt unter /routes/seo.
 */
export default function StadtWeiterleitung() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.location.replace(`/routes/seo${pathname}${window.location.search}${window.location.hash}`);
  }, [pathname]);
  return <div className="mx-auto max-w-xl px-4 py-24 text-center text-muted-foreground">Einen Moment …</div>;
}
