import { User } from 'firebase/auth';
import { Staff } from '../utils/firestore';

interface Props {
  user: User | null;
  employee: Staff | null;
  showLogout?: boolean;
  userName?: string;
}

/**
 * Navigation bar for the employee dashboard
 */
export const EmployeeNavigation = (_props: Props) => {
  // Die Kopfzeile kommt zentral aus dem Router (Rolle "employee")
  return null;
};
