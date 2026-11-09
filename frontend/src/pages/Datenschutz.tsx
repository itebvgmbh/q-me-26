import { Link } from 'react-router-dom';
import { LegalPage } from '../components/LegalPage';
import { COMPANY } from '@/constants/legal';
import { cookieEinstellungenOeffnen, statistikMoeglich } from '../utils/statistik';

export default function Datenschutz() {
  return (
    <LegalPage title="Datenschutz" updated="09.11.2026">
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
            E-Mail-Adresse und Passwort an. Das Passwort speichern wir nur als Prüfwert (Argon2), lesbar sehen wir es
            nie. Für Konten von vor November 2026 prüft Google Firebase, wo die Anmeldung bis dahin lag, das Passwort bei
            der ersten Anmeldung danach noch einmal. Hat ein Laden dich als
            Kunde angelegt und du verbindest dein Konto über seinen Link, gehören die Termine, die der Laden für dich
            einträgt, zu deinem Konto (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li>
            <strong>Vom Laden angelegt:</strong> Trägt ein Laden dich in seine Kundenliste ein, speichern wir den Namen,
            die E-Mail-Adresse und, wenn angegeben, die Telefonnummer, die der Laden einträgt, und die Termine, die er für
            dich vereinbart (Art. 6 Abs. 1 lit. b DSGVO).
          </li>
          <li id="telefon-assistent">
            <strong>Telefon-Assistent eines Ladens:</strong> Leitet ein Laden seine Anrufe zu unserem Telefon-Assistenten
            um, nimmt eine KI deinen Anruf an, wenn im Laden niemand rangeht. Das sagt sie im ersten Satz. Dabei verarbeiten
            wir deine Telefonnummer, wenn du sie nicht unterdrückst, das Gespräch selbst und was du darin sagst, etwa deinen
            Namen und deinen Terminwunsch. Das Gespräch wird live in Text umgewandelt, ein Sprachmodell bildet die Antwort,
            eine künstliche Stimme spricht sie. Aufnahmen machen wir nicht. Buchst du einen Termin oder ziehst eine Nummer,
            steht er beim Laden wie jede andere Buchung, und du stehst mit Namen und Telefonnummer in seiner Kundenliste.
            Rufst du später von derselben Nummer an, erkennt dich der Assistent daran, spricht dich mit Namen an und kennt
            deine Termine bei diesem Laden. Jeden Anruf sieht der Laden in seiner Anrufliste mit Zeitpunkt, Dauer, Nummer
            und Ergebnis, damit er zurückrufen kann. Verantwortlich ist der Laden, wir verarbeiten die Daten in seinem
            Auftrag. Rechtsgrundlage ist für die Buchung Art. 6 Abs. 1 lit. b DSGVO, für das Wiedererkennen und die
            Anrufliste Art. 6 Abs. 1 lit. f DSGVO: Der Laden möchte seine Kunden am Telefon erkennen und verpasste Anrufe
            zurückrufen können. Möchtest du das nicht, sag es dem Laden. Löscht er dich aus seiner Kundenliste,
            verschwinden auch deine Anrufe aus seiner Anrufliste.
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
            Salons oder per E-Mail an uns. Damit niemand fremde Einträge entfernt, geben Salons dort eine E-Mail-Adresse an:
            Liegt sie an der Domain der Salon-Webseite oder steht sie auf dieser Webseite (dazu rufen wir deren Start-,
            Impressums- und Kontaktseite auf), schicken wir einen Bestätigungslink, und mit dem Bestätigen geht die Seite
            offline. Sonst prüfen wir die Anfrage von Hand und melden uns. Genauso zeigen Salons, dass eine Seite ihre ist,
            wenn sie sie übernehmen möchten: Mit dem Link richten sie ihren Laden ein und verbinden ihn mit der Seite. Adresse
            und Grund stehen im Protokoll auf unserem Server. An die Geschäftsadresse des Salons können wir
            einen Brief schicken, der auf die Seite hinweist und anbietet, sie zu übernehmen (ebenfalls Art. 6 Abs. 1 lit. f
            DSGVO). Gedruckt und verschickt wird er von der PIN AG. Auch dem lässt sich jederzeit widersprechen, dann schreiben
            wir nicht mehr: mit „Keine Post mehr“ unten auf der Seite des Salons, per E-Mail oder per Brief an uns. Damit das
            auch gilt, wenn ein Eintrag gelöscht und der Salon später neu aufgenommen wird, behalten wir eine Prüfsumme der
            Anschrift, aber weder Namen noch Anschrift. Der Knopf „Das wünsch ich mir“ zählt nur mit;
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
          Wir setzen keine Werbe-Cookies ein und verfolgen dich nicht über andere Seiten. Im Browser speichern wir, was
          die App zum Funktionieren braucht, etwa deine Anmeldung, eine Nummer, die du ohne Konto gezogen hast, und deine
          Wahl im Cookie-Banner (§ 25 Abs. 2 Nr. 2 TDDDG). Statistik-Cookies von Google Analytics nur, wenn du zustimmst
          (nächster Abschnitt).
        </p>
      </section>

      <section id="statistik">
        <h2>Statistik mit Google Analytics</h2>
        <p>
          Wenn du im Cookie-Banner „Alle akzeptieren“ wählst, nutzen wir Google Analytics 4, einen Dienst der Google
          Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland („Google“). Damit sehen wir, wie Besucher
          Dranzeit finden und nutzen, zum Beispiel welche Seiten aufgerufen werden, über welche Suche oder Seite jemand
          kommt und ob sich ein Laden anmeldet oder jemand eine Nummer zieht. So verbessern wir die Seiten und das
          Angebot.
        </p>
        <ul>
          <li>
            <strong>Welche Daten:</strong> aufgerufene Seiten, Zeitpunkt und Dauer, die Seite, von der du kommst,
            ungefährer Standort (Land, Region, Stadt), Gerät, Browser, Betriebssystem, Bildschirmgröße und Sprache, eine
            zufällige Kennung in einem Cookie sowie Ereignisse wie „Laden angemeldet“ oder „Nummer gezogen“. Namen,
            E-Mail-Adressen, Telefonnummern, Termine oder den gewählten Laden geben wir nicht an Google weiter.
          </li>
          <li>
            <strong>IP-Adresse:</strong> Google Analytics 4 speichert keine IP-Adressen. Google nutzt sie bei Zugriffen
            aus der EU nur auf Servern in der EU, um den ungefähren Standort zu bestimmen, und verwirft sie danach.
          </li>
          <li>
            <strong>Cookies:</strong> <code>_ga</code> und <code>_ga_RG8P11CJNJ</code> unterscheiden Besucher und
            Besuche. Sie bleiben bis zu 2 Jahre in deinem Browser, wenn du sie nicht vorher löschst oder widerrufst.
          </li>
          <li>
            <strong>Speicherdauer bei Google:</strong> Ereignisdaten, die einer Kennung zugeordnet sind, löscht Google
            nach 14 Monaten.
          </li>
          <li>
            <strong>Übermittlung in die USA:</strong> Google kann Daten auch auf Servern der Google LLC in den USA
            verarbeiten. Google LLC ist nach dem EU-US Data Privacy Framework zertifiziert; dafür gilt der
            Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO), ergänzend die EU-Standardvertragsklauseln.
          </li>
          <li>
            <strong>Rechtsgrundlage:</strong> deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Ohne
            Einwilligung laden wir Google Analytics gar nicht: Es werden keine Cookies gesetzt und keine Daten an Google
            geschickt.
          </li>
          <li>
            <strong>Widerruf:</strong> jederzeit für die Zukunft über „Cookie-Einstellungen“ unten auf jeder Seite oder
            hier, mit „Nur notwendige“. Die Cookies von Google Analytics löschen wir dann in deinem Browser.
          </li>
          <li>
            In der App aus Google Play und dem App Store, auf dem Wartezimmer-Bildschirm im Laden und im Dranzeit-Kasten
            auf Webseiten von Läden setzen wir Google Analytics nicht ein.
          </li>
        </ul>
        {statistikMoeglich() && (
          <p>
            <button type="button" onClick={cookieEinstellungenOeffnen} className="underline underline-offset-2">
              Cookie-Einstellungen ändern
            </button>
          </p>
        )}
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
            Kunden, die ein Laden angelegt hat, auch über seinen Telefon-Assistenten nach einer Buchung am Telefon,
            löschen wir 12 Monate nach dem letzten Termin, ohne Termin 12 Monate nach dem Anlegen, solange kein Konto
            verbunden ist. Der Laden kann sie jederzeit selbst löschen.
          </li>
          <li>
            Anrufe beim Telefon-Assistenten eines Ladens löschen wir 90 Tage nach dem Anruf aus seiner Anrufliste, die
            Anrufe einer Nummer auch dann, wenn der Laden den Kunden mit dieser Nummer aus seiner Kundenliste löscht. Die
            Mitschrift des Gesprächs und die technischen Protokolle bei Vapi werden nach 14 Tagen gelöscht.
          </li>
          <li>Die Adresse für Benachrichtigungen im Browser löschen wir nach 3 Tagen.</li>
          <li>
            Kontodaten speichern wir, bis du dein Konto löschst (unter „Mein Profil“) oder uns um Löschung bittest. Dann
            sagen wir kommende Termine ab und entfernen deinen Namen aus früheren. Konten von Läden und Teams löschen wir
            auf Anfrage.
          </li>
          <li>Server-Protokolle löschen wir nach spätestens 14 Tagen.</li>
          <li>
            Google Analytics (nur mit Einwilligung): Ereignisdaten nach 14 Monaten, die Cookies <code>_ga</code> und{' '}
            <code>_ga_RG8P11CJNJ</code> nach spätestens 2 Jahren. Deine Wahl im Cookie-Banner bleibt in deinem Browser, bis
            du sie änderst oder die Website-Daten löschst.
          </li>
          <li>
            Die Prüfsumme der Anschrift eines Salons, der keine Post von uns möchte, behalten wir ohne Frist, weil nur so der
            Widerspruch dauerhaft gilt.
          </li>
          <li>Rechnungsdaten der Läden bewahren wir so lange auf, wie das Steuer- und Handelsrecht es verlangt.</li>
        </ul>
      </section>

      <section>
        <h2>Dienstleister, die wir einsetzen</h2>
        <ul>
          <li>
            <strong>Hetzner Online GmbH</strong> (Gunzenhausen): Server in Deutschland, auf dem Dranzeit läuft, mit
            Datenbank, Anmeldung und Ladenlogos.
          </li>
          <li>
            <strong>Google Firebase</strong> (Google Ireland Limited, Dublin): bis November 2026 Anmeldung, Datenbank und
            Speicher für Ladenlogos. Die Daten liegen seitdem auf unserem Server; bei Google bleibt nur eine alte Kopie,
            bis wir das Firebase-Projekt löschen.
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
            <strong>PIN AG</strong> (Berlin): Druck und Versand der Briefe an Salons aus dem Verzeichnis. Sie erhält dafür
            den Brief mit Anschrift und Übernahme-Code und löscht ihn spätestens nach 28 Tagen.
          </li>
          <li>
            <strong>Push-Dienste der Browser-Hersteller</strong> (zum Beispiel Google, Apple, Mozilla): Zustellung der
            Benachrichtigungen. Der Inhalt wird dabei verschlüsselt übertragen.
          </li>
          <li>
            <strong>Google Analytics</strong> (Google Ireland Limited, Dublin): Statistik über die Nutzung der Seiten, nur
            mit deiner Einwilligung (siehe „Statistik mit Google Analytics“).
          </li>
          <li>
            <strong>OpenStreetMap</strong> (OpenStreetMap Foundation, Großbritannien): Kartenbilder auf der Shop-Karte
            und Umwandlung von Adressen in Koordinaten. Beim Laden der Karte erhält der Dienst deine IP-Adresse.
          </li>
          <li>
            <strong>Nur bei Anrufen beim Telefon-Assistenten eines Ladens:</strong> Twilio (Twilio Ireland Limited, Dublin)
            stellt die Rufnummer und verbindet den Anruf. Vapi (Vapi, Inc., San Francisco) betreibt die Sprach-KI und setzt
            dafür ein: Soniox (Soniox, Inc., USA) für die Spracherkennung, OpenAI (OpenAI, USA) für das Sprachmodell und
            Microsoft Azure (Microsoft Ireland Operations Limited, Dublin) für die Stimme. Sie erhalten das Gespräch, deine
            Telefonnummer und die Angaben zum Laden, die der Assistent braucht. Vapi behält eine Mitschrift und die
            Protokolle des Gesprächs (siehe „Wie lange wir Daten speichern“).
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
