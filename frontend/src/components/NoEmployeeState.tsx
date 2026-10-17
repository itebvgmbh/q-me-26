import { Link } from 'react-router-dom';
import { User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { EmployeeNavigation } from './EmployeeNavigation';
import { useUserProfile } from '../utils/hooks/useUserProfile';

interface Props {
  user: User | null;
}

/** "Mein Tag" ohne Eintrag im Team: Inhaber tragen sich selbst ein, Mitarbeiter brauchen eine Einladung */
export const NoEmployeeState = ({ user }: Props) => {
  const { profile } = useUserProfile();
  const owner = profile?.role === 'shopOwner';

  return (
    <div>
      <EmployeeNavigation user={user} employee={null} showLogout={false} />
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
          {owner ? 'Du nimmst noch keine Termine an.' : 'Noch mit keinem Laden verknüpft.'}
        </h1>
        <p className="text-muted-foreground">
          {owner
            ? 'Arbeitest du selbst mit, trag dich unter „Team“ mit deiner E-Mail ein. Dann siehst du hier deine Termine und Pausen.'
            : 'Frag deinen Betrieb nach einem Einladungslink. Damit legst du dein Konto an und siehst hier deinen Tag.'}
        </p>
        <Button variant="signal" asChild>
          <Link to={owner ? '/staff-management' : '/'}>{owner ? 'Zum Team' : 'Zur Startseite'}</Link>
        </Button>
      </div>
    </div>
  );
};
