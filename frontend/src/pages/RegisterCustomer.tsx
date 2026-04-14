import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_BASE_PATH } from 'app';
import { createFirebaseUser } from '../utils/auth-helpers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { createUserProfile } from '../utils/user-profile-service';
import { User } from 'lucide-react';

interface RegisterFormData {
  email: string;
  password: string;
  confirmPassword: string;
}

// @ts-ignore
// @auth open
const RegisterCustomer = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formData, setFormData] = useState<RegisterFormData>({
    email: '',
    password: '',
    confirmPassword: ''
  });

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Reset previous errors
    setEmailError(null);
    
    if (formData.password !== formData.confirmPassword) {
      toast.error('Die Passwörter stimmen nicht überein');
      return;
    }
    
    setLoading(true);

    try {
      // Create Firebase user with email uniqueness validation
      const user = await createFirebaseUser(formData.email, formData.password);
      
      // Create user profile with customer role directly
      await createUserProfile(user.uid, formData.email, 'customer');
      
      toast.success('Registrierung als Kunde erfolgreich');
      navigate('/customer-dashboard');
    } catch (error: any) {
      console.error('Registration error:', error);
      
      // Handle email already in use error
      if (error.message && (error.message.includes('auth/email-already-in-use') || error.message.includes('already in use'))) {
        const errorMessage = 'Diese E-Mail-Adresse wird bereits verwendet. Bitte wählen Sie eine andere E-Mail-Adresse.';
        toast.error(errorMessage, {
          duration: 5000,
          position: 'top-center',
          style: { background: '#f44336', color: 'white', fontWeight: 'bold' }
        });
        setEmailError(errorMessage);
      } else {
        toast.error('Registrierung fehlgeschlagen: ' + (error.message || 'Unbekannter Fehler'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: keyof RegisterFormData, value: string) => {
    // Reset email error when email field changes
    if (field === 'email') {
      setEmailError(null);
    }
    
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <div className="container mx-auto max-w-md py-12">
      <Card>
        <CardHeader className="text-center">
          <User className="w-12 h-12 mx-auto text-primary mb-2" />
          <CardTitle>Als Kunde registrieren</CardTitle>
          <CardDescription>Erstellen Sie Ihr Q-ME Konto als Kunde</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                required
                className={emailError ? "border-red-500" : ""}
              />
              {emailError && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mt-2" role="alert">
                  <strong className="font-bold">Fehler: </strong>
                  <span className="block sm:inline">{emailError}</span>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => handleInputChange('password', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Passwort bestätigen</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-white font-bold" disabled={loading}>
              {loading ? 'Registriere...' : 'Als Kunde registrieren'}
            </Button>
            <div className="mt-4 text-center text-sm text-gray-600">
              Bereits ein Konto?{' '}
              <a
                href={`${APP_BASE_PATH}/login`}
                className="text-primary hover:underline font-normal"
              >
                Jetzt anmelden
              </a>
            </div>
            <div className="mt-2 text-center text-sm text-gray-600">
              <a
                href={`${APP_BASE_PATH}/register-options`}
                className="text-primary hover:underline font-normal"
              >
                Zurück zur Rollenauswahl
              </a>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegisterCustomer;