import { Link } from 'react-router-dom';
import { LegalPage } from '../components/LegalPage';
import { COMPANY } from '@/constants/legal';

export default function Datenschutz() {
  return (
    <LegalPage title="Datenschutz" updated="21.10.2026">
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
            wenn du sie angibst, Telefonnummer oder E-Mail-Adresse. Damit der Laden dich aufrufen und, wenn nötig,
            anrufen kann und wir dir Bescheid geben können (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li>
            <strong>Konto:</strong> E-Mail-Adresse, Name, auf Wunsch Telefonnummer, und deine Termine. Name und
            Telefonnummer sieht der Laden bei deinen Terminen. Du meldest dich mit
            E-Mail-Adresse und Passwort an; das Passwort prüft Google Firebase, wir sehen es nicht. Hat ein Laden dich als
            Kunde angelegt und du verbindest dein Konto über seinen Link, gehören die Termine, die der Laden für dich
            einträgt, zu deinem Konto (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li>
            <strong>Vom Laden angelegt:</strong> Trägt ein Laden dich in seine Kundenliste ein, speichern wir den Namen,
            die E-Mail-Adresse und, wenn angegeben, die Telefonnummer, die der Laden einträgt, und die Termine, die er für
            dich vereinbart (Art. 6 Abs. 1 lit. b DSGVO).
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
            <strong>Salon-Verzeichnis:</strong> Für Friseure und Barbershops, die (noch) nicht bei Dranzeit sind, zeigen wir
            eine Seite mit Name, Adresse, Telefon, Webseite, Öffnungszeiten, Preisen und einer kurzen Beschreibung. Die
            Angaben stammen von der eigenen Webseite des Salons und sind dort öffentlich; die Beschreibung fassen wir mit
            KI zusammen und prüfen sie. Wir wollen Kunden helfen, einen Salon in der Nähe zu finden (Art. 6 Abs. 1 lit. f
            DSGVO). Wer zum Salon gehört, kann dem jederzeit widersprechen: über „Eintrag entfernen“ auf der Seite des
            Salons, dann geht sie sofort offline, oder per E-Mail an uns. An die Geschäftsadresse des Salons können wir
            einen Brief schicken, der auf die Seite hinweist und anbietet, sie zu übernehmen (ebenfalls Art. 6 Abs. 1 lit. f
            DSGVO); auch dem lässt sich jederzeit widersprechen, dann schreiben wir nicht mehr. Der Knopf „Das wünsch ich mir“ zählt nur mit;
            damit niemand mehrfach zählt, halten wir bis zum Ende des Tages eine Prüfsumme der IP-Adresse im
            Arbeitsspeicher, nicht die Adresse selbst.
          </li>
          <li>
            <strong>Dranzeit-Kasten auf Webseiten von Läden:</strong> Bindet ein Laden unseren Kasten auf seiner Webseite ein,
            lädt dein Browser ihn von dranzeit.de. Dabei fallen nur die Server-Protokolle an (siehe unten). Der Kasten setzt
            keine Cookies und speichert nichts in deinem Browser (Art. 6 Abs. 1 lit. f DSGVO).
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
          <li>
            Namen und Kontaktdaten bei Nummern und Terminen ohne Konto entfernen wir 90 Tage nach dem Termin, auch bei
            Kunden, die ein Laden angelegt hat. Bei Terminen mit Konto entfernen wir nach 90 Tagen Telefonnummer und
            E-Mail-Adresse am Termin, dein Name bleibt in deinen Terminen. Uhrzeit, Leistung und Person bleiben für die
            Auswertung des Ladens.
          </li>
          <li>
            Kunden, die ein Laden angelegt hat, löschen wir 12 Monate nach dem letzten Termin, ohne Termin 12 Monate nach
            dem Anlegen, solange kein Konto verbunden ist. Der Laden kann sie jederzeit selbst löschen.
          </li>
          <li>Die Adresse für Benachrichtigungen im Browser löschen wir nach 3 Tagen.</li>
          <li>
            Kontodaten speichern wir, bis du dein Konto löschst (unter „Mein Profil“) oder uns um Löschung bittest. Dann
            sagen wir kommende Termine ab und entfernen deinen Namen aus früheren. Konten von Läden und Teams löschen wir
            auf Anfrage.
          </li>
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
            <strong>Resend</strong> (Resend, Inc., San Francisco): Versand von E-Mails, zum Beispiel Bestätigung der
            E-Mail-Adresse, Einladungen ins Team und Erinnerungen an Termine.
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
            <strong>Nur beim Einrichten eines Ladens und für das Salon-Verzeichnis:</strong> Google Places (Google
            Ireland Limited) sucht den Laden bei Google, und Anthropic (Anthropic, PBC, San Francisco) liest die
            Preisliste und die Angaben von der Webseite des Ladens. Dabei werden keine Kundendaten übertragen.
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
