import { useState, useMemo } from 'react';
import { Staff } from '../utils/firestore/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '../utils/cn';

export interface EmployeeSelectionProps {
  staff: Staff[];
  selectedService: string;
  selectedStaff: string;
  onSelectStaff: (staffId: string) => void;
  onSelectAny: () => void;
  useAnyStaff: boolean;
}

export const EmployeeSelection = ({
  staff,
  selectedService,
  selectedStaff,
  onSelectStaff,
  onSelectAny,
  useAnyStaff
}: EmployeeSelectionProps) => {
  // Filter staff who can perform the selected service
  const eligibleStaff = useMemo(() => {
    if (!selectedService) return [];
    return staff.filter(s => s.serviceIds.includes(selectedService));
  }, [staff, selectedService]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Wählen Sie einen Mitarbeiter</h2>
      
      {/* Option for any staff */}
      <Card 
        className={cn(
          "cursor-pointer transition-all hover:scale-105 mb-4",
          useAnyStaff ? 
            "border-2 border-blue-400 bg-blue-50" : 
            "border border-gray-200 bg-white"
        )}
        onClick={onSelectAny}
      >
        <CardContent className="p-4 flex items-center">
          <div className="bg-blue-100 rounded-full p-3 mr-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium">Nächster freier Mitarbeiter</h3>
            <p className="text-sm text-gray-500">Schnellere Bedienung</p>
          </div>
          <Badge className="ml-auto bg-green-100 text-green-800 hover:bg-green-100">Empfohlen</Badge>
        </CardContent>
      </Card>

      {/* Staff cards */}
      <div className="grid grid-cols-1 gap-4">
        {eligibleStaff.length > 0 ? (
          eligibleStaff.map((employee) => (
            <Card 
              key={employee.id} 
              className={cn(
                "cursor-pointer transition-all hover:scale-105",
                selectedStaff === employee.id && !useAnyStaff ? 
                  "border-2 border-blue-400 bg-blue-50" : 
                  "border border-gray-200 bg-white"
              )}
              onClick={() => onSelectStaff(employee.id)}
            >
              <CardContent className="p-4 flex items-center">
                <Avatar className="h-12 w-12 mr-4">
                  <div className="bg-blue-100 rounded-full h-12 w-12 flex items-center justify-center">
                    <span className="text-blue-600 font-medium">
                      {employee.name.split(' ').map(n => n[0]).join('')}
                    </span>
                  </div>
                </Avatar>
                <div>
                  <h3 className="font-medium">{employee.name}</h3>
                  <p className="text-sm text-gray-500">
                    {employee.status === 'available' 
                      ? 'Verfügbar' 
                      : employee.status === 'busy' 
                        ? 'Beschäftigt' 
                        : employee.status === 'break' 
                          ? 'Pause' 
                          : 'Nicht im Dienst'}
                  </p>
                </div>
                <div className="ml-auto">
                  <Badge 
                    className={cn(
                      employee.status === 'available' ? "bg-green-100 text-green-800" :
                      employee.status === 'busy' ? "bg-orange-100 text-orange-800" :
                      employee.status === 'break' ? "bg-blue-100 text-blue-800" :
                      "bg-gray-100 text-gray-800"
                    )}
                  >
                    {employee.status === 'available' ? 'Verfügbar' : 
                     employee.status === 'busy' ? 'Beschäftigt' : 
                     employee.status === 'break' ? 'Pause' : 
                     'Abwesend'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-gray-500">Es gibt keine Mitarbeiter, die diesen Service anbieten können.</p>
        )}
      </div>
    </div>
  );
};
