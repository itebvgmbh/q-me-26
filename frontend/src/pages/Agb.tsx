import { Link } from 'react-router-dom';
import { LegalPage } from '../components/LegalPage';
import { COMPANY } from '@/constants/legal';

export default function Agb() {
  return (
    <LegalPage title="Allgemeine Geschäftsbedingungen" updated="19.10.2026">
      <section>
        <h2>1. Geltungsbereich</h2>
        <p>
          Diese Bedingungen gelten für die Nutzung von Dranzeit durch Läden und Betriebe („Kunde“). Anbieter ist die{' '}
          {COMPANY.name}, {COMPANY.street}, {COMPANY.postalCode} {COMPANY.city} („wir“). Dranzeit richtet sich ausschließlich
          an Unternehmer im Sinne von § 14 BGB. Abweichende Bedingungen des Kunden gelten nicht. Für Kunden der Läden, die
          eine Nummer ziehen oder einen Termin buchen, ist Dranzeit kostenlos; für sie gelten diese Bedingungen nicht.
        </p>
      </section>

      <section>
        <h2>2. Leistungen</h2>
        <p>
          Dranzeit ist eine Web-Anwendung für Warteschlange und Terminbuchung. Welche Funktionen ein Tarif enthält, steht auf
          der <Link to="/preise">Preisseite</Link> zum Zeitpunkt der Buchung. Wir entwickeln Dranzeit weiter und dürfen
          Funktionen ändern, solange der Kern eines gebuchten Tarifs erhalten bleibt.
        </p>
        <p>
          Wir bemühen uns um eine hohe Verfügbarkeit. Wartungen legen wir möglichst außerhalb üblicher Öffnungszeiten. Eine
          bestimmte Verfügbarkeit schulden wir nicht, soweit nichts anderes vereinbart ist.
        </p>
      </section>

      <section>
        <h2>3. Testphase, Gratis-Tarif und Gründerangebot</h2>
        <ul>
          <li>Ein neuer Laden kann 30 Tage alle Funktionen kostenlos nutzen. Die Testphase endet automatisch und kostet nichts.</li>
          <li>Danach läuft der Laden im Gratis-Tarif weiter, bis der Kunde ein Abo abschließt. Der Gratis-Tarif ist begrenzt (siehe Preisseite).</li>
          <li>
            Gründerangebot: Die ersten 100 Läden, die es annehmen, nutzen Dranzeit 3 Monate kostenlos und danach den Tarif
            „Laden“ zum Gründerpreis, solange ihr Abo ohne Unterbrechung läuft. Der Kunde lässt das QR-Plakat von Dranzeit
            sichtbar im Laden hängen und gibt uns in den ersten 3 Monaten einmal im Monat Rückmeldung. Wir dürfen den Laden
            mit Namen als Referenz nennen; das kann der Kunde jederzeit widerrufen.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Vertragsschluss, Preise und Zahlung</h2>
        <ul>
          <li>Ein Abo kommt zustande, wenn der Kunde es unter „Mein Tarif“ abschließt und die Bezahlung bestätigt.</li>
          <li>Es gelten die Preise der Preisseite zum Zeitpunkt des Abschlusses, zuzüglich der gesetzlichen Umsatzsteuer.</li>
          <li>
            Die Abrechnung erfolgt im Voraus für den gewählten Zeitraum (Monat oder Jahr) über unseren Zahlungsdienstleister
            Stripe per SEPA-Lastschrift oder Karte. Rechnungen erhält der Kunde per E-Mail.
          </li>
          <li>Wir erheben keine Provision und keine Gebühren je Kunde oder Termin.</li>
          <li>
            Preisänderungen kündigen wir mindestens 6 Wochen vorher per E-Mail an. Der Kunde kann dann zum Zeitpunkt der
            Änderung kündigen. Für Gründer gilt der Gründerpreis dauerhaft, solange das Abo ohne Unterbrechung läuft.
          </li>
          <li>Ist eine Zahlung offen, dürfen wir den Laden nach erfolgloser Erinnerung auf den Gratis-Tarif zurückstufen.</li>
        </ul>
      </section>

      <section>
        <h2>5. Laufzeit und Kündigung</h2>
        <p>
          Monatsabos laufen einen Monat, Jahresabos ein Jahr, und verlängern sich jeweils um denselben Zeitraum. Der Kunde
          kann jederzeit unter „Mein Tarif“ zum Ende des bezahlten Zeitraums kündigen. Danach läuft der Laden im
          Gratis-Tarif weiter. Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt.
        </p>
      </section>

      <section>
        <h2>6. Pflichten des Kunden</h2>
        <ul>
          <li>Der Kunde hält seine Angaben (Laden, Öffnungszeiten, Leistungen, Preise) aktuell und ist für sie verantwortlich.</li>
          <li>Er schützt seine Zugangsdaten und lädt nur Personen ins Team ein, die für ihn arbeiten.</li>
          <li>
            Er nutzt Dranzeit nicht für rechtswidrige Zwecke und informiert seine Kunden über die Verarbeitung ihrer Daten,
            soweit das Gesetz es verlangt.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Auftragsverarbeitung (Art. 28 DSGVO)</h2>
        <p>
          Namen, Kontaktdaten und Termine der Kunden des Ladens verarbeiten wir im Auftrag des Kunden. Verantwortlicher ist der
          Kunde. Dieser Abschnitt ist die Vereinbarung zur Auftragsverarbeitung.
        </p>
        <ul>
          <li>
            <strong>Gegenstand und Zweck:</strong> Betrieb der Warteschlange und Terminbuchung, Benachrichtigungen und
            Erinnerungen an die Kunden des Ladens.
          </li>
          <li>
            <strong>Daten und Betroffene:</strong> Name, Telefonnummer, E-Mail-Adresse, Termine und Wartenummern der Kunden
            des Ladens; Name und E-Mail-Adresse der Mitarbeitenden.
          </li>
          <li>
            <strong>Weisungen:</strong> Wir verarbeiten die Daten nur nach Weisung des Kunden, die durch die Nutzung der
            Funktionen von Dranzeit erteilt wird, und nicht für eigene Zwecke.
          </li>
          <li>
            <strong>Vertraulichkeit und Sicherheit:</strong> Alle Personen mit Zugriff sind zur Vertraulichkeit verpflichtet.
            Daten werden verschlüsselt übertragen, Zugriffe sind auf das Nötige beschränkt.
          </li>
          <li>
            <strong>Unterauftragsverarbeiter:</strong> Hetzner Online GmbH (Server in Deutschland), Google Ireland Limited
            (Firebase: Anmeldung, Datenbank), Resend, Inc. (E-Mail-Versand) sowie die Push-Dienste der Browser-Hersteller. Über
            neue Unterauftragsverarbeiter informieren wir vorher; der Kunde kann widersprechen.
          </li>
          <li>
            <strong>Unterstützung:</strong> Wir helfen dem Kunden bei Anfragen Betroffener und bei Datenpannen und melden
            Verletzungen des Schutzes seiner Daten unverzüglich.
          </li>
          <li>
            <strong>Löschung:</strong> Namen und Kontaktdaten bei Nummern ohne Konto entfernen wir 90 Tage nach dem Termin.
            Nach Vertragsende löschen wir die Daten des Ladens innerhalb von 30 Tagen, soweit keine Aufbewahrungspflicht besteht.
          </li>
          <li>
            <strong>Nachweise:</strong> Auf Anfrage weisen wir die Einhaltung dieser Pflichten nach.
          </li>
        </ul>
      </section>

      <section>
        <h2>8. Haftung</h2>
        <p>
          Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, für Schäden aus der Verletzung des Lebens, des Körpers
          oder der Gesundheit und nach dem Produkthaftungsgesetz. Bei leichter Fahrlässigkeit haften wir nur für die Verletzung
          wesentlicher Vertragspflichten und begrenzt auf den vertragstypischen, vorhersehbaren Schaden, höchstens auf die
          Entgelte der letzten 12 Monate. Für Ausfälle, die wir nicht zu vertreten haben, etwa bei Dienstleistern oder im
          Internet, haften wir nicht.
        </p>
      </section>

      <section>
        <h2>9. Änderungen dieser Bedingungen</h2>
        <p>
          Änderungen kündigen wir mindestens 6 Wochen vorher per E-Mail an. Widerspricht der Kunde nicht bis zum Inkrafttreten,
          gelten sie als angenommen; darauf weisen wir in der Ankündigung hin. Widerspricht er, kann jede Seite zum
          Inkrafttreten kündigen.
        </p>
      </section>

      <section>
        <h2>10. Schlussbestimmungen</h2>
        <p>
          Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Gerichtsstand ist Berlin. Sollte eine Bestimmung
          unwirksam sein, bleiben die übrigen wirksam.
        </p>
      </section>
    </LegalPage>
  );
}
