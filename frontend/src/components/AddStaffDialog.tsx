import { useState } from 'react';
import { uploadImage } from '../utils/firestore/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { isEmailInUse } from '../utils/auth-helpers';
import { Shop, Service, WorkingHours, createStaff, createStaffInvitation } from '../utils/firestore';
import { getDayName, defaultWorkingHours } from '../utils/staff-utils';

/**
 * Props for AddStaffDialog component
 */
export interface AddStaffDialogProps {
  /** Shop that the staff will be added to */
  shop: Shop;
  /** List of services available at the shop */
  services: Service[];
  /** Callback function to run after a staff member is added */
  onStaffAdded: () => void;
}

/**
 * Dialog component for adding new staff members directly
 * Provides interface for setting up a new staff profile with all details
 */
export const AddStaffDialog = ({ shop, services, onStaffAdded }: AddStaffDialogProps) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState<string>('');
  const [workingHours, setWorkingHours] = useState<WorkingHours[]>(defaultWorkingHours);

  /**
   * Toggle service selection for the staff member
   */
  const handleServiceChange = (serviceId: string) => {
    if (selectedServiceIds.includes(serviceId)) {
      setSelectedServiceIds(selectedServiceIds.filter(id => id !== serviceId));
    } else {
      setSelectedServiceIds([...selectedServiceIds, serviceId]);
    }
  };

  /**
   * Update a specific field in the working hours for a day
   */
  const updateWorkingHours = (index: number, field: keyof WorkingHours, value: string | boolean) => {
    const newHours = [...workingHours];
    newHours[index] = { ...newHours[index], [field]: value };
    setWorkingHours(newHours);
  };

  /**
   * Upload staff profile image to Firebase Storage
   */
  const handleImageUpload = async (file: File): Promise<string> => {
    try {
      // Path for staff profile images
      const path = `staff-profile-images/${shop.id}`;
      // Upload image and return URL
      return await uploadImage(file, path);
    } catch (error) {
      console.error('Error uploading staff profile image:', error);
      toast.error('Fehler beim Hochladen des Profilbilds');
      throw error;
    }
  };

  /**
   * Handle form submission to create new staff member
   */
  const handleSubmit = async () => {
    // Reset previous errors
    setEmailError(null);
    
    if (!name || !email || !phone || !role) {
      toast.error('Bitte füllen Sie alle Pflichtfelder aus');
      return;
    }

    try {
      console.log('Checking if email is in use:', email);
      // Check if email is already in use
      const emailInUse = await isEmailInUse(email);
      console.log('Email in use result:', emailInUse);
      
      if (emailInUse) {
        console.log('Email already in use, showing error');
        const errorMessage = 'Diese E-Mail-Adresse wird bereits verwendet. Bitte wählen Sie eine andere E-Mail-Adresse.';
        toast.error(errorMessage, {
          duration: 5000,
          position: 'top-center',
          style: { background: '#f44336', color: 'white', fontWeight: 'bold' }
        });
        setEmailError(errorMessage);
        return;
      }

      // Upload profile image if available
      let newProfileImageUrl = '';
      if (profileImage) {
        try {
          newProfileImageUrl = await handleImageUpload(profileImage);
        } catch (error) {
          // Error handling already done in handleImageUpload
          // Continue with staff creation without profile image
        }
      }

      // Create the staff member
      const newStaff = await createStaff({
        name,
        email,
        phone,
        role,
        shopId: shop.id,
        workingHours,
        serviceIds: selectedServiceIds,
        isActive: true,
        profileImageUrl: newProfileImageUrl,
        status: 'available',
        userId: '',
      });

      // Automatically generate registration link
      try {
        const invitation = await createStaffInvitation(shop.id, email);
        // Link is automatically generated and email sent
        toast.success('Mitarbeiter erfolgreich angelegt und Registrierungslink generiert');
      } catch (invitationError) {
        console.error('Error creating staff invitation:', invitationError);
        toast.error('Mitarbeiter angelegt, aber Fehler beim Erstellen des Registrierungslinks');
      }

      onStaffAdded();
      setOpen(false);
      // Reset form
      setName('');
      setEmail('');
      setPhone('');
      setRole('');
      setSelectedServiceIds([]);
      setWorkingHours(defaultWorkingHours);
    } catch (error) {
      console.error('Error creating staff:', error);
      toast.error('Fehler beim Anlegen des Mitarbeiters');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Mitarbeiter direkt anlegen</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neuen Mitarbeiter direkt anlegen</DialogTitle>
          <DialogDescription>
            Legen Sie einen neuen Mitarbeiter direkt an. Sie können alle Details sofort festlegen.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name*</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Max Mustermann"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email*</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
              placeholder="max@beispiel.de"
              className={emailError ? "border-red-500" : ""}
            />
            {emailError && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mt-2" role="alert">
                <strong className="font-bold">Fehler: </strong>
                <span className="block sm:inline">{emailError}</span>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phone">Telefon*</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+49 123 4567890"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role">Position*</Label>
            <Input
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="z.B. Friseur"
            />
          </div>

          <div className="grid gap-2">
            <Label>Services</Label>
            <div className="grid grid-cols-2 gap-2">
              {services.map((service) => (
                <div
                  key={service.id}
                  className={`flex items-center justify-between p-2 rounded border cursor-pointer ${
                    selectedServiceIds.includes(service.id) ? 'bg-primary/10 border-primary' : ''
                  }`}
                  onClick={() => handleServiceChange(service.id)}
                >
                  <div>
                    <div className="font-medium">{service.name}</div>
                    <div className="text-sm text-muted-foreground">{service.duration} Min. | {service.price.toFixed(2)} €</div>
                  </div>
                  <Switch checked={selectedServiceIds.includes(service.id)} />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Arbeitszeiten</Label>
            {workingHours.map((hours, index) => (
              <div key={index} className="flex items-center gap-4 p-2 border rounded">
                <div className="w-24">
                  <span>{getDayName(hours.dayOfWeek)}</span>
                </div>
                <Switch
                  checked={hours.isWorking}
                  onCheckedChange={(checked) => updateWorkingHours(index, 'isWorking', checked)}
                />
                {hours.isWorking && (
                  <>
                    <Input
                      type="time"
                      value={hours.startTime}
                      onChange={(e) => updateWorkingHours(index, 'startTime', e.target.value)}
                      className="w-32"
                    />
                    <span>bis</span>
                    <Input
                      type="time"
                      value={hours.endTime}
                      onChange={(e) => updateWorkingHours(index, 'endTime', e.target.value)}
                      className="w-32"
                    />
                  </>
                )}
              </div>
            ))}
          </div>

          <Button onClick={handleSubmit} id="create-staff-button" className="bg-primary hover:bg-primary/90 text-white font-bold">Mitarbeiter anlegen</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
