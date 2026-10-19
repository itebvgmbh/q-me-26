import { Link } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { Logo } from './Logo';

export const SiteFooter = () => {
  const { user } = useCurrentUser();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo />
        <nav aria-label="Fußzeile" className="flex flex-wrap gap-x-6 text-sm text-muted-foreground [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center">
          <Link to="/shop-map" className="hover:text-foreground">Shops finden</Link>
          <Link to="/public-join-queue" className="hover:text-foreground">In die Schlange</Link>
          <Link to="/features" className="hover:text-foreground">Für Betriebe</Link>
          <Link to="/preise" className="hover:text-foreground">Preise</Link>
          {user ? (
            <Link to="/my-bookings" className="hover:text-foreground">Meine Termine</Link>
          ) : (
            <Link to="/login" className="hover:text-foreground">Anmelden</Link>
          )}
        </nav>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:items-end">
          <nav aria-label="Rechtliches" className="flex gap-x-5 [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center">
            <Link to="/impressum" className="hover:text-foreground">Impressum</Link>
            <Link to="/datenschutz" className="hover:text-foreground">Datenschutz</Link>
            <Link to="/agb" className="hover:text-foreground">AGB</Link>
          </nav>
          <p>© {new Date().getFullYear()} Dranzeit · ITEBV GmbH</p>
        </div>
      </div>
    </footer>
  );
};
