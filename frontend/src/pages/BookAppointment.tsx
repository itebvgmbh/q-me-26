import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { toast } from 'sonner';
import { Navigation } from '../components/Navigation';
import { createCustomer } from '../utils/firestore';
import { BookingForm } from '../components/BookingForm';

// Import custom hooks
import { useShops } from '../utils/hooks/useShops';
import { useShopServices } from '../utils/hooks/useShopServices';
import { useShopStaff } from '../utils/hooks/useShopStaff';
import { useAppointmentBooking } from '../utils/hooks/useAppointmentBooking';
import { useBookingForm } from '../utils/hooks/useBookingForm';
import { useBookingValidation } from '../utils/hooks/useBookingValidation';

const BookAppointment = () => {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { bookAppointment } = useAppointmentBooking();
  const { validateBookingForm } = useBookingValidation();
  
  // Get shops data with loading state
  const { shops, loading: shopsLoading } = useShops();
  
  // Use the booking form hook to manage all form state
  const {
    // Selection state
    selectedIndustry,
    setSelectedIndustry,
    selectedShop,
    setSelectedShop,
    filteredShops,
    fromMarketplace,
    
    // Staff/service state
    selectedStaff,
    setSelectedStaff,
    selectedService,
    setSelectedService,
    
    // Calendar state
    selectedTimeSlot,
    setSelectedTimeSlot,
    currentDate,
    calendarView,
    setCalendarView,
    refreshTimestamp,
    setRefreshTimestamp,
    
    // Options
    checkEarlierOptions,
    setCheckEarlierOptions,
    
    // Reset function
    resetForm
  } = useBookingForm(shops);
  
  // Get staff and services data based on selected shop
  const { staff } = useShopStaff(selectedShop);
  const { services } = useShopServices(selectedShop);
  
  const handleBookAppointment = async () => {
    if (!user) {
      // Redirect to PublicJoinQueue page for anonymous booking
      navigate(`/public-join-queue?shopId=${selectedShop}&serviceId=${selectedService}`);
      return;
    }

    // Validate the form inputs
    const isValid = validateBookingForm({
      selectedShop,
      selectedStaff,
      selectedService,
      selectedTimeSlot
    });
    
    if (!isValid) return;

    try {
      // Create or retrieve customer record
      try {
        await createCustomer({
          shopId: selectedShop,
          name: user.displayName || user.email?.split('@')[0] || 'Unbekannt',
          email: user.email || '',
          phone: '', // Optional
          userId: user.uid,
        });
      } catch (err) {
        console.error('Error with customer record, but continuing...', err);
      }

      // Book appointment using our hook
      const result = await bookAppointment(
        selectedShop,
        selectedStaff,
        selectedService,
        user.uid,
        user.displayName || (user.email ? user.email.split('@')[0] : null) || user.providerData?.[0]?.displayName || 'Unbekannt',
        user.email,
        selectedTimeSlot,
        checkEarlierOptions
      );

      if (result.success) {
        // Reset form state after successful booking
        resetForm();
      }
    } catch (error) {
      console.error('Error in booking process:', error);
      toast.error('Fehler beim Buchen des Termins');
    }
  };

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Termin buchen</h1>
        </div>

        {shopsLoading ? (
          <div className="container mx-auto py-8">
            <p>Lädt...</p>
          </div>
        ) : (
          <BookingForm
            // Shop data
            filteredShops={filteredShops}
            fromMarketplace={fromMarketplace}
            services={services}
            staff={staff}
            
            // Selection state
            selectedIndustry={selectedIndustry}
            selectedShop={selectedShop}
            selectedStaff={selectedStaff}
            selectedService={selectedService}
            selectedTimeSlot={selectedTimeSlot}
            
            // Calendar state
            currentDate={currentDate}
            calendarView={calendarView}
            refreshTimestamp={refreshTimestamp}
            checkEarlierOptions={checkEarlierOptions}
            
            // Handlers
            onIndustryChange={setSelectedIndustry}
            onShopChange={setSelectedShop}
            onStaffChange={setSelectedStaff}
            onServiceChange={setSelectedService}
            onTimeSlotSelect={setSelectedTimeSlot}
            onCheckEarlierOptionsChange={setCheckEarlierOptions}
            onCalendarViewChange={setCalendarView}
            onBookAppointment={handleBookAppointment}
          />
        )}
      </div>
    </>
  );
};

export default BookAppointment;