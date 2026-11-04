import { useEffect, useState } from "react";
import { anmeldung, type User } from "./konto";

/**
 * Hook to subscribe to the current user.
 * Returns the current user if logged in, otherwise null.
 *
 * If within a UserGuard it is recommended to use useUserGuardContext instead.
 */
export const useCurrentUser = (): {
  user: User | null;
  loading: boolean;
} => {
  const [user, setUser] = useState<User | null>(anmeldung.currentUser);
  const [loading, setLoading] = useState(anmeldung.currentUser === null);

  useEffect(() => {
    const unsubscribe = anmeldung.onAuthStateChanged((user: User | null) => {
      setUser(user);
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return { user, loading };
};
