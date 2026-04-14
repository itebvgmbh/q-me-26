import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  checkResult: any;
}

/**
 * Component for displaying the results of scheduler checks
 */
export const SchedulerResultCard = ({ checkResult }: Props) => {
  if (!checkResult) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Letzte Prüfung Ergebnisse</CardTitle>
        <CardDescription>Details zur letzten Überprüfung auf frühere Termine</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="bg-slate-50 p-4 rounded-md text-sm overflow-auto">
          {JSON.stringify(checkResult, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
};
