import { EmployeeNavigation } from './EmployeeNavigation';
import { User } from 'firebase/auth';

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
      <div className="container mx-auto py-8">
        <div className="text-center">Laden...</div>
      </div>
    </div>
  );
};
