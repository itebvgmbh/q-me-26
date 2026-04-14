import { useState, useEffect } from 'react';
import { Shop } from '../firestore';
import { CalendarTimeSlot } from '../types';

/**
 * Custom hook to manage the booking form state
 */
export const useBookingForm = (initialShops: Shop[]) => {
  // Industry and shop selection
  const [selectedIndustry, setSelectedIndustry] = useState<string>('');
  const [selectedShop, setSelectedShop] = useState<string>('');
  const [filteredShops, setFilteredShops] = useState<Shop[]>([]);
  const [fromMarketplace, setFromMarketplace] = useState<boolean>(false);
  
  // Staff and service selection
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [selectedService, setSelectedService] = useState<string>('');
  
  // Calendar and timeslot selection
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<CalendarTimeSlot | null>(null);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [calendarView, setCalendarView] = useState<'interactive' | 'timeline' | 'slots'>('interactive');
  const [refreshTimestamp, setRefreshTimestamp] = useState<number>(Date.now());
  
  // Options
  const [checkEarlierOptions, setCheckEarlierOptions] = useState(false);

  // Parse URL params on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopIdParam = params.get('shopId');
    const serviceIdParam = params.get('serviceId');
    const fromMarketplaceParam = params.get('fromMarketplace');
    
    if (shopIdParam) {
      setSelectedShop(shopIdParam);
    }
    
    if (serviceIdParam) {
      setSelectedService(serviceIdParam);
    }

    if (fromMarketplaceParam === 'true') {
      setFromMarketplace(true);
    }
  }, []);

  // Set the selected industry if a shop is already selected
  useEffect(() => {
    if (selectedShop && initialShops.length > 0) {
      const shop = initialShops.find(s => s.id === selectedShop);
      if (shop?.industry) {
        setSelectedIndustry(shop.industry);
      }
    }
  }, [selectedShop, initialShops]);
  
  // Filter shops by selected industry
  useEffect(() => {
    if (selectedIndustry && !fromMarketplace) {
      const filtered = initialShops.filter(shop => shop.industry === selectedIndustry);
      setFilteredShops(filtered);
      
      // Reset selected shop only if not coming from marketplace
      if (!selectedShop || initialShops.find(s => s.id === selectedShop)?.industry !== selectedIndustry) {
        setSelectedShop('');
      }
    } else if (selectedIndustry && fromMarketplace && selectedShop) {
      const filtered = initialShops.filter(shop => shop.industry === selectedIndustry);
      setFilteredShops(filtered);
    } else {
      setFilteredShops(initialShops);
    }
  }, [selectedIndustry, initialShops, fromMarketplace, selectedShop]);

  // Reset staff selection when shop changes
  useEffect(() => {
    if (selectedShop) {
      setSelectedStaff('');
    }
  }, [selectedShop]);

  // Reset form state for appointment booking
  const resetForm = () => {
    setSelectedStaff('');
    setSelectedTimeSlot(null);
    setSelectedService('');
    setRefreshTimestamp(Date.now());
  };

  return {
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
    setCurrentDate,
    calendarView,
    setCalendarView,
    refreshTimestamp,
    setRefreshTimestamp,
    
    // Options
    checkEarlierOptions,
    setCheckEarlierOptions,
    
    // Functions
    resetForm
  };
};
