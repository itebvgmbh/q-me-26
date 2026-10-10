import React from 'react';
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

interface CancelAppointmentDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Rückfrage vor dem Absagen eines Termins */
export const CancelAppointmentDialog: React.FC<CancelAppointmentDialogProps> = ({ isOpen, onOpenChange, onCancel, onConfirm }) => (
  <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
    <AlertDialogContent className="rounded-2xl">
      <AlertDialogHeader>
        <AlertDialogTitle className="font-display">Termin absagen?</AlertDialogTitle>
        <AlertDialogDescription>Dein Platz wird sofort für andere frei. Das lässt sich nicht rückgängig machen.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onCancel} className="rounded-full">Behalten</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm} className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90">
          Absagen
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
