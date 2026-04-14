import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { firebaseAuth } from 'app';
import { signOut } from 'firebase/auth';
import { User } from 'firebase/auth';
import { Staff } from '../utils/firestore';
import { getInitials } from '../utils/user-utils';

interface Props {
  user: User | null;
  employee: Staff | null;
  showLogout?: boolean;
  userName?: string;
}

/**
 * Navigation bar for the employee dashboard
 */
export const EmployeeNavigation = ({ user, employee, showLogout = true, userName }: Props) => {
  const navigate = useNavigate();

  return (
    <nav className="border-b mb-8">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Button variant="ghost" onClick={() => navigate('/')}>
              Q-ME
            </Button>
          </div>
          {showLogout && user && employee && (
            <div className="flex items-center space-x-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>
                        {userName ? getInitials(userName) : (user.displayName ? getInitials(user.displayName) : 'U')}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {userName || user.displayName || 'Mitarbeiter'}
                      </p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/employee-dashboard')}>
                    Mitarbeiter Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/profile')}>
                    Mein Profil
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-red-600" onClick={async () => {
                    try {
                      await signOut(firebaseAuth);
                      navigate('/login');
                    } catch (error) {
                      console.error('Error signing out:', error);
                    }
                  }}>
                    Abmelden
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};
