import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { EmployeeNavigation } from './EmployeeNavigation';
import { User } from 'firebase/auth';

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
      <div className="container mx-auto py-8">
        <div className="text-center">
          <p className="mb-4">Bitte melden Sie sich an.</p>
          <Button onClick={() => navigate('/login')}>Zum Login</Button>
        </div>
      </div>
    </div>
  );
};
