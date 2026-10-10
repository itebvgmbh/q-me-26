import { Link } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { Logo } from './Logo';

export const SiteFooter = () => {
  const { user } = useCurrentUser();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo />
        <nav aria-label="Fußzeile" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link to="/shop-map" className="hover:text-foreground">Shops finden</Link>
          <Link to="/public-join-queue" className="hover:text-foreground">In die Schlange</Link>
          <Link to="/features" className="hover:text-foreground">Für Betriebe</Link>
          {user ? (
            <Link to="/my-bookings" className="hover:text-foreground">Meine Termine</Link>
          ) : (
            <Link to="/login" className="hover:text-foreground">Anmelden</Link>
          )}
        </nav>
        <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} q-me</p>
      </div>
    </footer>
  );
};
