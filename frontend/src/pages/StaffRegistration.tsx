import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { APP_BASE_PATH } from 'app';
import { getStaffInvitation, useStaffInvitation, updateStaffWithUserId } from '../utils/firestore';
import { StaffInvitation } from '../utils/firestore';
import { createUserProfile } from '../utils/user-profile-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth } from 'app';

const StaffRegistration = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [invitation, setInvitation] = useState<StaffInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  useEffect(() => {
    const checkInvitation = async () => {
      if (!token) {
        setError('No invitation token provided');
        setLoading(false);
        return;
      }

      try {
        const inv = await getStaffInvitation(token);
        if (!inv) {
          setError('Invalid or expired invitation');
          setLoading(false);
          return;
        }

        setInvitation(inv);
      } catch (err) {
        console.error('Error checking invitation:', err);
        setError('Error checking invitation');
      } finally {
        setLoading(false);
      }
    };

    checkInvitation();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;
    
    // Reset any previous errors
    setRegistrationError(null);

    try {
      // Creating only the Firebase authentication entry - Firebase will validate if email already exists
      console.log('Creating Firebase auth entry for:', invitation.email);
      const userCredential = await createUserWithEmailAndPassword(
        firebaseAuth,
        invitation.email,
        password
      );
      
      // Update existing staff profile with the new user ID
      console.log('Updating staff profile with new user ID:', userCredential.user.uid);
      await updateStaffWithUserId(invitation.email, userCredential.user.uid);

      // Create user profile in the users collection with employee role
      console.log('Creating user profile for employee:', userCredential.user.uid);
      await createUserProfile(userCredential.user.uid, invitation.email, 'employee');

      // Mark invitation as used
      console.log('Marking invitation as used:', invitation.id);
      await useStaffInvitation(invitation.id);

      toast.success('Registration successful');
      // Navigate to the login page first to ensure proper authentication flow
      window.location.href = `${window.location.origin}${APP_BASE_PATH}/login?returnTo=${encodeURIComponent('/employee-dashboard')}`;
      // Don't use navigate here as we need a full page reload to handle auth state
    } catch (err) {
      console.error('Error during registration:', err);
      
      // Display specific message for email already in use
      if (err instanceof Error) {
        if (err.message.includes('auth/email-already-in-use') || 
            err.message.includes('already in use')) {
          const errorMessage = 'Diese E-Mail-Adresse wird bereits verwendet. Bitte kontaktieren Sie Ihren Administrator.';
          toast.error(errorMessage, {
            duration: 5000,
            position: 'top-center',
            style: { background: '#f44336', color: 'white', fontWeight: 'bold' }
          });
          setRegistrationError(errorMessage);
        } else {
          const errorMessage = 'Fehler bei der Registrierung: ' + err.message;
          toast.error(errorMessage);
          setRegistrationError(errorMessage);
        }
      } else {
        const errorMessage = 'Unbekannter Fehler bei der Registrierung';
        toast.error(errorMessage);
        setRegistrationError(errorMessage);
      }
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>Staff Registration</CardTitle>
            <CardDescription>Loading...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div className="container mx-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>Staff Registration</CardTitle>
            <CardDescription className="text-red-500">{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Removed user check to ensure this page is always accessible

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Mitarbeiter-Registrierung</CardTitle>
          <CardDescription>
            Bitte legen Sie ein Passwort für Ihr Konto fest ({invitation.email})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {registrationError && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
                <strong className="font-bold">Fehler: </strong>
                <span className="block sm:inline">{registrationError}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-white font-bold">
              Registrierung abschließen
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default StaffRegistration;
