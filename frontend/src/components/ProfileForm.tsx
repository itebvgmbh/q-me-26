import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Button } from '@/components/ui/button';
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
        toast.error('Dein Profil konnte nicht geladen werden.');
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

      toast.success('Gespeichert.');
    } catch (error) {
      toast.error('Speichern hat nicht geklappt.');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" aria-label="Profil wird geladen" />;
  }

  if (!profile) {
    return <p className="rounded-3xl border border-border bg-card p-5 text-muted-foreground">Zu deinem Konto gibt es noch kein Profil.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="profil-email">E-Mail</Label>
          <Input id="profil-email" value={profile.email} disabled />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="profil-rolle">Konto</Label>
          <Input id="profil-rolle" value={USER_ROLES[profile.role]} disabled />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">Name</Label>
        <Input id="displayName" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="So rufen wir dich auf" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="phoneNumber">Handynummer</Label>
        <Input id="phoneNumber" type="tel" autoComplete="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Damit der Laden dich erreicht" />
      </div>
      <Button type="submit" className="self-start" disabled={updating}>
        {updating ? 'Wird gespeichert …' : 'Speichern'}
      </Button>
    </form>
  );
};
