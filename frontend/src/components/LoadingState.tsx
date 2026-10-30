import { EmployeeNavigation } from './EmployeeNavigation';
import { User } from 'firebase/auth';
import { t } from '@/i18n';

interface Props {
  user: User | null;
}

/**
 * Component displayed when data is loading
 */
export const LoadingState = ({ user }: Props) => {
  return (
    <div>
      <EmployeeNavigation user={user} employee={null} showLogout={false} />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="text-center">{t('Laden...')}</div>
      </div>
    </div>
  );
};
