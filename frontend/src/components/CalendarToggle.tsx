import { Button } from '@/components/ui/button';

type CalendarView = 'interactive' | 'timeline' | 'slots';

interface Props {
  calendarView: CalendarView;
  setCalendarView: (view: CalendarView) => void;
}

export function CalendarToggle({ calendarView, setCalendarView }: Props) {
  return (
    <div className="space-x-2">
      <Button 
        variant={calendarView === 'interactive' ? "default" : "outline"}
        onClick={() => setCalendarView('interactive')}
      >
        Interaktiv
      </Button>
      <Button 
        variant={calendarView === 'timeline' ? "default" : "outline"}
        onClick={() => setCalendarView('timeline')}
      >
        Zeitleiste
      </Button>
      <Button 
        variant={calendarView === 'slots' ? "default" : "outline"}
        onClick={() => setCalendarView('slots')}
      >
        Zeitslots
      </Button>
    </div>
  );
}
