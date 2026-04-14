import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';
import { firebaseApp, useCurrentUser } from 'app';
import { getFirestore } from 'firebase/firestore';
import { getUserProfile } from '../utils/user-profile-service';
import { getRedirectPath } from '../utils/user-profile-service';
import { createCustomer } from '../utils/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { USER_ROLES, UserRole } from '../utils/types';
import { toast } from 'sonner';

const RoleSelection = () => {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useCurrentUser();
  const [role, setRole] = useState<UserRole>('customer');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkUser = async () => {
      if (!userLoading) {
        if (!user) {
          navigate('/login');
          return;
        }

        // Check if user already has a role
        const profile = await getUserProfile(user.uid);
        if (profile) {
          const redirectPath = await getRedirectPath(user.uid);
          navigate(redirectPath);
        }
      }
    };

    checkUser();
  }, [user, userLoading, navigate]);

  const handleRoleSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    try {
      const db = getFirestore(firebaseApp);
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Customer records will be created when they select a shop

      toast.success('Rolle erfolgreich festgelegt');
      const redirectPath = await getRedirectPath(user.uid);
      navigate(redirectPath);
    } catch (error: any) {
      console.error('Firestore Error:', error);
      toast.error('Fehler beim Speichern der Rolle: ' + (error?.message || 'Unbekannt'));
    } finally {
      setLoading(false);
    }
  };

  if (userLoading || !user) {
    return null;
  }

  return (
    <div className="container mx-auto max-w-md py-12">
      <Card>
        <CardHeader>
          <CardTitle>Wählen Sie Ihre Rolle</CardTitle>
          <CardDescription>Legen Sie fest, wie Sie Q-ME nutzen möchten</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRoleSelection} className="space-y-4">
            <div className="space-y-2">
              <Select value={role} onValueChange={(value: UserRole) => setRole(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Wählen Sie Ihre Rolle" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(USER_ROLES).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Speichere...' : 'Rolle festlegen'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default RoleSelection;