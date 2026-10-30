import React, { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Service, Shop } from '../utils/firestore';
import { ServiceForm } from './ServiceForm';
import { t, tn } from '@/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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

/**
 * Props for the AddServiceDialog component
 */
export interface AddServiceDialogProps {
  /** The shop to add the service to */
  shop: Shop;
  /** Callback function when a service is added successfully */
  onServiceAdded: (success: boolean) => void;
}

/**
 * Dialog component for adding a new service
 * 
 * Uses the shared ServiceForm component for form fields and validation
 */
export const AddServiceDialog: React.FC<AddServiceDialogProps> = ({ shop, onServiceAdded }) => {
  const [open, setOpen] = useState(false);

  const handleSubmit = useCallback(async (serviceData: {
    name: string;
    description: string;
    duration: number;
    setupTime?: number;
    price: number;
    category: string;
  }) => {
    try {
      const serviceWithShopId = {
        shopId: shop.id,
        ...serviceData
      };
      
      await createService(serviceWithShopId);
      
      toast.success(t('Leistung angelegt.'));
      onServiceAdded(true);
      setOpen(false);
      return true;
    } catch (error) {
      console.error('Error creating service:', error);
      toast.error(t('Die Leistung konnte nicht angelegt werden.'));
      return false;
    }
  }, [shop, onServiceAdded]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="signal">{t('Leistung anlegen')}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Neue Leistung')}</DialogTitle>
          <DialogDescription>
            {t('Was kann man bei dir buchen? Dauer und Preis bestimmen die freien Zeiten.')}
          </DialogDescription>
        </DialogHeader>
        <ServiceForm
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
          submitLabel={t('Leistung anlegen')}
        />
      </DialogContent>
    </Dialog>
  );
};

/**
 * Props for the EditServiceDialog component
 */
export interface EditServiceDialogProps {
  /** The service to edit */
  service: Service;
  /** Callback function when a service is updated successfully */
  onServiceUpdated: (success: boolean) => void;
}

/**
 * Dialog component for editing an existing service
 * 
 * Uses the shared ServiceForm component for form fields and validation
 */
export const EditServiceDialog: React.FC<EditServiceDialogProps> = ({ service, onServiceUpdated }) => {
  const [open, setOpen] = useState(false);

  const handleSubmit = useCallback(async (serviceData: {
    name: string;
    description: string;
    duration: number;
    setupTime?: number;
    price: number;
    category: string;
  }) => {
    try {
      await updateService(service.id, serviceData);
      
      toast.success(t('Leistung gespeichert.'));
      onServiceUpdated(true);
      setOpen(false);
      return true;
    } catch (error) {
      console.error('Error updating service:', error);
      toast.error(t('Die Leistung konnte nicht gespeichert werden.'));
      return false;
    }
  }, [service.id, onServiceUpdated]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">{t('Bearbeiten')}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Leistung bearbeiten')}</DialogTitle>
          <DialogDescription>
            {t('Änderungen gelten für neue Buchungen.')}
          </DialogDescription>
        </DialogHeader>
        <ServiceForm
          initialService={service}
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
          submitLabel={t('Änderungen speichern')}
        />
      </DialogContent>
    </Dialog>
  );
};

/**
 * Löschen mit Rückfrage. Gelöscht wird nicht wirklich, sondern ausgeblendet (archiveService):
 * Bestehende Termine behalten ihre Leistung, und die Leistung lässt sich zurückholen.
 */
export const DeleteServiceDialog: React.FC<{ service: Service; onServiceUpdated: (success: boolean) => void }> = ({ service, onServiceUpdated }) => {
  const [open, setOpen] = useState(false);
  const [upcoming, setUpcoming] = useState<number | null>(null);

  const openDialog = () => {
    setUpcoming(null);
    setOpen(true);
    countUpcomingAppointmentsWithService(service.shopId, service.id)
      .then(setUpcoming)
      .catch(() => setUpcoming(null));
  };

  const handleDelete = async () => {
    try {
      await archiveService(service.id);
      toast.success(t('„{name}“ ist gelöscht.', { name: service.name }), {
        action: { label: t('Rückgängig'), onClick: () => restoreService(service.id).then(() => onServiceUpdated(true)) },
      });
      onServiceUpdated(true);
    } catch (error) {
      console.error('Error archiving service:', error);
      toast.error(t('Löschen hat nicht geklappt.'));
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={openDialog}>
        {t('Löschen')}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t('„{name}“ löschen?', { name: service.name })}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>{t('Kunden können die Leistung dann nicht mehr buchen, und sie verschwindet bei den Personen im Team.')}</p>
                <p>
                  {upcoming === null
                    ? t('Termine, die schon gebucht sind, bleiben.')
                    : upcoming === 0
                      ? t('Es ist kein kommender Termin damit gebucht.')
                      : tn(upcoming, 'Ein kommender Termin ist damit gebucht. Er bleibt bestehen.', '{n} kommende Termine sind damit gebucht. Sie bleiben bestehen.')}
                </p>
                <p>{t('Unter „Gelöschte Leistungen“ kannst du sie jederzeit zurückholen.')}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">{t('Abbrechen')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('Löschen')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// Import and re-export functions from firestore to keep imports consistent
import { archiveService, countUpcomingAppointmentsWithService, createService, restoreService, updateService } from '../utils/firestore';
