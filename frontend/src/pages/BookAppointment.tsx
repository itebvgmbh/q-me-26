import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { toast } from 'sonner';
import { createCustomer } from '../utils/firestore';
import { BookingForm } from '../components/BookingForm';
import { useShops } from '../utils/hooks/useShops';
import { useShopServices } from '../utils/hooks/useShopServices';
import { useShopStaff } from '../utils/hooks/useShopStaff';
import { useAppointmentBooking } from '../utils/hooks/useAppointmentBooking';
import { useBookingForm } from '../utils/hooks/useBookingForm';
import { useBookingValidation } from '../utils/hooks/useBookingValidation';

const BookAppointment = () => {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { bookAppointment, loading: submitting } = useAppointmentBooking();
  const { validateBookingForm } = useBookingValidation();
  const { shops, loading: shopsLoading } = useShops(null);

  const {
    selectedShop,
    setSelectedShop,
    selectedStaff,
    setSelectedStaff,
    selectedService,
    setSelectedService,
    selectedTimeSlot,
    setSelectedTimeSlot,
    refreshTimestamp,
    checkEarlierOptions,
    setCheckEarlierOptions,
  } = useBookingForm(shops);

  const { staff: allStaff } = useShopStaff(selectedShop);
  const { services } = useShopServices(selectedShop);
  // Nur wer die Leistung anbietet; sind keine Leistungen zugeordnet, alle zeigen
  const eligible = allStaff.filter((s) => s.serviceIds?.includes(selectedService));
  const staff = selectedService && eligible.length > 0 ? eligible : allStaff;
  const [staffFromUrl] = useState(() => new URLSearchParams(window.location.search).get('staffId'));

  // Mitarbeiter vorbelegen: aus der URL (nach dem Login) oder wenn es nur eine Person gibt
  const staffKey = staff.map((s) => s.id).join(',');
  useEffect(() => {
    if (staff.length === 0) return;
    if (selectedStaff) {
      // Person bietet die neu gewählte Leistung nicht an
      if (!staff.some((s) => s.id === selectedStaff)) setSelectedStaff('');
      return;
    }
    if (staffFromUrl && staff.some((s) => s.id === staffFromUrl)) setSelectedStaff(staffFromUrl);
    else if (staff.length === 1) setSelectedStaff(staff[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffKey, staffFromUrl, selectedStaff, setSelectedStaff]);

  // Gewählte Zeit verwerfen, sobald sich Leistung oder Person ändert
  useEffect(() => {
    setSelectedTimeSlot(null);
  }, [selectedShop, selectedService, selectedStaff, setSelectedTimeSlot]);

  const params = new URLSearchParams({ fromMarketplace: 'true' });
  if (selectedShop) params.set('shopId', selectedShop);
  if (selectedService) params.set('serviceId', selectedService);
  if (selectedStaff) params.set('staffId', selectedStaff);
  const loginHref = `/login?next=${encodeURIComponent(`/book-appointment?${params.toString()}`)}`;

  const handleBookAppointment = async () => {
    if (!user) {
      navigate(loginHref);
      return;
    }
    if (!validateBookingForm({ selectedShop, selectedStaff, selectedService, selectedTimeSlot })) return;

    try {
      try {
        await createCustomer({
          shopId: selectedShop,
          name: user.displayName || user.email?.split('@')[0] || 'Unbekannt',
          email: user.email || '',
          phone: '',
          userId: user.uid,
        });
      } catch (err) {
        console.error('Error with customer record, but continuing...', err);
      }

      const result = await bookAppointment(
        selectedShop,
        selectedStaff,
        selectedService,
        user.uid,
        user.displayName || (user.email ? user.email.split('@')[0] : null) || 'Unbekannt',
        user.email,
        selectedTimeSlot!,
        checkEarlierOptions,
      );
      if (result.success) navigate('/my-bookings');
    } catch (error) {
      console.error('Error in booking process:', error);
      toast.error('Der Termin konnte nicht gebucht werden. Versuch es noch einmal.');
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Termin buchen</h1>
        <p className="text-muted-foreground">Feste Uhrzeit aussuchen. Lieber sofort? Dann reih dich in die Schlange ein.</p>
      </div>

      {shopsLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Shops werden geladen">
          <div className="h-28 animate-pulse rounded-3xl bg-muted" />
          <div className="h-28 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : (
        <BookingForm
          shops={shops}
          services={services}
          staff={staff}
          selectedShop={selectedShop}
          selectedStaff={selectedStaff}
          selectedService={selectedService}
          selectedTimeSlot={selectedTimeSlot}
          refreshTimestamp={refreshTimestamp}
          checkEarlierOptions={checkEarlierOptions}
          isLoggedIn={!!user}
          submitting={submitting}
          loginHref={loginHref}
          onShopChange={(id) => {
            setSelectedShop(id);
            setSelectedService('');
          }}
          onStaffChange={setSelectedStaff}
          onServiceChange={setSelectedService}
          onTimeSlotSelect={setSelectedTimeSlot}
          onCheckEarlierOptionsChange={setCheckEarlierOptions}
          onBookAppointment={handleBookAppointment}
        />
      )}
    </div>
  );
};

export default BookAppointment;
