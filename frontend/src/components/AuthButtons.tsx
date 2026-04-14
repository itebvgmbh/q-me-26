import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser, APP_BASE_PATH } from "app";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { firebaseAuth } from 'app';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '../utils/firestore-client';
import { UserProfile } from '../utils/types';

/**
 * AuthButtons component handles user authentication UI elements
 * Shows login/register buttons when logged out
 * Shows avatar and dropdown menu when logged in
 */
export const AuthButtons: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Load user profile data when user is authenticated
  useEffect(() => {
    const loadUserProfile = async () => {
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(firestore, 'users', user.uid));
        if (userDoc.exists()) {
          setUserProfile(userDoc.data() as UserProfile);
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      }
    };

    loadUserProfile();
  }, [user]);

  // Handle user logout
  const handleLogout = async () => {
    try {
      await firebaseAuth.signOut();
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  // Get user initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase();
  };

  if (loading) return null;

  // Render authenticated user UI
  if (user && userProfile) {
    return (
      <div className="flex gap-4 items-center">
        <Button variant="ghost" onClick={() => navigate('/features')}>Funktionen</Button>
        <Button variant="ghost">Über uns</Button>
        <Button variant="ghost" onClick={() => navigate('/profile')}>Profil</Button>
        <Button variant="default" onClick={() => {
          // Navigate to appropriate dashboard based on user role
          switch(userProfile.role) {
            case 'shopOwner':
              navigate('/shop-dashboard');
              break;
            case 'employee':
              navigate('/employee-dashboard');
              break;
            case 'customer':
              navigate('/customer-dashboard');
              break;
            default:
              navigate('/profile');
          }
        }}>Dashboard</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {user.displayName ? getInitials(user.displayName) : 'U'}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {user.displayName || 'User'}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {userProfile.role === 'shopOwner' && (
              <>
                <DropdownMenuItem onClick={() => navigate('/shop-dashboard')}>
                  Shop Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/staff-management')}>
                  Mitarbeiterverwaltung
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/shop-profile')}>
                  Shop Profil
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/service-management')}>
                  Services
                </DropdownMenuItem>
              </>
            )}
            {userProfile.role === 'employee' && (
              <DropdownMenuItem onClick={() => navigate('/employee-dashboard')}>
                Mitarbeiter Dashboard
              </DropdownMenuItem>
            )}
            {userProfile.role === 'customer' && (
              <>
                <DropdownMenuItem onClick={() => navigate('/customer-dashboard')}>
                  Kunden Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/my-bookings')}>
                  Meine Buchungen
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              Mein Profil
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-600" onClick={handleLogout}>
              Abmelden
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // Render non-authenticated user UI
  return (
    <div className="flex gap-4 items-center">
      <Button variant="ghost" onClick={() => navigate('/features')}>Funktionen</Button>
      <Button variant="ghost">Über uns</Button>
      <Button variant="ghost" onClick={() => {
        window.location.href = `${window.location.origin}${APP_BASE_PATH}/login`;
      }}>Anmelden</Button>
      <Button variant="default" onClick={() => {
        window.location.href = `${window.location.origin}${APP_BASE_PATH}/register-options`;
      }}>Registrieren</Button>
    </div>
  );
};
