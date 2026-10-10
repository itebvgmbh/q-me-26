import { useState, useEffect } from 'react';
import { useCurrentUser } from 'app';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Staff, Shop, Service, getStaffByShopId, getShopsByOwnerId, getServicesByShopId } from '../utils/firestore';
import { AddStaffDialog } from '../components/AddStaffDialog';
import { InviteStaffDialog } from '../components/InviteStaffDialog';
import { StaffCard } from '../components/StaffCard';

/** Team: Personen anlegen, einladen, Leistungen und Arbeitszeiten pflegen */
const StaffManagement = () => {
  const { user } = useCurrentUser();
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const loadShopData = async (shopId: string) => {
    try {
      const [staffList, servicesList] = await Promise.all([getStaffByShopId(shopId), getServicesByShopId(shopId)]);
      setStaff(staffList.filter((s) => s.isActive !== false));
      setServices(servicesList);
    } catch (error) {
      console.error('Error loading staff:', error);
      toast.error('Das Team konnte nicht geladen werden.');
    }
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const userShops = await getShopsByOwnerId(user.uid);
        setShops(userShops);
        if (userShops.length > 0) {
          setSelectedShop(userShops[0]);
          await loadShopData(userShops[0].id);
        }
      } catch (error) {
        console.error('Error loading shops:', error);
        toast.error('Deine Läden konnten nicht geladen werden.');
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleShopChange = async (shopId: string) => {
    const shop = shops.find((s) => s.id === shopId);
    if (shop) {
      setSelectedShop(shop);
      await loadShopData(shop.id);
    }
  };

  const reload = async () => {
    if (selectedShop) await loadShopData(selectedShop.id);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Team</h1>
          <p className="text-muted-foreground">Wer arbeitet wann und bietet was an. Nur so entstehen freie Zeiten.</p>
        </div>
        {selectedShop && (
          <div className="flex flex-wrap gap-2">
            <AddStaffDialog shop={selectedShop} services={services} onStaffAdded={reload} />
            <InviteStaffDialog shop={selectedShop} onStaffInvited={reload} />
          </div>
        )}
      </div>

      {shops.length > 1 && (
        <Select value={selectedShop?.id} onValueChange={handleShopChange}>
          <SelectTrigger className="sm:w-72" aria-label="Laden wählen">
            <SelectValue placeholder="Laden wählen" />
          </SelectTrigger>
          <SelectContent>
            {shops.map((shop) => (
              <SelectItem key={shop.id} value={shop.id}>
                {shop.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Team wird geladen">
          <div className="h-24 animate-pulse rounded-3xl bg-muted" />
          <div className="h-24 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : !selectedShop ? (
        <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">Leg zuerst am Tresen deinen Laden an.</p>
      ) : staff.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-6">
          <p className="font-display text-xl font-bold">Noch niemand im Team.</p>
          <p className="mt-1 text-sm text-muted-foreground">Leg dich selbst als erste Person an, wenn du allein arbeitest. Mitarbeiter kannst du auch per E-Mail einladen.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {staff.map((employee) => (
            <StaffCard key={employee.id} employee={employee} shop={selectedShop} services={services} onStaffUpdated={reload} />
          ))}
        </div>
      )}
    </div>
  );
};

export default StaffManagement;
