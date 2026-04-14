import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Service } from '../utils/firestore/types';
import { cn } from '../utils/cn';
// Import icons from lucide-react
import {
  Scissors,
  Clock,
  Ruler,
  Sparkles,
  Paintbrush,
  Heart,
  Brush,
  Bath,
  Shirt,
  Palette,
  Smartphone,
  Laptop,
  Coffee,
  Shapes,
  BedDouble,
  CircleDollarSign,
  Wand2
} from 'lucide-react';

// Map service keywords to icons
const getServiceIcon = (service: Service) => {
  const name = service.name.toLowerCase();
  const description = service.description?.toLowerCase() || '';
  
  // Look for keywords in name and description to determine the most appropriate icon
  if (name.includes('schnitt') || name.includes('haircut') || name.includes('schneiden')) {
    return <Scissors className="h-10 w-10" />;
  } else if (name.includes('färben') || name.includes('coloring') || name.includes('farbe')) {
    return <Palette className="h-10 w-10" />;
  } else if (name.includes('waschen') || name.includes('wash') || name.includes('shampoo')) {
    return <Bath className="h-10 w-10" />;
  } else if (name.includes('föhnen') || name.includes('blow') || name.includes('dry')) {
    return <Sparkles className="h-10 w-10" />;
  } else if (name.includes('styling') || name.includes('style')) {
    return <Brush className="h-10 w-10" />;
  } else if (name.includes('massage')) {
    return <Heart className="h-10 w-10" />;
  } else if (name.includes('maniküre') || name.includes('manicure') || name.includes('nagel') || name.includes('nail')) {
    return <Scissors className="h-10 w-10" />;
  } else if (name.includes('pediküre') || name.includes('pedicure') || name.includes('fuß') || name.includes('foot')) {
    return <Ruler className="h-10 w-10" />;
  } else if (name.includes('bart') || name.includes('beard')) {
    return <Scissors className="h-10 w-10" />;
  } else if (name.includes('gesicht') || name.includes('facial')) {
    return <Wand2 className="h-10 w-10" />;
  }
  
  // Default icon if no match
  return <Scissors className="h-10 w-10" />;
};

export interface ServiceSelectionProps {
  services: Service[];
  selectedService: string;
  onSelectService: (serviceId: string) => void;
}

export const ServiceSelection = ({
  services,
  selectedService,
  onSelectService
}: ServiceSelectionProps) => {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Wählen Sie einen Service</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {services.map((service) => (
          <Card 
            key={service.id} 
            className={cn(
              "cursor-pointer transition-all hover:scale-105",
              selectedService === service.id ? 
                "border-2 border-blue-400 bg-blue-50" : 
                "border border-gray-200 bg-white"
            )}
            onClick={() => onSelectService(service.id)}
          >
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className="mb-2 text-blue-600">
                {getServiceIcon(service)}
              </div>
              <h3 className="font-medium mb-1">{service.name}</h3>
              <p className="text-sm text-gray-500 mb-2">{service.duration} Min</p>
              <p className="font-semibold">{service.price.toFixed(2)} €</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
