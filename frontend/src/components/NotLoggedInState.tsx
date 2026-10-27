import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { EmployeeNavigation } from './EmployeeNavigation';
import { User } from 'firebase/auth';
import { t } from '@/i18n';

interface Props {
  user: User | null;
}

/**
 * Component displayed when the user is not logged in
 */
export const NotLoggedInState = ({ user }: Props) => {
  const navigate = useNavigate();

  return (
    <div>
      <EmployeeNavigation user={user} employee={null} showLogout={false} />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="text-center">
          <p className="mb-4">{t('Bitte melde dich an.')}</p>
          <Button onClick={() => navigate('/login')}>{t('Zum Login')}</Button>
        </div>
      </div>
    </div>
  );
};
