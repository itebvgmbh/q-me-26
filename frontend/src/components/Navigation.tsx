import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { CircleHelp, Menu, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { anmeldung, nurTresen } from 'app';
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
import { useKopfLadenWahl } from '../utils/laden-kontext';
import { useUserProfile } from '../utils/hooks/useUserProfile';
import { useIsBetreiber } from '../utils/betreiber';
import type { UserRole } from '../utils/types';
import { inStoreApp } from '../utils/app-shell';
import { stopTeamPushBeforeLogout } from '../utils/team-push';
import { istRtl, t } from '@/i18n';
import MENUE from '../navigation.json';
import { SprachListe, SprachMenue } from './SprachWahl';

/**
 * Menüpunkte stehen in navigation.json – dieselbe Liste nutzt das Backend für die Kopfzeile seiner Seiten (Hilfe,
 * /friseur …, backend/app/kopfzeile.py), damit man dort im selben Menü bleibt.
 * server: Seite kommt vom Backend (z. B. /hilfe) – normaler Link statt Router-Link; also: Seiten, die zu diesem Bereich
 * gehören; ab: in der Kopfzeile erst ab dieser Breite, schmaler wäre die Zeile zu voll (steht dann in der Fußzeile)
 */
type NavItem = { to: string; label: string; server?: boolean; also?: string[]; ab?: 'xl' };

// Inhaber: drei Bereiche – Heute (Tresen, „Nur ich“ statt eigener Seite), Kalender (planen), Laden (alles Übrige,
// pages/ShopProfile.tsx). Mitarbeiter: „Mein Tag“ ist ihr „Heute, nur ich“, wer vorher Kunde war, behält „Meine Termine“.
const LINKS = MENUE.links as Record<UserRole | 'guest' | 'tresen', NavItem[]>;
// Gekoppeltes Tablet am Tresen (pages/Koppeln.tsx): nur Heute und Kalender, kein Profil, kein Laden
const TRESEN = LINKS.tresen;
const PROFILE_PATH = MENUE.profil as Record<UserRole, string>;

// In der App aus dem Store wird nichts verkauft (utils/app-shell.ts)
const VERKAUF = MENUE.verkauf;

// Rolle für die Kopfzeile der Backend-Seiten merken: Dort gibt es kein Profil, nur den Stand aus localStorage
// (dranzeit.konto, app/auth/konto.ts). Ohne Konto zählt der Wert nicht.
const ROLLE_SPEICHER = 'dranzeit.rolle';
const merkeRolle = (rolle: string | null) => {
  try {
    if (rolle) localStorage.setItem(ROLLE_SPEICHER, rolle);
    else localStorage.removeItem(ROLLE_SPEICHER);
  } catch {
    // privater Modus: dann zeigt die Hilfe eben das Gästemenü
  }
};

// Nur für Inhaber mehrerer Läden – Gäste laden das Auswahlfeld nicht mit. Fehlt der Baustein (alte Fassung nach dem
// Ausrollen), bleibt die Kopfzeile ohne Auswahl statt auf der Fehlerseite zu landen.
const LadenWahlKopf = lazy(() => import('./LadenWahlKopf').catch(() => ({ default: () => null })));

const inBereich = (item: NavItem, pathname: string) => !!item.also?.some((p) => pathname.startsWith(p));

const AB = { xl: 'hidden xl:inline-flex' } as const;

// eng: die sechs Einträge für Gäste passen ab xl nur mit schmalerem Rand in die Zeile
const linkClass = ({ isActive, eng = false }: { isActive: boolean; eng?: boolean }) =>
  cn(
    'inline-flex h-10 items-center whitespace-nowrap rounded-full px-3 text-[15px] font-medium transition-colors',
    !eng && 'lg:px-4',
    isActive ? 'bg-signal text-signal-foreground' : 'text-foreground hover:bg-foreground/5',
  );

/** Einheitliche Kopfzeile für alle Seiten, abhängig von der Rolle */
export function Navigation() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, profile, loading } = useUserProfile();
  const betreiber = useIsBetreiber();
  const ladenWahl = useKopfLadenWahl();
  const [open, setOpen] = useState(false);

  const role: UserRole | 'guest' = user && profile ? profile.role : 'guest';
  const tresen = nurTresen(user);
  const links = tresen ? TRESEN : (user && !profile ? [] : LINKS[role]).filter((item) => !(inStoreApp() && VERKAUF.includes(item.to)));
  const displayName = profile?.displayName || user?.displayName || user?.email || '';
  const initial = (displayName.trim()[0] || 'Q').toUpperCase();
  // Gäste haben die meisten Einträge (dazu Anmelden und Registrieren): bis lg das Menü zum Aufklappen
  const guest = role === 'guest';

  useEffect(() => {
    if (profile) merkeRolle(profile.role);
    else if (!loading && !user) merkeRolle(null);
  }, [profile, loading, user]);

  const handleLogout = async () => {
    setOpen(false);
    await stopTeamPushBeforeLogout();
    await anmeldung.signOut();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border print:hidden bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Bei mehreren Läden: welcher Laden – gilt für alle Seiten darunter (utils/laden-kontext.tsx) */}
        <div className="flex min-w-0 items-center gap-3">
          <Logo kompakt={!!ladenWahl} />
          {ladenWahl && (
            <Suspense fallback={null}>
              <LadenWahlKopf wahl={ladenWahl} />
            </Suspense>
          )}
        </div>

        <nav aria-label={t('Hauptnavigation')} className={cn('hidden items-center gap-1', guest ? 'lg:flex' : 'md:flex')}>
          {links.map((item) =>
            item.server ? (
              <a key={item.to} href={item.to} className={cn(linkClass({ isActive: false, eng: guest }), item.ab && AB[item.ab])}>
                {t(item.label)}
              </a>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn(linkClass({ isActive: isActive || inBereich(item, pathname), eng: guest }), item.ab && AB[item.ab])}
              >
                {t(item.label)}
              </NavLink>
            ),
          )}
        </nav>

        <div className="flex items-center gap-2">
          {/* zwischen md und lg wäre die Zeile zu voll; dort steht die Sprachwahl in der Fußzeile */}
          <SprachMenue className="hidden lg:inline-flex" />

          {!loading && !user && (
            <div className="hidden items-center gap-2 sm:flex">
              <Button variant="ghost" asChild>
                <Link to="/login">{t('Anmelden')}</Link>
              </Button>
              <Button asChild>
                <Link to="/register-options">{t('Registrieren')}</Link>
              </Button>
            </div>
          )}

          {user && (
            <a
              href="/hilfe"
              aria-label={t('Hilfe und Anleitungen')}
              title={t('Hilfe und Anleitungen')}
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
                  aria-label={t('Konto-Menü öffnen')}
                  className="hidden h-11 w-11 items-center justify-center rounded-full bg-foreground font-display text-base font-bold text-signal sm:flex"
                >
                  {initial}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60 rounded-xl" align="end">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-semibold">{tresen ? t('Tablet am Tresen') : profile?.displayName || t('Dein Konto')}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {profile && !tresen && (
                  <DropdownMenuItem onSelect={() => navigate(PROFILE_PATH[profile.role])}>
                    <UserRound className="me-2 h-4 w-4" aria-hidden="true" />
                    {t('Mein Profil')}
                  </DropdownMenuItem>
                )}
                {betreiber && !tresen && (
                  <DropdownMenuItem onSelect={() => navigate('/betreiber')}>
                    <ShieldCheck className="me-2 h-4 w-4" aria-hidden="true" />
                    {t('Betreiber-Bereich')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOut className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('Abmelden')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className={guest ? 'lg:hidden' : 'md:hidden'} aria-label={t('Menü öffnen')}>
                <Menu className="h-6 w-6" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side={istRtl() ? 'left' : 'right'} className="flex w-[85vw] max-w-sm flex-col gap-6 bg-background">
              <SheetHeader className="text-start">
                <SheetTitle className="font-display text-2xl">{t('Menü')}</SheetTitle>
              </SheetHeader>
              <nav aria-label={t('Hauptnavigation')} className="flex flex-col gap-1">
                {links.map((item) =>
                  item.server ? (
                    <a key={item.to} href={item.to} className="flex h-12 items-center rounded-xl px-4 text-lg font-medium hover:bg-foreground/5">
                      {t(item.label)}
                    </a>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex h-12 items-center rounded-xl px-4 text-lg font-medium',
                          isActive || inBereich(item, pathname) ? 'bg-signal text-signal-foreground' : 'hover:bg-foreground/5',
                        )
                      }
                    >
                      {t(item.label)}
                    </NavLink>
                  ),
                )}
                {profile && !tresen && (
                  <NavLink to={PROFILE_PATH[profile.role]} onClick={() => setOpen(false)} className="flex h-12 items-center rounded-xl px-4 text-lg font-medium hover:bg-foreground/5">
                    {t('Mein Profil')}
                  </NavLink>
                )}
                {betreiber && !tresen && (
                  <NavLink to="/betreiber" onClick={() => setOpen(false)} className="flex h-12 items-center rounded-xl px-4 text-lg font-medium hover:bg-foreground/5">
                    {t('Betreiber-Bereich')}
                  </NavLink>
                )}
                {user && (
                  <a href="/hilfe" className="flex h-12 items-center rounded-xl px-4 text-lg font-medium hover:bg-foreground/5">
                    {t('Hilfe')}
                  </a>
                )}
              </nav>
              <div className="mt-auto flex flex-col gap-2">
                <SprachListe className="mb-2 px-4 text-base text-muted-foreground" />
                {user ? (
                  <Button variant="outline" size="lg" onClick={handleLogout}>
                    {t('Abmelden')}
                  </Button>
                ) : (
                  <>
                    <Button size="lg" asChild>
                      <Link to="/register-options" onClick={() => setOpen(false)}>{t('Registrieren')}</Link>
                    </Button>
                    <Button variant="outline" size="lg" asChild>
                      <Link to="/login" onClick={() => setOpen(false)}>{t('Anmelden')}</Link>
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
