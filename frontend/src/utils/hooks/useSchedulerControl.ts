import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import brain from 'brain';

/**
 * Interface for scheduler status response from the API
 */
export interface SchedulerStatus {
  is_running: boolean;
  last_run: string | null;
  interval_seconds: number;
  next_run: string | null;
}

/**
 * Interface for notification history item from the API
 */
export interface NotificationHistoryItem {
  id: string;
  appointmentId: string;
  userId: string;
  userName?: string;
  shopId: string;
  shopName?: string;
  staffId: string;
  staffName?: string;
  originalStartTime: string;
  earlierStartTime: string;
  createdAt: string;
  isAccepted: boolean;
  acceptedAt?: string;
  timeDifference?: number;
  appointmentDuration?: number;
}

/**
 * Custom hook for controlling the scheduler functionality
 * Provides methods and state for managing the appointment slot checker
 * 
 * @returns All state and methods needed for scheduler control
 */
export const useSchedulerControl = () => {
  // State management
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [interval, setInterval] = useState<number>(3600);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [historyItems, setHistoryItems] = useState<NotificationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /**
   * Loads the notification history from the API
   */
  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await brain.get_notification_history_full2222222({});
      const data = await response.json();
      setHistoryItems(data);
    } catch (error) {
      console.error('Error loading notification history:', error);
      toast.error('Fehler beim Laden des Benachrichtigungsverlaufs');
    } finally {
      setHistoryLoading(false);
    }
  };

  /**
   * Loads the current scheduler status from the API
   */
  const loadStatus = async () => {
    setLoading(true);
    try {
      const response = await brain.get_scheduler_status();
      const data = await response.json();
      setStatus(data);
      setInterval(data.interval_seconds);
    } catch (error) {
      console.error('Error loading scheduler status:', error);
      toast.error('Fehler beim Laden des Scheduler-Status');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Starts the scheduler
   */
  const startScheduler = async () => {
    setActionLoading(true);
    try {
      await brain.start_scheduler();
      toast.success('Scheduler erfolgreich gestartet');
      loadStatus();
    } catch (error) {
      console.error('Error starting scheduler:', error);
      toast.error('Fehler beim Starten des Schedulers');
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Stops the scheduler
   */
  const stopScheduler = async () => {
    setActionLoading(true);
    try {
      await brain.stop_scheduler();
      toast.success('Scheduler erfolgreich gestoppt');
      loadStatus();
    } catch (error) {
      console.error('Error stopping scheduler:', error);
      toast.error('Fehler beim Stoppen des Schedulers');
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Updates the scheduler interval
   */
  const updateInterval = async () => {
    setActionLoading(true);
    try {
      await brain.set_interval({ interval_seconds: interval });
      toast.success('Intervall erfolgreich aktualisiert');
      loadStatus();
    } catch (error) {
      console.error('Error updating interval:', error);
      toast.error('Fehler beim Aktualisieren des Intervalls');
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Runs the scheduler check immediately
   */
  const runNow = async () => {
    setActionLoading(true);
    try {
      const response = await brain.run_now();
      const data = await response.json();
      setCheckResult(data.result);
      toast.success('Überprüfung erfolgreich durchgeführt');
      
      // Immediately load status
      await loadStatus();
      
      // Load history with a small delay to ensure new data is available
      setTimeout(() => {
        loadHistory();
      }, 3000);
    } catch (error) {
      console.error('Error running check now:', error);
      toast.error('Fehler beim Ausführen der Überprüfung');
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Checks for earlier available slots
   */
  const checkEarlierSlots = async () => {
    setActionLoading(true);
    try {
      const response = await brain.check_earlier_slots_v2();
      const data = await response.json();
      setCheckResult(data);
      toast.success('Überprüfung auf frühere Slots erfolgreich durchgeführt');
      
      // Immediately load status
      await loadStatus();
      
      // Load history with a small delay to ensure new data is available
      setTimeout(() => {
        loadHistory();
      }, 2000);
    } catch (error) {
      console.error('Error checking for earlier slots:', error);
      toast.error('Fehler bei der Überprüfung auf frühere Slots');
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Formats a date string for display
   * @param dateStr The date string to format
   * @returns The formatted date string
   */
  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return 'Nie';
    // Ensure consistent timezone handling for all date displays
    return new Date(dateStr).toLocaleString(undefined, { timeZone: 'Europe/Berlin' });
  };

  // Load initial data on mount
  useEffect(() => {
    loadStatus();
    loadHistory();
    const statusIntervalId = setInterval(loadStatus, 5000); // Refresh status every 5 seconds
    const historyIntervalId = setInterval(loadHistory, 30000); // Refresh history every 30 seconds
    return () => {
      clearInterval(statusIntervalId);
      clearInterval(historyIntervalId);
    };
  }, []);

  return {
    // State
    status,
    interval,
    loading,
    actionLoading,
    checkResult,
    historyItems,
    historyLoading,
    // Methods
    setInterval,
    loadStatus,
    loadHistory,
    startScheduler,
    stopScheduler,
    updateInterval,
    runNow,
    checkEarlierSlots,
    formatDateTime
  };
};
