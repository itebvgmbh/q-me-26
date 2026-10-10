import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { EmployeeNavigation } from './EmployeeNavigation';
import { User } from 'firebase/auth';

interface Props {
  user: User | null;
}

/**
 * Component displayed when no employee profile is found
 */
export const NoEmployeeState = ({ user }: Props) => {
  const navigate = useNavigate();

  return (
    <div>
      <EmployeeNavigation user={user} employee={null} showLogout={false} />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="text-center">
          <p className="mb-4">Dein Konto ist noch mit keinem Laden verknüpft. Frag deinen Betrieb nach einem Einladungslink.</p>
          <Button onClick={() => navigate('/')}>Zurück zur Startseite</Button>
        </div>
      </div>
    </div>
  );
};
