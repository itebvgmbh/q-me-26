import React, { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Service, Shop } from '../utils/firestore';
import { ServiceForm } from './ServiceForm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
      
      toast.success('Service erfolgreich erstellt');
      onServiceAdded(true);
      setOpen(false);
      return true;
    } catch (error) {
      console.error('Error creating service:', error);
      toast.error('Fehler beim Erstellen des Services');
      return false;
    }
  }, [shop, onServiceAdded]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Service hinzufügen</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neuen Service hinzufügen</DialogTitle>
          <DialogDescription>
            Fügen Sie einen neuen Service für Ihren Shop hinzu.
          </DialogDescription>
        </DialogHeader>
        <ServiceForm
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
          submitLabel="Service erstellen"
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
      
      toast.success('Service erfolgreich aktualisiert');
      onServiceUpdated(true);
      setOpen(false);
      return true;
    } catch (error) {
      console.error('Error updating service:', error);
      toast.error('Fehler beim Aktualisieren des Services');
      return false;
    }
  }, [service.id, onServiceUpdated]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Bearbeiten</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Service bearbeiten</DialogTitle>
          <DialogDescription>
            Aktualisieren Sie die Details des Services.
          </DialogDescription>
        </DialogHeader>
        <ServiceForm
          initialService={service}
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
          submitLabel="Änderungen speichern"
        />
      </DialogContent>
    </Dialog>
  );
};

// Import and re-export functions from firestore to keep imports consistent
import { createService, updateService } from '../utils/firestore';
