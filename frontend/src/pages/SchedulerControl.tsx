import { useSchedulerControl } from '../utils/hooks/useSchedulerControl';
import { SchedulerStatusCard } from '../components/SchedulerStatusCard';
import { SchedulerControlCard } from '../components/SchedulerControlCard';
import { SchedulerResultCard } from '../components/SchedulerResultCard';
import { NotificationHistoryTable } from '../components/NotificationHistoryTable';

/**
 * "Früher dran": Status des Hintergrunddienstes und Verlauf der Angebote.
 * Steuern (Start/Stopp, Takt, sofort prüfen) darf nur der Betreiber der App (QME_ADMIN_EMAILS auf dem
 * Server) – der Dienst gilt für alle Läden. Inhaber sehen den Verlauf ihrer eigenen Läden.
 */
const SchedulerControl = () => {
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
    formatDateTime,
  } = useSchedulerControl();

  if (loading && !status) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-10 sm:px-6" aria-busy="true" aria-label="Wird geladen">
        <div className="h-10 w-56 animate-pulse rounded-2xl bg-muted" />
        <div className="h-40 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }

  const minutes = Math.round((status?.interval_seconds ?? 300) / 60);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Früher dran</p>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Frühere Plätze anbieten</h1>
        <p className="text-muted-foreground">
          Wird ein Termin abgesagt oder verschoben, bietet q-me den frei gewordenen Platz der nächsten Person in der Reihe an.
          Zusätzlich prüft ein Hintergrunddienst alle {minutes} Minuten.
        </p>
      </div>

      {status?.can_control ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SchedulerStatusCard
            status={status}
            loading={loading}
            actionLoading={actionLoading}
            formatDateTime={formatDateTime}
            startScheduler={startScheduler}
            stopScheduler={stopScheduler}
            loadStatus={loadStatus}
          />
          <SchedulerControlCard
            interval={interval}
            actionLoading={actionLoading}
            setInterval={setInterval}
            updateInterval={updateInterval}
            runNow={runNow}
            checkEarlierSlots={checkEarlierSlots}
          />
        </div>
      ) : (
        <section className="flex flex-col gap-1 rounded-3xl border border-border bg-card p-5 sm:p-6" aria-label="Status">
          <p className="font-semibold">{status?.is_running ? 'Der Hintergrunddienst läuft.' : 'Der Hintergrunddienst läuft gerade nicht.'}</p>
          <p className="text-sm text-muted-foreground">
            Letzte Prüfung: {formatDateTime(status?.last_run ?? null)}. Er gilt für alle Läden; steuern kann ihn nur der Betreiber der App.
          </p>
        </section>
      )}

      <SchedulerResultCard checkResult={checkResult} />

      <NotificationHistoryTable historyItems={historyItems} historyLoading={historyLoading} loadHistory={loadHistory} />
    </div>
  );
};

export default SchedulerControl;
