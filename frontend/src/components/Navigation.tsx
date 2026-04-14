import { useNavigate, useLocation } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { doc, getDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { firebaseApp } from 'app';
import { UserProfile } from '../utils/types';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { firebaseAuth } from 'app';
import { Scissors } from 'lucide-react';

export function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useCurrentUser();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const db = getFirestore(firebaseApp);
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        
        if (userDoc.exists()) {
          setUserProfile(userDoc.data() as UserProfile);
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [user]);

  const handleLogout = async () => {
    try {
      await firebaseAuth.signOut();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase();
  };

  const showBackButton = location.pathname !== '/' && location.pathname !== '/customer-dashboard';

  const handleBackClick = () => {
    if (location.pathname === '/my-bookings') {
      navigate('/customer-dashboard');
    } else {
      navigate(-1);
    }
  };

  return (
    <nav className="border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            {showBackButton && (
              <Button
                variant="ghost"
                onClick={handleBackClick}
              >
                ← Zurück
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => navigate('/')}
            >
              Q-ME
            </Button>
          </div>

          {user && (
            <div className="flex items-center space-x-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>
                        {user.displayName 
                          ? getInitials(user.displayName) 
                          : (userProfile?.email && userProfile.email.charAt(0).toUpperCase()) || 
                            (user.email && user.email.charAt(0).toUpperCase()) || 
                            'U'}
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
                  {/* Navigation based on user role */}
                  {!loading && userProfile && (
                    <>
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
                            <div className="flex items-center">
                              <Scissors className="h-4 w-4 mr-2" />
                              Services
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate('/scheduler-control')}>
                            <div className="flex items-center">
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mr-2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                              </svg>
                              Scheduler
                            </div>
                          </DropdownMenuItem>
                        </>
                      )}

                      {userProfile.role === 'employee' && (
                        <>
                          <DropdownMenuItem onClick={() => navigate('/employee-dashboard')}>
                            Mitarbeiter Dashboard
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate('/profile')}>
                            Mein Profil
                          </DropdownMenuItem>
                        </>
                      )}

                      {userProfile.role === 'customer' && (
                        <>
                          <DropdownMenuItem onClick={() => navigate('/customer-dashboard')}>
                            Kunden Dashboard
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate('/customer-profile')}>
                            Mein Profil
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate('/my-bookings')}>
                            Meine Buchungen
                          </DropdownMenuItem>
                        </>
                      )}

                      {/* Common navigation items for shop owners and customers */}
                      {userProfile.role !== 'employee' && (
                        <>
                          <DropdownMenuItem onClick={() => navigate('/book-appointment?fromMarketplace=true')}>
                            Termin buchen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate('/public-join-queue')}>
                            Warteschlange
                          </DropdownMenuItem>
                        </>
                      )}
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={handleLogout}
                  >
                    Abmelden
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
