import { useState, useEffect } from 'react';
import { useCurrentUser } from 'app';
import { Navigation } from '../components/Navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Staff, Shop, Service, getStaffByShopId, getShopsByOwnerId, getServicesByShopId } from '../utils/firestore';
import { AddStaffDialog } from '../components/AddStaffDialog';
import { InviteStaffDialog } from '../components/InviteStaffDialog';
import { StaffCard } from '../components/StaffCard';

/**
 * StaffManagement page component
 * Provides an interface for shop owners to manage their staff members
 * Features include:
 * - Selecting between different shops owned by the user
 * - Viewing all active staff members for a selected shop
 * - Adding new staff members directly or via invitation
 * - Editing staff details including profile, services, and working hours
 * - Deactivating staff members
 */
const StaffManagement = () => {
  // Current user from Firebase Auth
  const { user } = useCurrentUser(); // Logged in user from Firebase Auth
  const [shops, setShops] = useState<Shop[]>([]); // List of shops owned by current user
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null); // Currently selected shop
  const [loading, setLoading] = useState<boolean>(true); // Loading state for initial data fetch
  const [staff, setStaff] = useState<Staff[]>([]); // Staff members for selected shop
  const [services, setServices] = useState<Service[]>([]); // Services offered at selected shop

  /**
   * Load staff and services data for a selected shop
   * Fetches both staff and services in parallel for efficiency
   * @param shopId - The ID of the shop to load data for
   */
  const loadShopData = async (shopId: string) => {
    try {
      const [staffList, servicesList] = await Promise.all([
        getStaffByShopId(shopId),
        getServicesByShopId(shopId)
      ]);
      // Only show active staff members
      setStaff(staffList.filter(s => s.isActive));
      setServices(servicesList);
    } catch (error) {
      console.error('Error loading staff:', error);
      toast.error('Fehler beim Laden der Mitarbeiter');
    }
  };

  /**
   * Load initial shop data when component mounts or user changes
   * This effect runs once on component mount and again if the user changes
   * Automatically selects the first shop if available
   */
  useEffect(() => {
    const loadShops = async () => {
      if (!user) return;

      try {
        // Initialize shop data and fetch shops by owner
        const userShops = await getShopsByOwnerId(user.uid);
        setShops(userShops);
        // Auto-select first shop if available
        if (userShops.length > 0) {
          const firstShop = userShops[0];
          setSelectedShop(firstShop);
          await loadShopData(firstShop.id);
        }
        setLoading(false);
      } catch (error) {
        console.error('Error loading shops:', error);
        toast.error('Fehler beim Laden der Shops');
      }
    };

    loadShops();
  }, [user]);

  /**
   * Handle shop selection change from the dropdown
   * Finds the shop object by ID and loads its staff and services
   * @param shopId - The ID of the newly selected shop
   */
  const handleShopChange = async (shopId: string) => {
    // Find the selected shop object by ID
    const shop = shops.find(s => s.id === shopId);
    // Update selected shop and load its data
    if (shop) {
      setSelectedShop(shop);
      await loadShopData(shop.id);
    }
  };

  // Display loading state while fetching initial data
  // This prevents showing an empty UI during data fetch
  if (loading) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto py-8 max-h-[calc(100vh-4rem)] overflow-y-auto">
          <p>Lädt...</p>
        </div>
      </>
    );
  }

  // Render the staff management interface once data is loaded
  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8 max-h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Mitarbeiterverwaltung</h1>
        </div>

        {/* Shop selection section - dropdown to choose which shop to manage */}
        <Card>
          <CardHeader>
            <CardTitle>Shop auswählen</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedShop?.id} onValueChange={handleShopChange}>
              <SelectTrigger>
                <SelectValue placeholder="Shop auswählen" />
              </SelectTrigger>
              <SelectContent>
                {shops.map(shop => (
                  <SelectItem key={shop.id} value={shop.id}>
                    {shop.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Staff list section - only shown when a shop is selected 
           Displays all active staff members and provides actions to manage them */}
        {selectedShop && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Mitarbeiter von {selectedShop.name}</CardTitle>
              <div className="flex gap-2">
                <InviteStaffDialog
                  shop={selectedShop}
                  onStaffInvited={async () => {
                    await loadShopData(selectedShop.id);
                  }}
                />
                <AddStaffDialog
                  shop={selectedShop}
                  services={services}
                  onStaffAdded={async () => {
                    await loadShopData(selectedShop.id);
                  }}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Render each staff member as a card with their details and actions */}
                {staff.map((employee) => (
                  <StaffCard
                    key={employee.id}
                    employee={employee}
                    shop={selectedShop}
                    services={services}
                    onStaffUpdated={async () => {
                      await loadShopData(selectedShop.id);
                    }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
};

export default StaffManagement;