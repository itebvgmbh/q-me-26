import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Staff, Shop, Service, deleteStaff } from '../utils/firestore';
import { EditStaffDialog } from './EditStaffDialog';

export interface StaffCardProps {
  employee: Staff;
  shop: Shop;
  services: Service[];
  onStaffUpdated: () => Promise<void>;
}

/** Eine Person im Team: Leistungen auf einen Blick, Bearbeiten, Deaktivieren mit Rückfrage */
export const StaffCard = ({ employee, shop, services, onStaffUpdated }: StaffCardProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const offered = (employee.serviceIds || []).map((id) => services.find((s) => s.id === id)?.name).filter(Boolean);
  const workingDays = (employee.workingHours || []).filter((h) => h.isWorking).length;

  const handleDeactivate = async () => {
    try {
      await deleteStaff(employee.id);
      await onStaffUpdated();
      toast.success(`${employee.name} ist deaktiviert.`);
    } catch (error) {
      console.error('Error deleting staff:', error);
      toast.error('Deaktivieren hat nicht geklappt.');
    }
  };

  return (
    <article className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {employee.profileImageUrl ? (
          <img src={employee.profileImageUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground font-display text-lg font-bold text-signal" aria-hidden="true">
            {employee.name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-bold">{employee.name}</h3>
          <p className="truncate text-sm text-muted-foreground">{employee.email}{employee.email && ' · '}{workingDays ? `${workingDays} Tage pro Woche` : <span className="text-destructive">keine Arbeitszeiten</span>}</p>
          <p className="mt-1 text-sm">
            {offered.length ? offered.join(', ') : <span className="text-destructive">Keine Leistung zugeordnet – taucht bei der Buchung nicht auf.</span>}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <EditStaffDialog staff={employee} services={services} shop={shop} onStaffUpdated={onStaffUpdated} />
        <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmOpen(true)}>
          Deaktivieren
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{employee.name} deaktivieren?</AlertDialogTitle>
            <AlertDialogDescription>Für {employee.name} kann dann niemand mehr buchen. Bestehende Termine bleiben.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Deaktivieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
};
