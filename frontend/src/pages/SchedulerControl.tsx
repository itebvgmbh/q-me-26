import { useUserGuardContext } from 'app';
import { Navigation } from '../components/Navigation';

// Import custom hook for scheduler control functionality
import { useSchedulerControl } from '../utils/hooks/useSchedulerControl';

// Import extracted UI components
import { SchedulerStatusCard } from '../components/SchedulerStatusCard';
import { SchedulerControlCard } from '../components/SchedulerControlCard';
import { SchedulerResultCard } from '../components/SchedulerResultCard';
import { NotificationHistoryTable } from '../components/NotificationHistoryTable';


/**
 * SchedulerControl component
 * 
 * Provides an interface for admins to control the scheduler that checks for earlier appointment slots
 * Uses extracted components for different parts of the UI to improve maintainability
 */
const SchedulerControl = () => {
  const { user } = useUserGuardContext();
  
  // Use the custom hook to handle all scheduler functionality
  const {
    status,
    interval,
    loading,
    actionLoading,
    checkResult,
    historyItems,
    historyLoading,
    setInterval,
    loadStatus,
    loadHistory,
    startScheduler,
    stopScheduler,
    updateInterval,
    runNow,
    checkEarlierSlots,
    formatDateTime
  } = useSchedulerControl();

  // Show loading state if data is still being fetched
  if (loading && !status) {
    return (
      <>
        <Navigation />
        <div className="container mx-auto py-8">
          <p>Lädt...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        <h1 className="text-2xl font-bold">Scheduler-Kontrolle</h1>
        <p className="text-sm text-slate-600">
          Diese Seite ermöglicht die Kontrolle des Schedulers, der frühere Terminoptionen für Kunden prüft.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Status Card */}
          <SchedulerStatusCard 
            status={status}
            loading={loading}
            actionLoading={actionLoading}
            formatDateTime={formatDateTime}
            startScheduler={startScheduler}
            stopScheduler={stopScheduler}
            loadStatus={loadStatus}
          />

          {/* Interval Settings Card */}
          <SchedulerControlCard
            interval={interval}
            actionLoading={actionLoading}
            setInterval={setInterval}
            updateInterval={updateInterval}
            runNow={runNow}
            checkEarlierSlots={checkEarlierSlots}
          />
        </div>

        {/* Result Card */}
        <SchedulerResultCard checkResult={checkResult} />
        
        {/* History Table */}
        <NotificationHistoryTable
          historyItems={historyItems}
          historyLoading={historyLoading}
          loadHistory={loadHistory}
        />
      </div>
    </>
  );
};

export default SchedulerControl;