import { useEffect, useState } from 'react';
import { useCurrentUser } from 'app';
import { getUserProfile } from '../user-profile-service';
import type { UserProfile } from '../types';

// Profil pro Sitzung zwischenspeichern, damit die Navigation beim
// Seitenwechsel nicht jedes Mal ohne Rolle aufblitzt.
const cache = new Map<string, UserProfile | null>();

export const useUserProfile = () => {
  const { user, loading: userLoading } = useCurrentUser();
  const cached = user ? cache.get(user.uid) : undefined;
  const [profile, setProfile] = useState<UserProfile | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let active = true;
    getUserProfile(user.uid)
      .then((p) => {
        cache.set(user.uid, p);
        if (active) setProfile(p);
      })
      .catch((error) => console.error('Profil konnte nicht geladen werden:', error))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user, userLoading]);

  return { user, profile, loading: userLoading || loading };
};
