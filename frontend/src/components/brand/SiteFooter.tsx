import { Link } from 'react-router-dom';
import { useUserProfile } from '../../utils/hooks/useUserProfile';
import { Logo } from './Logo';
import { t } from '@/i18n';
import { SprachListe } from '../SprachWahl';
import { inStoreApp } from '../../utils/app-shell';
import { cookieEinstellungenOeffnen, statistikMoeglich } from '../../utils/statistik';

export const SiteFooter = () => {
  const { user, profile } = useUserProfile();
  // Im Laden (Inhaber, Team) keine Wege für Kunden wie „Nummer ziehen“ – dort zählen Hilfe und Rechtliches
  const team = Boolean(user) && (profile?.role === 'shopOwner' || profile?.role === 'employee');

  return (
    <footer className="border-t border-border print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo />
        <nav aria-label={t('Fußzeile')} className="flex flex-wrap gap-x-6 text-sm text-muted-foreground [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center">
          {team ? (
            <a href="/hilfe" className="hover:text-foreground">{t('Hilfe')}</a>
          ) : (
            <>
              <Link to="/shop-map" className="hover:text-foreground">{t('Läden finden')}</Link>
              <Link to="/public-join-queue" className="hover:text-foreground">{t('Nummer ziehen')}</Link>
              <Link to="/book-appointment" className="hover:text-foreground">{t('Termin buchen')}</Link>
              <Link to="/features" className="hover:text-foreground">{t('Für Läden')}</Link>
              {!inStoreApp() && <Link to="/preise" className="hover:text-foreground">{t('Preise')}</Link>}
              {!inStoreApp() && <Link to="/rechner" className="hover:text-foreground">{t('Ersparnis-Rechner')}</Link>}
              <a href="/hilfe" className="hover:text-foreground">{t('Hilfe')}</a>
              <a href="/friseur-ohne-termin" className="hover:text-foreground">{t('Friseur ohne Termin')}</a>
              {user ? (
                <Link to="/my-bookings" className="hover:text-foreground">{t('Meine Termine')}</Link>
              ) : (
                <Link to="/login" className="hover:text-foreground">{t('Anmelden')}</Link>
              )}
            </>
          )}
        </nav>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:items-end">
          <SprachListe />
          <nav aria-label={t('Rechtliches')} className="flex gap-x-5 [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center">
            <Link to="/impressum" className="hover:text-foreground">{t('Impressum')}</Link>
            <Link to="/datenschutz" className="hover:text-foreground">{t('Datenschutz')}</Link>
            <Link to="/agb" className="hover:text-foreground">{t('AGB')}</Link>
            {statistikMoeglich() && (
              <button type="button" onClick={cookieEinstellungenOeffnen} className="inline-flex min-h-11 items-center hover:text-foreground">
                {t('Cookie-Einstellungen')}
              </button>
            )}
          </nav>
          <p>© {new Date().getFullYear()} Dranzeit · ITEBV GmbH</p>
        </div>
      </div>
    </footer>
  );
};
