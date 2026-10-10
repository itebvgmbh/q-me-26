import type { User } from "firebase/auth";
import * as React from "react";
import { createContext, useContext } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "./useCurrentUser";

type UserGuardContextType = {
  user: User;
};

const UserGuardContext = createContext<UserGuardContextType | undefined>(
  undefined,
);

/**
 * Hook to access the logged in user from within a <UserGuard> component.
 */
export const useUserGuardContext = () => {
  const context = useContext(UserGuardContext);

  if (context === undefined) {
    throw new Error("useUserGuardContext must be used within a <UserGuard>");
  }

  return context;
};

/**
 * All protected routes are wrapped in a UserGuard component.
 */
export const UserGuard = (props: {
  children: React.ReactNode;
}) => {
  const { user, loading } = useCurrentUser();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        <span className="sr-only">Wird geladen …</span>
      </div>
    );
  }

  if (!user) {
    const queryParams = new URLSearchParams();

    // Don't set the next param if the user is logging out
    // to avoid ending up in an infinite redirect loop
    if (pathname !== "/logout" && pathname !== "/sign-out") {
      queryParams.set("next", pathname + window.location.search);
    }

    const queryString = queryParams.toString();

    return <Navigate to={`/login?${queryString}`} replace={true} />;
  }

  return (
    <UserGuardContext.Provider value={{ user }}>
      {props.children}
    </UserGuardContext.Provider>
  );
};
