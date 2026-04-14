import { useState, useEffect } from 'react';
import { uploadImage } from '../utils/firestore/storage';
import { collection, doc, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { APP_BASE_PATH } from 'app';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import brain from "brain";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { isEmailInUse } from '../utils/auth-helpers';
import { Staff, Shop, Service, WorkingHours, updateStaff, createStaffInvitation } from '../utils/firestore';
import { firestore as db } from '../utils/firestore-client';
import { BreakManager } from './BreakManager';
import { RecurringBreakManager } from './RecurringBreakManager';
import { getDayName } from '../utils/staff-utils';

/**
 * Interface for EditStaffDialog component props
 */
export interface EditStaffDialogProps {
  /** Staff member to edit */
  staff: Staff;
  /** List of services available at the shop */
  services: Service[];
  /** Shop the staff belongs to */
  shop: Shop;
  /** Callback function to run after staff is updated */
  onStaffUpdated: () => void;
}

/**
 * Dialog component for editing existing staff members
 * Provides tabs for editing profile info, services, working hours, and breaks
 */
export const EditStaffDialog = ({ staff, services, shop, onStaffUpdated }: EditStaffDialogProps) => {
  const [activeTab, setActiveTab] = useState("profile");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(staff.name);
  const [email, setEmail] = useState(staff.email);
  const [phone, setPhone] = useState(staff.phone);
  const [role, setRole] = useState(staff.role);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(staff.serviceIds || []);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState<string>(staff.profileImageUrl || '');

  const [workingHours, setWorkingHours] = useState<WorkingHours[]>(staff.workingHours);
  const [registrationLink, setRegistrationLink] = useState<string>('');
  const [emailSent, setEmailSent] = useState<boolean>(false);
  const [emailSentTime, setEmailSentTime] = useState<string>('');
  
  /**
   * Check if an invitation has already been sent to this staff member
   */
  useEffect(() => {
    const checkInvitationStatus = async () => {
      if (staff.id && open) {
        try {
          const staffInvitationsQuery = query(
            collection(db, 'staff-invitations'),
            where('staffId', '==', staff.id),
            where('emailSent', '==', true),
            orderBy('emailSentAt', 'desc'),
            limit(1)
          );
          
          const invitationsSnapshot = await getDocs(staffInvitationsQuery);
          if (!invitationsSnapshot.empty) {
            const invitation = invitationsSnapshot.docs[0].data();
            setEmailSent(true);
            
            // Format timestamp if available
            if (invitation.emailSentAt) {
              const sentTime = invitation.emailSentAt.toDate();
              const formattedTime = sentTime.toLocaleString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
              setEmailSentTime(formattedTime);
            }
          }
        } catch (error) {
          console.error('Fehler beim Prüfen des Einladungsstatus:', error);
        }
      }
    };
    
    checkInvitationStatus();
  }, [staff.id, open]);

  /**
   * Handle toggling selection of services for staff member
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
      const path = `staff-profile-images/${shop.id || staff.shopId}`;
      // Upload image and return URL
      return await uploadImage(file, path);
    } catch (error) {
      console.error('Error uploading staff profile image:', error);
      toast.error('Fehler beim Hochladen des Profilbilds');
      throw error;
    }
  };

  /**
   * Handle form submission to update staff information
   */
  const handleSubmit = async () => {
    // Reset previous errors
    setEmailError(null);
    
    if (!name || !email || !phone || !role) {
      toast.error('Bitte füllen Sie alle Pflichtfelder aus');
      return;
    }

    try {
      // Upload new profile image if selected
      let newProfileImageUrl = profileImageUrl;
      if (profileImage) {
        try {
          newProfileImageUrl = await handleImageUpload(profileImage);
          setProfileImageUrl(newProfileImageUrl);
        } catch (error) {
          // Error handling already done in handleImageUpload
          // Continue with updating other staff data
        }
      }

      // Check if email changed and is already in use
      if (email !== staff.email) {
        console.log('Email changed, checking if in use:', email);
        const emailInUse = await isEmailInUse(email);
        console.log('Email in use result for edit:', emailInUse);
        
        if (emailInUse) {
          console.log('Email already in use for edit, showing error');
          const errorMessage = 'Diese E-Mail-Adresse wird bereits verwendet. Bitte wählen Sie eine andere E-Mail-Adresse.';
          toast.error(errorMessage, {
            duration: 5000,
            position: 'top-center',
            style: { background: '#f44336', color: 'white', fontWeight: 'bold' }
          });
          setEmailError(errorMessage);
          return;
        }
      }
      
      await updateStaff(staff.id, {
        profileImageUrl: newProfileImageUrl,
        name,
        email,
        phone,
        role,
        serviceIds: selectedServiceIds,
        workingHours,
      });

      toast.success('Mitarbeiter erfolgreich aktualisiert');
      onStaffUpdated();
      setOpen(false);
    } catch (error) {
      console.error('Error updating staff:', error);
      toast.error('Fehler beim Aktualisieren des Mitarbeiters');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Bearbeiten</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mitarbeiter bearbeiten</DialogTitle>
          <DialogDescription>
            Bearbeiten Sie die Details des Mitarbeiters oder generieren Sie einen Registrierungslink.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex flex-wrap space-x-1 rounded-md bg-muted p-1 mb-4">
            <button
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${activeTab === 'profile' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50'}`}
              onClick={() => setActiveTab('profile')}
            >
              Profil
            </button>
            <button
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${activeTab === 'services' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50'}`}
              onClick={() => setActiveTab('services')}
            >
              Services
            </button>
            <button
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${activeTab === 'working-hours' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50'}`}
              onClick={() => setActiveTab('working-hours')}
            >
              Arbeitszeiten
            </button>
            <button
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${activeTab === 'breaks' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50'}`}
              onClick={() => setActiveTab('breaks')}
            >
              Tägliche Pausen
            </button>
            <button
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${activeTab === 'recurring-breaks' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50'}`}
              onClick={() => setActiveTab('recurring-breaks')}
            >
              Wöchentliche Pausen
            </button>
          </div>
          
          <TabsContent value="profile" className="mt-4">
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="profileImage">Profilbild</Label>
                <div className="flex flex-col items-center gap-4">
                  {(profileImageUrl || staff.profileImageUrl) && (
                    <div className="relative w-32 h-32 rounded-full overflow-hidden border-2 border-primary">
                      <img 
                        src={profileImageUrl || staff.profileImageUrl} 
                        alt={`${staff.name} Profilbild`} 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <Input
                    id="profileImage"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        setProfileImage(files[0]);
                        // Create temporary URL for preview
                        const tempUrl = URL.createObjectURL(files[0]);
                        setProfileImageUrl(tempUrl);
                      }
                    }}
                  />
                </div>
              </div>
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
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
                  placeholder="max@beispiel.de"
                  className={emailError ? "border-red-500" : ""}
                />
                {emailError && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
                    <strong className="font-bold">Fehler: </strong>
                    <span className="block sm:inline">{emailError}</span>
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+49 123 4567890"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="role">Position</Label>
                <Input
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="z.B. Friseur"
                />
              </div>

              <div className="space-y-4">
                <div className="border-t pt-4">
                  <Label>Registrierungslink</Label>
                  <p className="text-sm text-muted-foreground mb-2">Generieren Sie einen Registrierungslink für den Mitarbeiter.</p>
                  {registrationLink ? (
                    <div className="space-y-2">
                      {emailSent && (
                        <div className="p-2 mb-2 bg-green-50 border border-green-200 rounded text-green-600">
                          <p className="text-sm">
                            <span className="font-medium">✓ E-Mail gesendet</span> {emailSentTime && `am ${emailSentTime}`}
                          </p>
                        </div>
                      )}
                      <div className="p-2 bg-muted rounded break-all">
                        <a href={registrationLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                          {registrationLink}
                        </a>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            navigator.clipboard.writeText(registrationLink);
                            toast.success('Link in die Zwischenablage kopiert');
                          }}
                        >
                          Link kopieren
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={async () => {
                            try {
                              // Create a new invitation first so we have a valid ID
                              const invitation = await createStaffInvitation(shop.id, email);
                              
                              // Use brain client with valid invitation ID
                              const response = await brain.send_staff_invitation({
                                invitation_id: invitation.id,
                                shop_id: shop.id,
                                email: email,
                                invitation_link: registrationLink
                              });
                              
                              // Debug output
                              console.log('E-Mail Response Status:', response.status);
                              
                              if (response.ok) {
                                console.log('E-Mail erfolgreich versendet');
                                // Save success state
                                setEmailSent(true);
                                // Save current time
                                const now = new Date();
                                const formattedTime = now.toLocaleString('de-DE', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                });
                                setEmailSentTime(formattedTime);
                                
                                // Toast with extended display time
                                toast.success('Registrierungslink per E-Mail versendet', {
                                  duration: 4000,
                                  position: 'top-center'
                                });
                              } else {
                                const errorText = await response.text();
                                console.error('Error sending invitation email:', errorText);
                                toast.error('Fehler beim Versenden der Einladungs-E-Mail', {
                                  duration: 4000,
                                  position: 'top-center'
                                });
                              }
                            } catch (error) {
                              console.error('Error sending invitation email:', error);
                              toast.error('Fehler beim Versenden der Einladungs-E-Mail');
                            }
                          }}
                        >
                          Per E-Mail senden
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setRegistrationLink('')}
                      >
                        Neuen Link generieren
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={async () => {
                        try {
                          // Create invitation but don't send email automatically
                          const invitation = await createStaffInvitation(shop.id, email, false);
                          const link = `${window.location.origin}${APP_BASE_PATH}/staff-registration?token=${invitation.token}`;
                          setRegistrationLink(link);
                          toast.success('Registrierungslink generiert');
                        } catch (error) {
                          console.error('Error creating staff invitation:', error);
                          toast.error('Fehler beim Erstellen des Registrierungslinks');
                        }
                      }}
                    >
                      Registrierungslink generieren
                    </Button>
                  )}
                </div>
              </div>
              <div className="pt-4">
                <Button onClick={handleSubmit} className="w-full">Änderungen speichern</Button>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="services" className="mt-4">
            <div className="grid gap-4 py-4">
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
              <div className="pt-4">
                <Button onClick={handleSubmit} className="w-full">Änderungen speichern</Button>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="working-hours" className="mt-4">
            <div className="grid gap-4 py-4">
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
              <div className="pt-4">
                <Button onClick={handleSubmit} className="w-full">Änderungen speichern</Button>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="breaks" className="mt-4">
            <BreakManager staff={staff} shopId={shop.id} />
          </TabsContent>
          
          <TabsContent value="recurring-breaks" className="mt-4">
            <RecurringBreakManager staff={staff} shopId={shop.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
