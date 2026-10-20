import { Link } from 'react-router-dom';
import { LegalPage } from '../components/LegalPage';
import { COMPANY } from '@/constants/legal';

export default function Datenschutz() {
  return (
    <LegalPage title="Datenschutz" updated="20.10.2026">
      <section>
        <h2>Wer verantwortlich ist</h2>
        <p>
          {COMPANY.name}, {COMPANY.street}, {COMPANY.postalCode} {COMPANY.city}, vertreten durch den Geschäftsführer{' '}
          {COMPANY.managingDirector}. E-Mail: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>, Telefon:{' '}
          {COMPANY.phone}. Weitere Angaben im <Link to="/impressum">Impressum</Link>.
        </p>
        <p>
          Dranzeit ist ein Werkzeug für Läden. Termine und Wartenummern, die du bei einem Laden buchst oder ziehst,
          verwaltet der Laden mit Dranzeit. Für diese Daten ist der Laden verantwortlich, wir verarbeiten sie in seinem
          Auftrag. Für dein Konto bei Dranzeit, diese Webseite und die Abrechnung mit den Läden sind wir selbst
          verantwortlich.
        </p>
      </section>

      <section>
        <h2>Was wir verarbeiten und wozu</h2>
        <ul>
          <li>
            <strong>Nummer ziehen ohne Konto:</strong> gewählter Laden, Leistung, Person und Uhrzeit, dazu der Name und,
            wenn du sie angibst, Telefonnummer oder E-Mail-Adresse. Damit der Laden dich aufrufen und dir Bescheid geben
            kann (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li>
            <strong>Konto:</strong> E-Mail-Adresse, Name, auf Wunsch Telefonnummer, und deine Termine. Du meldest dich mit
            E-Mail-Adresse und Passwort an; das Passwort prüft Google Firebase, wir sehen es nicht. Hat ein Laden dich als
            Kunde angelegt und du verbindest dein Konto über seinen Link, gehören die Termine, die der Laden für dich
            einträgt, zu deinem Konto (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li>
            <strong>Früher dran:</strong> Wenn du es einschaltest, prüfen wir, ob ein früherer Platz frei wird, und
            bieten ihn dir an (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li>
            <strong>Benachrichtigungen:</strong> Wenn du sie erlaubst, schicken wir dir eine Nachricht, kurz bevor du
            dran bist. Dafür speichern wir die Adresse, die dein Browser dafür erzeugt. Du kannst das jederzeit in den
            Browser-Einstellungen abschalten (Art. 6 Abs. 1 lit. a DSGVO).
          </li>
          <li>
            <strong>Läden:</strong> Angaben zum Laden, zum Team und zu den Leistungen sowie die Daten für die
            Abrechnung des Abos (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li>
            <strong>Server-Protokolle:</strong> IP-Adresse, Zeitpunkt, aufgerufene Adresse und Browser-Kennung, um den
            Betrieb zu sichern und Angriffe zu erkennen (Art. 6 Abs. 1 lit. f DSGVO).
          </li>
        </ul>
        <p>
          Wir setzen keine Werbe- oder Analyse-Cookies ein und verfolgen dich nicht über andere Seiten. Im Browser
          speichern wir nur, was die App zum Funktionieren braucht, etwa deine Anmeldung oder eine Nummer, die du ohne
          Konto gezogen hast.
        </p>
      </section>

      <section>
        <h2>Wie lange wir Daten speichern</h2>
        <ul>
          <li>Namen und Kontaktdaten bei Nummern ohne Konto entfernen wir 90 Tage nach dem Termin.</li>
          <li>Kontodaten speichern wir, bis du dein Konto löschst oder uns um Löschung bittest.</li>
          <li>Server-Protokolle löschen wir nach spätestens 14 Tagen.</li>
          <li>Rechnungsdaten der Läden bewahren wir so lange auf, wie das Steuer- und Handelsrecht es verlangt.</li>
        </ul>
      </section>

      <section>
        <h2>Dienstleister, die wir einsetzen</h2>
        <ul>
          <li>
            <strong>Hetzner Online GmbH</strong> (Gunzenhausen): Server in Deutschland, auf dem Dranzeit läuft.
          </li>
          <li>
            <strong>Google Firebase</strong> (Google Ireland Limited, Dublin): Anmeldung, Datenbank für Läden, Termine
            und Wartenummern, Speicher für Ladenlogos.
          </li>
          <li>
            <strong>Resend</strong> (Resend, Inc., San Francisco): Versand von E-Mails, zum Beispiel Einladungen ins
            Team und Erinnerungen an Termine.
          </li>
          <li>
            <strong>Stripe</strong> (Stripe Payments Europe Ltd., Dublin): Abrechnung der Abos der Läden. Kunden der
            Läden zahlen über Dranzeit nichts.
          </li>
          <li>
            <strong>Push-Dienste der Browser-Hersteller</strong> (zum Beispiel Google, Apple, Mozilla): Zustellung der
            Benachrichtigungen. Der Inhalt wird dabei verschlüsselt übertragen.
          </li>
          <li>
            <strong>OpenStreetMap</strong> (OpenStreetMap Foundation, Großbritannien): Kartenbilder auf der Shop-Karte
            und Umwandlung von Adressen in Koordinaten. Beim Laden der Karte erhält der Dienst deine IP-Adresse.
          </li>
          <li>
            <strong>Nur beim Einrichten eines Ladens:</strong> Google Places (Google Ireland Limited) sucht den Laden
            bei Google, und Anthropic (Anthropic, PBC, San Francisco) liest die Preisliste von der Webseite des Ladens.
            Dabei werden keine Kundendaten übertragen.
          </li>
        </ul>
        <p>
          Mit diesen Dienstleistern bestehen Verträge zur Auftragsverarbeitung, soweit sie Daten in unserem Auftrag
          verarbeiten. Werden dabei Daten in Länder außerhalb der EU übermittelt, geschieht das auf Grundlage eines
          Angemessenheitsbeschlusses der EU-Kommission (etwa des EU-US Data Privacy Framework) oder der
          EU-Standardvertragsklauseln.
        </p>
      </section>

      <section>
        <h2>Deine Rechte</h2>
        <p>
          Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit
          und Widerspruch (Art. 15 bis 21 DSGVO). Eine Einwilligung kannst du jederzeit für die Zukunft widerrufen.
          Schreib uns dafür an <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>. Geht es um einen Termin bei
          einem Laden, leiten wir deine Anfrage an den Laden weiter.
        </p>
        <p>
          Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der Berliner
          Beauftragten für Datenschutz und Informationsfreiheit.
        </p>
      </section>
    </LegalPage>
  );
}
