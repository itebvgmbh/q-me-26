import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserProfile, USER_ROLES } from '../utils/types';
import { toast } from 'sonner';

interface ProfileFormProps {
  userId: string;
}

export const ProfileForm = ({ userId }: ProfileFormProps) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const db = getFirestore(firebaseApp);
        const docRef = doc(db, 'users', userId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data() as UserProfile;
          setProfile(data);
          setDisplayName(data.displayName || '');
          setPhoneNumber(data.phoneNumber || '');
        }
      } catch (error) {
        toast.error('Fehler beim Laden des Profils');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);

    try {
      const db = getFirestore(firebaseApp);
      const docRef = doc(db, 'users', userId);
      
      await updateDoc(docRef, {
        displayName,
        phoneNumber,
        updatedAt: new Date()
      });

      toast.success('Profil erfolgreich aktualisiert');
    } catch (error) {
      toast.error('Fehler beim Aktualisieren des Profils');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <div>Lade Profil...</div>;
  }

  if (!profile) {
    return <div>Profil nicht gefunden</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profil bearbeiten</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>E-Mail</Label>
            <Input value={profile.email} disabled />
          </div>
          <div className="space-y-2">
            <Label>Rolle</Label>
            <Input value={USER_ROLES[profile.role]} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ihr Name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phoneNumber">Telefonnummer</Label>
            <Input
              id="phoneNumber"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Ihre Telefonnummer"
            />
          </div>
          <Button type="submit" disabled={updating}>
            {updating ? 'Aktualisiere...' : 'Aktualisieren'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
