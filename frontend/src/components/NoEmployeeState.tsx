import { Link } from 'react-router-dom';
import { User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { EmployeeNavigation } from './EmployeeNavigation';
import { TeamPushSchalter } from './TeamPushSchalter';
import { useUserProfile } from '../utils/hooks/useUserProfile';
import { t } from '@/i18n';

interface Props {
  user: User | null;
}

/**
 * "Mein Tag" ohne Eintrag im Team. Inhaber: die Termine aller stehen am Tresen, eigene nur mit Eintrag im Team
 * (Inhaber-Konto und Team-Eintrag sind getrennt). Mitarbeiter brauchen eine Einladung.
 */
export const NoEmployeeState = ({ user }: Props) => {
  const { profile } = useUserProfile();
  const owner = profile?.role === 'shopOwner';

  return (
    <div>
      <EmployeeNavigation user={user} employee={null} showLogout={false} />
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
          {owner ? t('Die Termine deines Teams stehen am Tresen.') : t('Noch mit keinem Laden verknüpft.')}
        </h1>
        <p className="text-muted-foreground">
          {owner
            ? t('„Mein Tag“ zeigt nur die Termine, die du selbst annimmst. Arbeitest du selbst mit, trag dich unter „Team“ mit deiner E-Mail ein.')
            : t('Frag in deinem Laden nach einem Einladungslink. Damit legst du dein Konto an und siehst hier deinen Tag.')}
        </p>
        {owner ? (
          <div className="flex flex-wrap gap-3">
            <Button variant="signal" asChild>
              <Link to="/shop-dashboard">{t('Zum Tresen')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/staff-management">{t('Zum Team')}</Link>
            </Button>
          </div>
        ) : (
          <Button variant="signal" asChild>
            <Link to="/">{t('Zur Startseite')}</Link>
          </Button>
        )}
        {/* Auch ohne eigenen Eintrag im Team: Inhaber bekommen alles aus dem Laden */}
        {owner && (
          <div className="mt-4 w-full">
            <TeamPushSchalter />
          </div>
        )}
      </div>
    </div>
  );
};
