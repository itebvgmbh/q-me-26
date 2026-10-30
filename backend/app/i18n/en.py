"""Englisch (britisch wie im Frontend, en-GB). Schlüssel ist der deutsche Text aus dem Code; geprüft in tests/test_i18n.py."""

TEXTE: dict = {
    # Wochentage, Tage (app/i18n, app/libs/queue_notify.py)
    "Mo": "Mon",
    "Di": "Tue",
    "Mi": "Wed",
    "Do": "Thu",
    "Fr": "Fri",
    "Sa": "Sat",
    "So": "Sun",
    "heute": "today",
    "morgen": "tomorrow",
    "am {wochentag} {tag}.{monat}.": "on {wochentag} {tag}/{monat}",
    # Push und E-Mails zur Nummer oder zum Termin (app/libs/queue_notify.py, app/libs/notify_worker.py)
    "Dein Laden": "Your shop",
    "Du bist dran": "It's your turn",
    "{laden} ruft dich auf. Komm jetzt rein.": "{laden} is calling you. Come in now.",
    "Gleich bist du dran": "You're up soon",
    "{laden}: Du bist als Nächstes dran. Mach dich auf den Weg.": "{laden}: You're next. Time to head over.",
    "{laden}: Nur noch {n} vor dir. Mach dich auf den Weg.": "{laden}: Only {n} ahead of you. Time to head over.",
    "Erinnerung an deinen Termin": "Reminder of your appointment",
    "{laden}, heute um {zeit}. Kannst du nicht? Dann sag bitte ab.": "{laden}, today at {zeit}. Can't make it? Then please cancel.",
    "Abgesagt": "Cancelled",
    "{laden} hat deine Nummer {wann} um {zeit} abgesagt.": "{laden} has cancelled your number {wann} at {zeit}.",
    "{laden} hat deinen Termin {wann} um {zeit} abgesagt.": "{laden} has cancelled your appointment {wann} at {zeit}.",
    "Neue Uhrzeit": "New time",
    "{laden} hat deinen Termin verschoben: jetzt {wann} um {zeit}": "{laden} has moved your appointment: now {wann} at {zeit}",
    "bei {name}": "with {name}",
    "(vorher {zeit})": "(previously {zeit})",
    "(vorher {wann} um {zeit})": "(previously {wann} at {zeit})",
    "Früher dran?": "Want an earlier slot?",
    "{laden}: {wann} um {zeit} ist ein Platz frei": "{laden}: {wann} at {zeit} there's a free slot",
    "(statt {zeit})": "(instead of {zeit})",
    "Bis {zeit} nur für dich – unter „Meine Termine“ annehmen.": "Reserved for you until {zeit} – accept it under “My appointments”.",
    "Nur kurz für dich reserviert – unter „Meine Termine“ annehmen.": "Reserved for you for a short time – accept it under “My appointments”.",
    "Nummer ansehen": "View number",
    "Angebot ansehen": "View offer",
    # Rahmen jeder E-Mail (app/libs/mail.py)
    "Klappt der Knopf nicht? Dann öffne diesen Link:": "Button not working? Then open this link:",
    "Impressum": "Legal notice",
    "Diese E-Mail wurde automatisch verschickt.": "This email was sent automatically.",
    # E-Mail-Adresse bestätigen (app/apis/email_verification)
    "Bitte bestätige deine E-Mail-Adresse": "Please confirm your email address",
    "Ist das deine E-Mail-Adresse?": "Is this your email address?",
    "Hallo, du hast bei Dranzeit ein Konto mit der Adresse <strong>{email}</strong> angelegt.":
        "Hello, you created a Dranzeit account with the address <strong>{email}</strong>.",
    "Hallo, du hast bei Dranzeit ein Konto mit der Adresse {email} angelegt.": "Hello, you created a Dranzeit account with the address {email}.",
    "Tipp auf den Knopf, dann ist sie bestätigt. So wissen wir, dass die Adresse wirklich dir gehört.":
        "Tap the button to confirm it. That way we know the address really belongs to you.",
    "Öffne diesen Link, dann ist sie bestätigt:": "Open this link to confirm it:",
    "E-Mail-Adresse bestätigen": "Confirm email address",
    "Du hast kein Konto bei Dranzeit angelegt? Dann hat sich jemand vertippt. Du kannst diese E-Mail einfach löschen.":
        "You didn't create a Dranzeit account? Then someone made a typo. You can simply delete this email.",
    "Wir haben dir gerade erst eine E-Mail geschickt. Warte eine Minute, dann geht es noch mal.":
        "We've only just sent you an email. Wait a minute, then you can try again.",
    "Heute haben wir dir schon {n} E-Mails geschickt. Versuch es morgen noch mal.": "We've already sent you {n} emails today. Please try again tomorrow.",
    "Zu deinem Konto gibt es keine E-Mail-Adresse.": "There's no email address for your account.",
    "Die E-Mail konnte gerade nicht verschickt werden. Versuch es später noch mal.": "The email couldn't be sent right now. Please try again later.",
    # Passwort vergessen (app/apis/password_reset)
    "Neues Passwort für Dranzeit": "New password for Dranzeit",
    "Neues Passwort setzen": "Set new password",
    "Hallo, für dein Dranzeit-Konto <strong>{email}</strong> wurde ein neues Passwort angefordert.":
        "Hello, a new password was requested for your Dranzeit account <strong>{email}</strong>.",
    "Hallo, für dein Dranzeit-Konto {email} wurde ein neues Passwort angefordert.": "Hello, a new password was requested for your Dranzeit account {email}.",
    "Tipp auf den Knopf und wähl ein neues Passwort. Der Link gilt eine Stunde.": "Tap the button and choose a new password. The link is valid for one hour.",
    "Öffne diesen Link und wähl ein neues Passwort (gilt eine Stunde):": "Open this link and choose a new password (valid for one hour):",
    "Du hast kein neues Passwort angefordert? Dann kannst du diese E-Mail einfach löschen. Dein Passwort bleibt, wie es ist.":
        "You didn't request a new password? Then you can simply delete this email. Your password stays as it is.",
    "Wir haben gerade erst eine E-Mail an diese Adresse geschickt. Warte eine Minute, dann geht es noch mal.":
        "We've only just sent an email to this address. Wait a minute, then you can try again.",
    "Heute ging schon zu oft eine E-Mail raus. Versuch es morgen noch mal.": "Too many emails have already been sent today. Please try again tomorrow.",
    "Diese E-Mail-Adresse sieht nicht richtig aus.": "This email address doesn't look right.",
    # Team-Einladung (app/apis/staff_invitation)
    "Einladung ins Team von {laden}": "Invitation to join the team at {laden}",
    "Du bist ins Team von {laden} eingeladen": "You've been invited to join the team at {laden}",
    "Du bist ins Team von {laden} eingeladen.": "You've been invited to join the team at {laden}.",
    "Hallo {name},": "Hello {name},",
    "Hallo,": "Hello,",
    "{hallo} <strong>{laden}</strong> nutzt Dranzeit für Termine und die Warteschlange und hat dich ins Team eingeladen.":
        "{hallo} <strong>{laden}</strong> uses Dranzeit for appointments and the queue and has invited you to join the team.",
    "Leg über den Link dein Konto an oder melde dich mit deinem bestehenden an. Danach siehst du unter „Mein Tag“ deine eigenen Kunden.":
        "Use the link to create your account or sign in with your existing one. You'll then see your own customers under “My day”.",
    "{laden} nutzt Dranzeit für Termine und die Warteschlange. Leg über diesen Link dein Konto an oder melde dich mit deinem bestehenden an:":
        "{laden} uses Dranzeit for appointments and the queue. Use this link to create your account or sign in with your existing one:",
    "Einladung annehmen": "Accept invitation",
    "Der Link gilt {n} Tage. Fragen beantwortet dir dein Laden.": {
        "one": "The link is valid for {n} day. Your shop can answer any questions.",
        "other": "The link is valid for {n} days. Your shop can answer any questions.",
    },
    "deinem Laden": "your shop",
    "An Testadressen wie example.com verschickt Dranzeit keine E-Mails.": "Dranzeit doesn't send emails to test addresses like example.com.",
    "Der E-Mail-Versand ist gerade nicht eingerichtet.": "Sending emails isn't set up right now.",
    "Die E-Mail konnte nicht verschickt werden.": "The email couldn't be sent.",
    "Diesen Einladungslink gibt es nicht oder er wurde durch einen neueren ersetzt. Bitte deinen Laden um einen neuen.":
        "This invitation link doesn't exist or has been replaced by a newer one. Please ask your shop for a new one.",
    "Diese Person gibt es nicht mehr. Lade die Seite neu.": "This person no longer exists. Please reload the page.",
    "Die Person": "This person",
    "andere Person": "someone else",
    "{name} hat schon ein Konto und sieht „Mein Tag“.": "{name} already has an account and sees “My day”.",
    "{name} ist deaktiviert. Hol sie zuerst zurück ins Team.": "{name} is deactivated. Bring them back into the team first.",
    "Für die E-Mail fehlt die Adresse. Trag sie unter „Bearbeiten“ ein und speichere.": "The email address is missing. Enter it under “Edit” and save.",
    "Diese Einladung wurde schon mit einem anderen Konto angenommen.": "This invitation has already been accepted with another account.",
    "Die Einladung gilt nicht mehr. Bitte deinen Laden um einen neuen Link.": "This invitation is no longer valid. Please ask your shop for a new link.",
    "Du bist mit dem Konto des Ladens angemeldet. Den Link öffnet die eingeladene Person mit ihrem eigenen Konto.":
        "You're signed in with the shop's account. The invited person opens this link with their own account.",
    "Dein Konto steht im Team von {laden} schon als {name}.": "Your account is already in the team at {laden} as {name}.",
    # Start-Mails an neue Läden (app/libs/onboarding_mail.py)
    "Willkommen bei Dranzeit – {laden} ist startklar": "Welcome to Dranzeit – {laden} is ready to go",
    "Schön, dass du da bist.": "Great to have you here.",
    "{laden} ist eingerichtet. Ab jetzt ziehen deine Kunden per QR-Code eine Nummer und warten, wo sie wollen.":
        "{laden} is set up. From now on, your customers take a number via QR code and wait wherever they like.",
    "Drei Dinge, dann läuft es:": "Three things and you're up and running:",
    "<strong>1. Einmal selbst ausprobieren:</strong> Mit dem Handy den QR-Code am Tresen scannen, eine Nummer ziehen und am Tresen "
    "aufrufen. Auf dem Handy erscheint „Du bist dran“.":
        "<strong>1. Try it yourself once:</strong> Scan the QR code at the front desk with your phone, take a number and call it at "
        "the front desk. Your phone shows “It's your turn”.",
    "<strong>2. QR-Plakat aufhängen:</strong> Am Tresen unter „…“ → „QR-Plakat drucken“, dann an Tür oder Tresen.":
        "<strong>2. Put up the QR poster:</strong> At the front desk under “…” → “Print QR poster”, then on the door or the front desk.",
    "<strong>3. Team einladen:</strong> Arbeitest du nicht allein, schick jeder Person ihren Einladungslink (unter „Team“).":
        "<strong>3. Invite your team:</strong> If you don't work alone, send each person their invitation link (under “Team”).",
    "Als Gründer kannst du bis zum {datum} alles kostenlos nutzen.": "As a founder, you can use everything free of charge until {datum}.",
    "Die nächsten {n} Tage kannst du alles kostenlos nutzen, ohne Zahlungsdaten.": {
        "one": "For one more day you can use everything free of charge, without payment details.",
        "other": "For the next {n} days you can use everything free of charge, without payment details.",
    },
    "Zum Tresen": "Go to front desk",
    "In zwei Minuten ausprobiert: deine erste Nummer": "Try it in two minutes: your first number",
    "Schon ausprobiert?": "Tried it yet?",
    "Bei {laden} wurde noch keine Nummer gezogen. Am schnellsten siehst du, wie Dranzeit funktioniert, wenn du es einmal selbst machst:":
        "No number has been taken at {laden} yet. The quickest way to see how Dranzeit works is to do it yourself once:",
    "Scann mit deinem Handy den QR-Code am Tresen, zieh eine Nummer und tipp am Tresen auf „Nächste Nummer aufrufen“. Auf dem Handy "
    "steht dann „Du bist dran“. Das dauert zwei Minuten.":
        "Scan the QR code at the front desk with your phone, take a number and tap “Call next number” at the front desk. Your phone "
        "will then show “It's your turn”. It takes two minutes.",
    "Hängt es irgendwo, zum Beispiel bei Öffnungszeiten oder Leistungen? Antworte auf diese E-Mail, wir helfen dir.":
        "Stuck somewhere, for example with opening hours or services? Reply to this email and we'll help you.",
    "Diese Erinnerung bekommst du nur einmal.": "You'll only get this reminder once.",
    "Deine Testphase endet am {datum}": "Your trial ends on {datum}",
    "Noch {n} Tage alles testen": {"one": "{n} day left to test everything", "other": "{n} days left to test everything"},
    "Als Gründer bekommst du danach den Laden-Tarif dauerhaft für 19 € im Monat (netto). Wähl dafür unter „Mein Tarif“ das Abo. Ohne "
    "Abo läuft dein Laden im Gratis-Tarif weiter.":
        "As a founder, you'll then get the Shop plan permanently for €19 a month (net). To do so, choose the subscription under "
        "“My plan”. Without a subscription, your shop continues on the Free plan.",
    "Danach läuft dein Laden automatisch im Gratis-Tarif weiter: {personen} Person, bis {kunden} Kunden im Monat, Nummer ziehen per "
    "QR-Code. Online-Termine, Benachrichtigungen, Team, Wartezimmer-Bildschirm und Auswertung gibt es dann mit einem Abo.":
        "After that, your shop automatically continues on the Free plan: {personen} person, up to {kunden} customers a month, taking "
        "numbers via QR code. Online appointments, notifications, team, waiting room screen and statistics then come with a subscription.",
    "Am {datum} endet die Testphase von {laden}.": "The trial for {laden} ends on {datum}.",
    "Reicht dir Gratis, musst du nichts tun. Ohne Abo entstehen keine Kosten.":
        "If Free is enough for you, you don't need to do anything. Without a subscription there are no costs.",
    "Tarife ansehen": "View plans",
    "Fragen? Antworte einfach auf diese E-Mail oder schreib an {kontakt}. Anleitungen findest du unter {hilfe}.":
        "Questions? Just reply to this email or write to {kontakt}. You'll find guides at {hilfe}.",
    "Fragen? {kontakt}": "Questions? {kontakt}",
    # Fehlermeldungen: Nummer, Benachrichtigungen, Früher dran
    "Diese Nummer gibt es nicht.": "This number doesn't exist.",
    "Diese Nummer lässt sich hier nicht ändern. Nimm das Handy, mit dem du sie gezogen hast, oder sag am Tresen Bescheid.":
        "This number can't be changed here. Use the phone you took it with, or let the front desk know.",
    "Du bist schon dran oder fertig – sag bitte am Tresen Bescheid.": "It's already your turn or you're done – please let the front desk know.",
    # Fester Termin ohne Konto und Platz ändern (app/apis/nummer)
    "Diese Leistung gibt es hier nicht mehr. Wähl bitte eine andere.": "This service is no longer available here. Please choose another.",
    "Dieser Laden vergibt online keine festen Termine.": "This shop doesn't take fixed appointments online.",
    "Diese Zeit ist zu kurzfristig. Such dir bitte eine spätere aus.": "This time is too soon. Please pick a later one.",
    "Diese Zeit ist gerade weggegangen. Such dir bitte eine andere aus.": "This time was just taken. Please pick another one.",
    "Dieser Laden nimmt gerade keine Buchungen an.": "This shop isn't taking bookings at the moment.",
    "Bei dieser Person geht das gerade nicht. Wähl bitte eine andere.": "That doesn't work with this person right now. Please choose someone else.",
    "An diesem Tag ist kein Platz mehr frei. Such dir bitte einen anderen Tag aus.": "There are no free slots left on this day. Please pick another day.",
    "Gerade ziehen sehr viele eine Nummer. Versuch es gleich noch einmal.": "Lots of people are taking a number right now. Please try again in a moment.",
    "Über Dranzeit gehen in diesem Monat keine Nummern mehr. Komm einfach direkt im Laden vorbei.": "No more numbers via Dranzeit this month. Just come straight to the shop.",
    "Ohne Anmeldung fehlt der Schlüssel der Nummer. Lade die Seite neu.": "Without signing in, the key for this number is missing. Please reload the page.",
    "Bitte gib deinen Namen an.": "Please enter your name.",
    "Dieser Laden bietet keine Benachrichtigungen an.": "This shop doesn't offer notifications.",
    "Benachrichtigungen für diese Nummer gehen nur auf dem Handy, mit dem sie gezogen wurde, oder mit deinem Konto.":
        "Notifications for this number only work on the phone it was taken with, or with your account.",
    "Diese Nummer ist schon erledigt oder abgesagt.": "This number is already done or cancelled.",
    "Diese Nummer liegt in der Vergangenheit.": "This number is in the past.",
    "Benachrichtigungen sind gerade nicht eingerichtet.": "Notifications aren't set up right now.",
    "Ungültige Push-Adresse.": "Invalid push address.",
    "Für diese Nummer sind schon genug Geräte angemeldet.": "Enough devices are already signed up for this number.",
    "E-Mails sind gerade nicht eingerichtet.": "Emails aren't set up right now.",
    "Das ist nicht dein Termin.": "This isn't your appointment.",
    "Diesen Termin gibt es nicht mehr.": "This appointment no longer exists.",
    "Für diesen Termin geht „Früher dran“ nicht mehr: Er hat schon angefangen oder ist abgesagt.":
        "“Earlier slot” is no longer possible for this appointment: it has already started or been cancelled.",
    "Dieser Laden bietet „Früher dran“ gerade nicht an.": "This shop doesn't offer “Earlier slot” at the moment.",
    "Nur die eigenen Benachrichtigungen.": "Only your own notifications.",
    "Zu viele Anfragen. Versuch es gleich noch einmal.": "Too many requests. Please try again in a moment.",
    # Fehlermeldungen: Kunden-Link, Datenschutz, Zugriff
    "Diesen Link gibt es nicht. Bitte den Laden um einen neuen.": "This link doesn't exist. Please ask the shop for a new one.",
    "Diesen Kunden gibt es nicht mehr. Lade die Seite neu.": "This customer no longer exists. Please reload the page.",
    "{name} hat das Konto schon verbunden und braucht keinen Link.": "{name} has already connected their account and doesn't need a link.",
    "Dieser Link ist schon mit einem anderen Konto verbunden.": "This link is already connected to another account.",
    "Der Link ist abgelaufen. Bitte den Laden um einen neuen.": "This link has expired. Please ask the shop for a new one.",
    "Du bist mit dem Konto des Ladens angemeldet. Den Link öffnet die Kundin oder der Kunde mit dem eigenen Konto.":
        "You're signed in with the shop's account. The customer opens this link with their own account.",
    "Diesen Laden gibt es nicht.": "This shop doesn't exist.",
    "Diesen Kunden gibt es nicht mehr.": "This customer no longer exists.",
    "Konten von Läden und Teams löschen wir auf Anfrage. Schreib uns an {kontakt}.": "We delete shop and team accounts on request. Write to us at {kontakt}.",
    "Nur für den Betreiber der App.": "Only for the operator of the app.",
    "Das ist nicht dein Laden.": "This isn't your shop.",
    "Diesen Laden gibt es nicht mehr.": "This shop no longer exists.",
    "Nur für Betriebe.": "For businesses only.",
    # Fehlermeldungen: Abo und Rechnungen
    "Laden nicht gefunden.": "Shop not found.",
    "Stripe meldet: {grund}": "Stripe reports: {grund}",
    "Die Bezahlung klappt gerade nicht. Bitte versuch es später noch einmal.": "Payment isn't working right now. Please try again later.",
    "Die Bezahlung ist noch nicht fertig eingerichtet. Schreib uns, wir schalten dich frei.":
        "Payments aren't fully set up yet. Write to us and we'll activate your account.",
    "Die Bezahlung ist noch nicht eingerichtet. Schreib uns, wir schalten dich frei.": "Payments aren't set up yet. Write to us and we'll activate your account.",
    "Unbekannter Tarif.": "Unknown plan.",
    "Für diesen Laden gibt es noch kein Abo.": "This shop doesn't have a subscription yet.",
    "Das Gründerangebot gilt nur für Läden ohne laufendes Abo.": "The founder offer is only for shops without an active subscription.",
    "Die 100 Gründerplätze sind vergeben.": "All 100 founder places have been taken.",
    "Die Rechnung lässt sich gerade nicht laden.": "The invoice can't be loaded right now.",
    "Die Rechnung lässt sich gerade nicht laden. Bitte versuch es gleich noch einmal.": "The invoice can't be loaded right now. Please try again in a moment.",
    "Rechnung nicht gefunden.": "Invoice not found.",
    "Für diese Rechnung gibt es noch kein PDF.": "There's no PDF for this invoice yet.",
    "Für diese Rechnung gibt es keine E-Rechnung: {grund}": "There's no e-invoice for this invoice: {grund}",
    # Fehlermeldungen: Laden einrichten (app/apis/shop_setup) und Verzeichnis
    "Zu viele Anfragen. Bitte in einer Stunde noch einmal.": "Too many requests. Please try again in an hour.",
    "Das ist keine Webadresse.": "That's not a web address.",
    "Diese Webadresse wird nicht gelesen.": "This web address can't be read.",
    "Diese Webseite gibt es nicht (Adresse nicht gefunden).": "This website doesn't exist (address not found).",
    "Die Webseite antwortet zu langsam.": "The website is responding too slowly.",
    "Das ist keine Webseite.": "That's not a website.",
    "Zu viele Weiterleitungen.": "Too many redirects.",
    "Die Auswertung ist gerade ausgelastet. Bitte gleich noch einmal.": "The analysis is busy right now. Please try again in a moment.",
    "Die Preisliste konnte gerade nicht ausgewertet werden.": "The price list couldn't be analysed right now.",
    "Die Google-Suche ist nicht eingerichtet.": "Google search isn't set up.",
    "Google ist gerade nicht erreichbar.": "Google can't be reached right now.",
    "Die Google-Suche hat nicht geklappt.": "The Google search didn't work.",
    "Unbekannter Eintrag.": "Unknown entry.",
    "Der Eintrag konnte nicht geladen werden.": "The entry couldn't be loaded.",
    "Das Auslesen der Preisliste ist nicht eingerichtet.": "Reading price lists isn't set up.",
    "Gerade lesen viele gleichzeitig. Bitte in einer Minute noch einmal.": "Lots of people are reading at the same time. Please try again in a minute.",
    "Zu viele Anfragen. Bitte später noch einmal.": "Too many requests. Please try again later.",
    "Diesen Eintrag gibt es nicht.": "This entry doesn't exist.",
    "Dieser Laden hat keine Seite im Verzeichnis.": "This shop doesn't have a page in the directory.",
    "Bitte bestätigen, dass du zu diesem Salon gehörst.": "Please confirm that you belong to this salon.",
    # Übernahme per Code (app/libs/uebernahme.py)
    "Diese Seite gehört nach unserer Prüfung zu einem anderen Salon. Schreib uns an hilfe@dranzeit.de, wenn das nicht stimmt.": "According to our check, this page belongs to a different salon. Write to us at hilfe@dranzeit.de if that's not right.",
    "Diese Seite gehört schon zu einem Dranzeit-Laden.": "This page already belongs to a Dranzeit shop.",
    "Diesen Code kennen wir nicht. Prüf ihn bitte noch einmal.": "We don't recognise this code. Please check it again.",
    "Dieser Code ist schon eingelöst. Melde dich mit dem Konto an, mit dem du deinen Laden eingerichtet hast.": "This code has already been redeemed. Log in with the account you used to set up your shop.",
    "Dieser Code ist abgelaufen. Schreib uns an hilfe@dranzeit.de, dann bekommst du einen neuen.": "This code has expired. Write to us at hilfe@dranzeit.de and we'll send you a new one.",
    # Nachrichten an das Team (app/libs/team_notify.py, app/apis/team_push)
    "Neue Nummer {nummer}": "New number {nummer}",
    "Neue Nummer": "New number",
    "Neue Buchung": "New booking",
    "Nummer {nummer} zurückgegeben": "Number {nummer} left the queue",
    "Nummer zurückgegeben": "A number left the queue",
    "Termin abgesagt": "Appointment cancelled",
    "{wann} gegen {zeit}": "{wann} around {zeit}",
    "{wann} um {zeit}": "{wann} at {zeit}",
    "(per Telefon)": "(by phone)",
    "{n} neue Nummern": {"one": "{n} new number", "other": "{n} new numbers"},
    "{n} neue Buchungen": {"one": "{n} new booking", "other": "{n} new bookings"},
    "{n} Absagen": {"one": "{n} cancellation", "other": "{n} cancellations"},
    "Neu bei {laden}": "New at {laden}",
    "Dieses Konto gehört zu keinem Laden.": "This account doesn't belong to any shop.",
}
