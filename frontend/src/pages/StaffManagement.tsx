import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Staff, Shop, Service, getStaffByShopId, getShopsByOwnerId, getServicesByShopId, offeredServices, reactivateStaff } from '../utils/firestore';
import { AddStaffDialog } from '../components/AddStaffDialog';
import { InviteStaffDialog } from '../components/InviteStaffDialog';
import { StaffCard } from '../components/StaffCard';
import { effectivePlan } from '../utils/plans';

/** Team: Personen anlegen, einladen, Leistungen und Arbeitszeiten pflegen */
const StaffManagement = () => {
  const { user } = useCurrentUser();
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [inactive, setInactive] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const loadShopData = async (shopId: string) => {
    try {
      const [staffList, servicesList] = await Promise.all([getStaffByShopId(shopId), getServicesByShopId(shopId)]);
      setStaff(staffList.filter((s) => s.isActive !== false));
      setInactive(staffList.filter((s) => s.isActive === false));
      setServices(offeredServices(servicesList));
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

  // Personen je Tarif (utils/plans.ts)
  const currentPlan = effectivePlan(selectedShop);
  const staffLimitReached = staff.filter((s) => s.isActive !== false).length >= currentPlan.plan.maxStaff;

  const handleReactivate = async (person: Staff) => {
    try {
      await reactivateStaff(person.id);
      await reload();
      toast.success(`${person.name} ist wieder im Team.`);
    } catch (error) {
      console.error('Error reactivating staff:', error);
      toast.error('Zurückholen hat nicht geklappt. Bitte noch einmal.');
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Team</h1>
          <p className="text-muted-foreground">Wer arbeitet wann und bietet was an. Nur so entstehen freie Zeiten.</p>
        </div>
        {selectedShop && staffLimitReached ? (
          <p className="max-w-xs text-sm text-muted-foreground">
            Im Tarif {currentPlan.plan.name} {currentPlan.plan.maxStaff === 1 ? 'ist eine Person' : `sind ${currentPlan.plan.maxStaff} Personen`} dabei.{' '}
            <Link to="/tarif" className="font-semibold text-foreground underline underline-offset-4">
              Tarif wechseln
            </Link>
          </p>
        ) : selectedShop && (
          <div className="flex flex-wrap gap-2">
            <AddStaffDialog shop={selectedShop} services={services} onStaffAdded={reload} />
            <InviteStaffDialog shop={selectedShop} services={services} onStaffInvited={reload} />
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
        <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">
          Richte zuerst deinen Laden ein.{' '}
          <Link to="/shop-setup" className="font-semibold text-foreground underline underline-offset-4">
            Laden einrichten
          </Link>
        </p>
      ) : staff.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-6">
          <p className="font-display text-xl font-bold">Noch niemand im Team.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Arbeitest du selbst mit, leg dich mit deiner E-Mail als erste Person an. Mitarbeiter lädst du mit „Per E-Mail einladen“ ein, oder du legst sie an und schickst ihnen danach den Link, z. B. per WhatsApp.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {staff.map((employee) => (
            <StaffCard key={employee.id} employee={employee} shop={selectedShop} services={services} onStaffUpdated={reload} />
          ))}
        </div>
      )}

      {!loading && selectedShop && inactive.length > 0 && (
        <details className="rounded-3xl border border-border bg-card p-5">
          <summary className="cursor-pointer font-display text-lg font-bold">Deaktiviert ({inactive.length})</summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Bei diesen Personen kann niemand buchen, und sie sehen „Mein Tag“ nicht. Zurückgeholt ist alles wieder wie vorher.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {inactive.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{person.name}</span>
                  {person.email && <span className="truncate text-sm text-muted-foreground">{person.email}</span>}
                </span>
                <Button variant="outline" size="sm" disabled={staffLimitReached} onClick={() => handleReactivate(person)}>
                  Zurückholen
                </Button>
              </li>
            ))}
          </ul>
          {staffLimitReached && (
            <p className="mt-2 text-sm text-muted-foreground">
              Dein Tarif ist voll. Deaktiviere erst jemand anderen oder{' '}
              <Link to="/tarif" className="font-semibold text-foreground underline underline-offset-4">
                wechsle den Tarif
              </Link>
              .
            </p>
          )}
        </details>
      )}
    </div>
  );
};

export default StaffManagement;
