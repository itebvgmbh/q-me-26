import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { CircleHelp, Menu, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { firebaseAuth } from 'app';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { Logo } from './brand/Logo';
import { useUserProfile } from '../utils/hooks/useUserProfile';
import { useIsBetreiber } from '../utils/betreiber';
import type { UserRole } from '../utils/types';

/** server: Seite kommt vom Backend (z. B. /hilfe) – normaler Link statt Router-Link */
type NavItem = { to: string; label: string; server?: boolean };

const LINKS: Record<UserRole | 'guest', NavItem[]> = {
  guest: [
    { to: '/shop-map', label: 'Läden finden' },
    { to: '/public-join-queue', label: 'Nummer ziehen' },
    { to: '/features', label: 'Für Läden' },
    { to: '/preise', label: 'Preise' },
    { to: '/hilfe', label: 'Hilfe', server: true },
  ],
  customer: [
    { to: '/my-bookings', label: 'Meine Termine' },
    { to: '/shop-map', label: 'Läden finden' },
    { to: '/public-join-queue', label: 'Nummer ziehen' },
  ],
  shopOwner: [
    { to: '/shop-dashboard', label: 'Tresen' },
    { to: '/employee-dashboard', label: 'Mein Tag' },
    { to: '/staff-management', label: 'Team' },
    { to: '/service-management', label: 'Leistungen' },
    { to: '/shop-profile', label: 'Mein Laden' },
    { to: '/tarif', label: 'Tarif' },
  ],
  employee: [
    { to: '/employee-dashboard', label: 'Mein Tag' },
    // Wer vorher Kunde war, behält seine eigenen Buchungen
    { to: '/my-bookings', label: 'Meine Termine' },
  ],
};

const PROFILE_PATH: Record<UserRole, string> = {
  customer: '/customer-profile',
  shopOwner: '/profile',
  employee: '/profile',
};

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex h-10 items-center rounded-full px-3 text-[15px] font-medium transition-colors lg:px-4',
    isActive ? 'bg-signal text-signal-foreground' : 'text-foreground hover:bg-foreground/5',
  );

/** Einheitliche Kopfzeile für alle Seiten, abhängig von der Rolle */
export function Navigation() {
  const navigate = useNavigate();
  const { user, profile, loading } = useUserProfile();
  const betreiber = useIsBetreiber();
  const [open, setOpen] = useState(false);

  const role: UserRole | 'guest' = user && profile ? profile.role : 'guest';
  const links = user && !profile ? [] : LINKS[role];
  const displayName = profile?.displayName || user?.displayName || user?.email || '';
  const initial = (displayName.trim()[0] || 'Q').toUpperCase();

  const handleLogout = async () => {
    setOpen(false);
    await firebaseAuth.signOut();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border print:hidden bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />

        <nav aria-label="Hauptnavigation" className="hidden items-center gap-1 md:flex">
          {links.map((item) =>
            item.server ? (
              // zwischen md und lg wäre die Zeile zu voll; dort steht die Hilfe in der Fußzeile
              <a key={item.to} href={item.to} className={cn(linkClass({ isActive: false }), 'hidden lg:inline-flex')}>
                {item.label}
              </a>
            ) : (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                {item.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="flex items-center gap-2">
          {!loading && !user && (
            <div className="hidden items-center gap-2 sm:flex">
              <Button variant="ghost" asChild>
                <Link to="/login">Anmelden</Link>
              </Button>
              <Button asChild>
                <Link to="/register-options">Registrieren</Link>
              </Button>
            </div>
          )}

          {user && (
            <a
              href="/hilfe"
              aria-label="Hilfe und Anleitungen"
              title="Hilfe und Anleitungen"
              className="hidden h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-foreground/5 sm:flex"
            >
              <CircleHelp className="h-6 w-6" aria-hidden="true" />
            </a>
          )}

          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Konto-Menü öffnen"
                  className="hidden h-11 w-11 items-center justify-center rounded-full bg-foreground font-display text-base font-bold text-signal sm:flex"
                >
                  {initial}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60 rounded-xl" align="end">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-semibold">{profile?.displayName || 'Dein Konto'}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {profile && (
                  <DropdownMenuItem onSelect={() => navigate(PROFILE_PATH[profile.role])}>
                    <UserRound className="mr-2 h-4 w-4" aria-hidden="true" />
                    Mein Profil
                  </DropdownMenuItem>
                )}
                {betreiber && (
                  <DropdownMenuItem onSelect={() => navigate('/betreiber')}>
                    <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                    Betreiber-Bereich
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                  Abmelden
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menü öffnen">
                <Menu className="h-6 w-6" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex w-[85vw] max-w-sm flex-col gap-6 bg-background">
              <SheetHeader className="text-left">
                <SheetTitle className="font-display text-2xl">Menü</SheetTitle>
              </SheetHeader>
              <nav aria-label="Hauptnavigation" className="flex flex-col gap-1">
                {links.map((item) =>
                  item.server ? (
                    <a key={item.to} href={item.to} className="flex h-12 items-center rounded-xl px-4 text-lg font-medium hover:bg-foreground/5">
                      {item.label}
                    </a>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex h-12 items-center rounded-xl px-4 text-lg font-medium',
                          isActive ? 'bg-signal text-signal-foreground' : 'hover:bg-foreground/5',
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  ),
                )}
                {profile && (
                  <NavLink to={PROFILE_PATH[profile.role]} onClick={() => setOpen(false)} className="flex h-12 items-center rounded-xl px-4 text-lg font-medium hover:bg-foreground/5">
                    Mein Profil
                  </NavLink>
                )}
                {betreiber && (
                  <NavLink to="/betreiber" onClick={() => setOpen(false)} className="flex h-12 items-center rounded-xl px-4 text-lg font-medium hover:bg-foreground/5">
                    Betreiber-Bereich
                  </NavLink>
                )}
                {user && (
                  <a href="/hilfe" className="flex h-12 items-center rounded-xl px-4 text-lg font-medium hover:bg-foreground/5">
                    Hilfe
                  </a>
                )}
              </nav>
              <div className="mt-auto flex flex-col gap-2">
                {user ? (
                  <Button variant="outline" size="lg" onClick={handleLogout}>
                    Abmelden
                  </Button>
                ) : (
                  <>
                    <Button size="lg" asChild>
                      <Link to="/register-options" onClick={() => setOpen(false)}>Registrieren</Link>
                    </Button>
                    <Button variant="outline" size="lg" asChild>
                      <Link to="/login" onClick={() => setOpen(false)}>Anmelden</Link>
                    </Button>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
