import { useEffect, useState } from 'react';
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
import { useCurrentUser } from 'app';
import { isEmailInUse } from '../utils/auth-helpers';
import { Shop, Service, WorkingHours, createStaff, createStaffInvitation } from '../utils/firestore';
import { getDayName, defaultWorkingHours } from '../utils/staff-utils';
import { workingHoursFromOpening } from '../utils/opening-hours';

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
  const { user: currentUser } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  // Vorbelegt mit allen Leistungen – sonst ist eine neue Person für nichts buchbar
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(() => services.map((s) => s.id));
  const [emailError, setEmailError] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState<string>('');
  const initialHours = () => (shop.businessHoursByDay?.length ? workingHoursFromOpening(shop.businessHoursByDay) : defaultWorkingHours);
  const [workingHours, setWorkingHours] = useState<WorkingHours[]>(initialHours);

  // Beim Öffnen frisch vorbelegen: Leistungen kommen oft erst nach dem ersten Rendern
  useEffect(() => {
    if (!open || name) return;
    setSelectedServiceIds(services.map((s) => s.id));
    setWorkingHours(initialHours());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    
    // Pflicht ist nur der Name; E-Mail nur, wenn die Person eingeladen werden soll
    if (!name.trim()) {
      toast.error('Bitte trag einen Namen ein.');
      return;
    }
    const mail = email.trim();
    // Trägt sich der Inhaber selbst ein, gehört die Person zu seinem Konto ("Mein Tag") – keine Einladung nötig
    const isMe = Boolean(mail && currentUser?.email && mail.toLowerCase() === currentUser.email.toLowerCase());

    try {
      console.log('Checking if email is in use:', email);
      // Check if email is already in use
      const emailInUse = mail && !isMe ? await isEmailInUse(mail) : false;
      console.log('Email in use result:', emailInUse);
      
      if (emailInUse) {
        console.log('Email already in use, showing error');
        const errorMessage = 'Diese E-Mail ist schon im Team oder eingeladen.';
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
        name: name.trim(),
        email: mail,
        phone: phone.trim(),
        role: role.trim(),
        shopId: shop.id,
        workingHours,
        serviceIds: selectedServiceIds,
        isActive: true,
        profileImageUrl: newProfileImageUrl,
        status: 'available',
        userId: isMe ? currentUser!.uid : '',
      });

      if (mail && !isMe) {
        // Einladungslink für das eigene Konto der Person (unter "Bearbeiten" zum Kopieren)
        try {
          await createStaffInvitation(shop.id, mail, false);
          toast.success(`${name.trim()} ist im Team. Unter „Bearbeiten“ erstellst du den Einladungslink zum Weiterschicken.`);
        } catch (invitationError) {
          console.error('Error creating staff invitation:', invitationError);
          toast.error(`${name.trim()} ist im Team, aber der Einladungslink konnte nicht erstellt werden.`);
        }
      } else {
        toast.success(isMe ? 'Du bist jetzt im Team und siehst deine Termine unter „Mein Tag“.' : `${name.trim()} ist im Team.`);
      }

      onStaffAdded();
      setOpen(false);
      // Reset form
      setName('');
      setEmail('');
      setPhone('');
      setRole('');
      setSelectedServiceIds(services.map((s) => s.id));
      setWorkingHours(initialHours());
    } catch (error) {
      console.error('Error creating staff:', error);
      toast.error('Anlegen hat nicht geklappt. Bitte noch einmal.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="signal">Person anlegen</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Person anlegen</DialogTitle>
          <DialogDescription>
            Für dich selbst (mit deiner E-Mail) oder jemanden aus dem Team. Den Einladungslink für die Person erstellst du danach unter „Bearbeiten“.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Max Mustermann"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">E-Mail (freiwillig, für die Einladung)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
              placeholder="max@beispiel.de"
              aria-invalid={emailError ? true : undefined}
              className={emailError ? "border-destructive" : ""}
            />
            {emailError && (
              <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {emailError}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phone">Telefon (freiwillig)</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+49 123 4567890"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role">Aufgabe (freiwillig)</Label>
            <Input
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="z. B. Friseurin"
            />
          </div>

          <div className="grid gap-2">
            <Label>Leistungen</Label>
            <div className="grid gap-2 sm:grid-cols-2">
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
              <div key={index} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-2">
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

          <Button onClick={handleSubmit} id="create-staff-button" >Anlegen</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
