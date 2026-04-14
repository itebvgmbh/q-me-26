import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IndustrySelector } from './IndustrySelector';
import { ShopSelector } from './ShopSelector';
import { StaffSelector } from './StaffSelector';
import { ServiceSelector } from './ServiceSelector';
import { CalendarToggle } from './CalendarToggle';
import { CustomerTimelineView } from './CustomerTimelineView';
import { TimelineView } from './TimelineView';
import { CustomerCalendar } from './CustomerCalendar';
import { BookingConfirmation } from './BookingConfirmation';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Staff, Service, Shop } from '../utils/firestore';
import { CalendarTimeSlot } from '../utils/types';
import { toast } from 'sonner';

interface BookingFormProps {
  // Shop data
  filteredShops: Shop[];
  fromMarketplace: boolean;
  services: Service[];
  staff: Staff[];
  
  // Selection state
  selectedIndustry: string;
  selectedShop: string;
  selectedStaff: string;
  selectedService: string;
  selectedTimeSlot: CalendarTimeSlot | null;
  
  // Calendar state
  currentDate: Date;
  calendarView: 'interactive' | 'timeline' | 'slots';
  refreshTimestamp: number;
  checkEarlierOptions: boolean;
  
  // Handlers
  onIndustryChange: (industry: string) => void;
  onShopChange: (shop: string) => void;
  onStaffChange: (staff: string) => void;
  onServiceChange: (service: string) => void;
  onTimeSlotSelect: (timeSlot: CalendarTimeSlot) => void;
  onCheckEarlierOptionsChange: (checked: boolean) => void;
  onCalendarViewChange: (view: 'interactive' | 'timeline' | 'slots') => void;
  onBookAppointment: () => void;
}

export function BookingForm({
  // Shop data
  filteredShops,
  fromMarketplace,
  services,
  staff,
  
  // Selection state
  selectedIndustry,
  selectedShop,
  selectedStaff,
  selectedService,
  selectedTimeSlot,
  
  // Calendar state
  currentDate,
  calendarView,
  refreshTimestamp,
  checkEarlierOptions,
  
  // Handlers
  onIndustryChange,
  onShopChange,
  onStaffChange,
  onServiceChange,
  onTimeSlotSelect,
  onCheckEarlierOptionsChange,
  onCalendarViewChange,
  onBookAppointment
}: BookingFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Termindetails</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!fromMarketplace && (
          <IndustrySelector 
            selectedIndustry={selectedIndustry} 
            onIndustryChange={onIndustryChange} 
          />
        )}

        {(selectedIndustry || fromMarketplace) && (
          <ShopSelector 
            shops={filteredShops} 
            selectedShop={selectedShop} 
            onShopChange={onShopChange} 
          />
        )}

        {selectedShop && (
          <StaffSelector 
            staff={staff} 
            selectedStaff={selectedStaff} 
            onStaffChange={onStaffChange} 
          />
        )}

        {selectedShop && (
          <ServiceSelector 
            services={services} 
            selectedService={selectedService} 
            onServiceChange={onServiceChange} 
          />
        )}

        {selectedService && (
          <>
            <div className="flex justify-between mb-4">
              <h3 className="text-lg font-medium mt-2">Terminfindung - Wählen Sie einen verfügbaren Zeitslot</h3>
              <CalendarToggle 
                calendarView={calendarView} 
                setCalendarView={onCalendarViewChange}
              />
            </div>
            
            <div className="p-4 bg-gray-50 rounded-md space-y-2">
              {calendarView === 'interactive' ? (
                <CustomerTimelineView
                  shopId={selectedShop}
                  serviceId={selectedService}
                  staffId={selectedStaff}
                  services={services}
                  startDate={currentDate}
                  numDays={1}
                  forceRefresh={refreshTimestamp}
                  onTimeSlotSelect={(timeSlot) => {
                    onTimeSlotSelect(timeSlot);
                    toast.success(`Zeitslot von ${format(timeSlot.start, 'HH:mm')} bis ${format(timeSlot.end, 'HH:mm')} ausgewählt`);
                  }}
                />
              ) : calendarView === 'timeline' ? (
                <TimelineView 
                  employee={staff.find(s => s.id === selectedStaff) || null}
                  appointments={[]}
                  services={services}
                  startDate={currentDate}
                  numDays={1}
                  onAppointmentUpdate={() => {}}
                  onDateChange={() => {}}
                  onNumDaysChange={() => {}}
                />
              ) : (
                <CustomerCalendar 
                  shopId={selectedShop}
                  serviceId={selectedService}
                  staffId={selectedStaff}
                  forceRefresh={refreshTimestamp}
                  onTimeSlotSelect={(timeSlot) => {
                    onTimeSlotSelect(timeSlot);
                    toast.success(`Zeitslot von ${format(timeSlot.start, 'HH:mm')} bis ${format(timeSlot.end, 'HH:mm')} ausgewählt`);
                  }}
                />
              )}
            </div>

            {selectedTimeSlot && (
              <BookingConfirmation 
                timeSlot={selectedTimeSlot}
                checkEarlierOptions={checkEarlierOptions}
                onCheckEarlierOptionsChange={onCheckEarlierOptionsChange}
              />
            )}

            {selectedTimeSlot && (
              <div className="mt-4">
                <Button 
                  onClick={onBookAppointment}
                  className="w-full"
                >
                  Termin buchen
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
