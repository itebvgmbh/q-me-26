"""Türkisch (Siz-Form wie im Frontend). Schlüssel ist der deutsche Text aus dem Code; geprüft in tests/test_i18n.py."""

TEXTE: dict = {
    # Wochentage, Tage (app/i18n, app/libs/queue_notify.py)
    "Mo": "Pzt",
    "Di": "Sal",
    "Mi": "Çar",
    "Do": "Per",
    "Fr": "Cum",
    "Sa": "Cmt",
    "So": "Paz",
    "heute": "bugün",
    "morgen": "yarın",
    "am {wochentag} {tag}.{monat}.": "{tag}.{monat}. {wochentag}",
    # Push und E-Mails zur Nummer oder zum Termin (app/libs/queue_notify.py, app/libs/notify_worker.py)
    "Dein Laden": "Salonunuz",
    "Du bist dran": "Sıra sizde",
    "{laden} ruft dich auf. Komm jetzt rein.": "{laden} sizi çağırıyor. Şimdi içeri gelin.",
    "Gleich bist du dran": "Sıranız yaklaşıyor",
    "{laden}: Du bist als Nächstes dran. Mach dich auf den Weg.": "{laden}: Sıradaki sizsiniz. Yola çıkın.",
    "{laden}: Nur noch {n} vor dir. Mach dich auf den Weg.": "{laden}: Önünüzde yalnızca {n} kişi var. Yola çıkın.",
    "Erinnerung an deinen Termin": "Randevu hatırlatması",
    "{laden}, heute um {zeit}. Kannst du nicht? Dann sag bitte ab.": "{laden}, bugün saat {zeit}. Gelemiyor musunuz? O zaman lütfen iptal edin.",
    "Abgesagt": "İptal edildi",
    "{laden} hat deine Nummer {wann} um {zeit} abgesagt.": "{laden}, {wann} saat {zeit} için olan numaranızı iptal etti.",
    "{laden} hat deinen Termin {wann} um {zeit} abgesagt.": "{laden}, {wann} saat {zeit} için olan randevunuzu iptal etti.",
    "Neue Uhrzeit": "Yeni saat",
    "{laden} hat deinen Termin verschoben: jetzt {wann} um {zeit}": "{laden} randevunuzu değiştirdi: yeni zaman {wann} saat {zeit}",
    "bei {name}": "{name} ile",
    "(vorher {zeit})": "(önceden {zeit})",
    "(vorher {wann} um {zeit})": "(önceden {wann} saat {zeit})",
    "Früher dran?": "Daha erken gelmek ister misiniz?",
    "{laden}: {wann} um {zeit} ist ein Platz frei": "{laden}: {wann} saat {zeit} için bir yer boşaldı",
    "(statt {zeit})": "({zeit} yerine)",
    "Bis {zeit} nur für dich – unter „Meine Termine“ annehmen.": "Saat {zeit}'e kadar yalnızca sizin için – “Randevularım” bölümünde kabul edin.",
    "Nur kurz für dich reserviert – unter „Meine Termine“ annehmen.": "Kısa bir süre sizin için ayrıldı – “Randevularım” bölümünde kabul edin.",
    "Nummer ansehen": "Numarayı görüntüle",
    "Angebot ansehen": "Teklifi görüntüle",
    # Rahmen jeder E-Mail (app/libs/mail.py)
    "Klappt der Knopf nicht? Dann öffne diesen Link:": "Düğme çalışmıyor mu? O zaman bu bağlantıyı açın:",
    "Impressum": "Künye",
    "Diese E-Mail wurde automatisch verschickt.": "Bu e-posta otomatik olarak gönderildi.",
    # E-Mail-Adresse bestätigen (app/apis/email_verification)
    "Bitte bestätige deine E-Mail-Adresse": "Lütfen e-posta adresinizi onaylayın",
    "Ist das deine E-Mail-Adresse?": "Bu sizin e-posta adresiniz mi?",
    "Hallo, du hast bei Dranzeit ein Konto mit der Adresse <strong>{email}</strong> angelegt.":
        "Merhaba, Dranzeit'ta <strong>{email}</strong> adresiyle bir hesap oluşturdunuz.",
    "Hallo, du hast bei Dranzeit ein Konto mit der Adresse {email} angelegt.": "Merhaba, Dranzeit'ta {email} adresiyle bir hesap oluşturdunuz.",
    "Tipp auf den Knopf, dann ist sie bestätigt. So wissen wir, dass die Adresse wirklich dir gehört.":
        "Onaylamak için düğmeye dokunun. Böylece adresin gerçekten size ait olduğunu biliriz.",
    "Öffne diesen Link, dann ist sie bestätigt:": "Onaylamak için bu bağlantıyı açın:",
    "E-Mail-Adresse bestätigen": "E-posta adresini onayla",
    "Du hast kein Konto bei Dranzeit angelegt? Dann hat sich jemand vertippt. Du kannst diese E-Mail einfach löschen.":
        "Dranzeit'ta hesap oluşturmadınız mı? O zaman biri adresi yanlış yazmış. Bu e-postayı silebilirsiniz.",
    "Wir haben dir gerade erst eine E-Mail geschickt. Warte eine Minute, dann geht es noch mal.":
        "Size az önce bir e-posta gönderdik. Bir dakika bekleyin, sonra tekrar deneyebilirsiniz.",
    "Heute haben wir dir schon {n} E-Mails geschickt. Versuch es morgen noch mal.": "Bugün size zaten {n} e-posta gönderdik. Lütfen yarın tekrar deneyin.",
    "Zu deinem Konto gibt es keine E-Mail-Adresse.": "Hesabınıza ait bir e-posta adresi yok.",
    "Die E-Mail konnte gerade nicht verschickt werden. Versuch es später noch mal.": "E-posta şu anda gönderilemedi. Lütfen daha sonra tekrar deneyin.",
    # Passwort vergessen (app/apis/password_reset)
    "Neues Passwort für Dranzeit": "Dranzeit için yeni şifre",
    "Neues Passwort setzen": "Yeni şifre belirle",
    "Hallo, für dein Dranzeit-Konto <strong>{email}</strong> wurde ein neues Passwort angefordert.":
        "Merhaba, Dranzeit hesabınız <strong>{email}</strong> için yeni bir şifre istendi.",
    "Hallo, für dein Dranzeit-Konto {email} wurde ein neues Passwort angefordert.": "Merhaba, Dranzeit hesabınız {email} için yeni bir şifre istendi.",
    "Tipp auf den Knopf und wähl ein neues Passwort. Der Link gilt eine Stunde.": "Düğmeye dokunun ve yeni bir şifre seçin. Bağlantı bir saat geçerlidir.",
    "Öffne diesen Link und wähl ein neues Passwort (gilt eine Stunde):": "Bu bağlantıyı açın ve yeni bir şifre seçin (bir saat geçerlidir):",
    "Du hast kein neues Passwort angefordert? Dann kannst du diese E-Mail einfach löschen. Dein Passwort bleibt, wie es ist.":
        "Yeni şifre istemediniz mi? O zaman bu e-postayı silebilirsiniz. Şifreniz olduğu gibi kalır.",
    "Wir haben gerade erst eine E-Mail an diese Adresse geschickt. Warte eine Minute, dann geht es noch mal.":
        "Bu adrese az önce bir e-posta gönderdik. Bir dakika bekleyin, sonra tekrar deneyebilirsiniz.",
    "Heute ging schon zu oft eine E-Mail raus. Versuch es morgen noch mal.": "Bugün zaten çok fazla e-posta gönderildi. Lütfen yarın tekrar deneyin.",
    "Diese E-Mail-Adresse sieht nicht richtig aus.": "Bu e-posta adresi doğru görünmüyor.",
    # Team-Einladung (app/apis/staff_invitation)
    "Einladung ins Team von {laden}": "{laden} ekibine davet",
    "Du bist ins Team von {laden} eingeladen": "{laden} ekibine davet edildiniz",
    "Du bist ins Team von {laden} eingeladen.": "{laden} ekibine davet edildiniz.",
    "Hallo {name},": "Merhaba {name},",
    "Hallo,": "Merhaba,",
    "{hallo} <strong>{laden}</strong> nutzt Dranzeit für Termine und die Warteschlange und hat dich ins Team eingeladen.":
        "{hallo} <strong>{laden}</strong> randevular ve sıra için Dranzeit kullanıyor ve sizi ekibe davet etti.",
    "Leg über den Link dein Konto an oder melde dich mit deinem bestehenden an. Danach siehst du unter „Mein Tag“ deine eigenen Kunden.":
        "Bağlantı üzerinden hesabınızı oluşturun veya mevcut hesabınızla giriş yapın. Ardından “Günüm” bölümünde kendi müşterilerinizi görürsünüz.",
    "{laden} nutzt Dranzeit für Termine und die Warteschlange. Leg über diesen Link dein Konto an oder melde dich mit deinem bestehenden an:":
        "{laden} randevular ve sıra için Dranzeit kullanıyor. Bu bağlantı üzerinden hesabınızı oluşturun veya mevcut hesabınızla giriş yapın:",
    "Einladung annehmen": "Daveti kabul et",
    "Der Link gilt {n} Tage. Fragen beantwortet dir dein Laden.": "Bağlantı {n} gün geçerlidir. Sorularınızı salonunuz yanıtlar.",
    "deinem Laden": "salonunuz",
    "An Testadressen wie example.com verschickt Dranzeit keine E-Mails.": "Dranzeit, example.com gibi test adreslerine e-posta göndermez.",
    "Der E-Mail-Versand ist gerade nicht eingerichtet.": "E-posta gönderimi şu anda kurulu değil.",
    "Die E-Mail konnte nicht verschickt werden.": "E-posta gönderilemedi.",
    "Diesen Einladungslink gibt es nicht oder er wurde durch einen neueren ersetzt. Bitte deinen Laden um einen neuen.":
        "Bu davet bağlantısı mevcut değil veya daha yenisiyle değiştirildi. Lütfen salonunuzdan yeni bir bağlantı isteyin.",
    "Diese Person gibt es nicht mehr. Lade die Seite neu.": "Bu kişi artık yok. Lütfen sayfayı yenileyin.",
    "Die Person": "Bu kişi",
    "andere Person": "başka bir kişi",
    "{name} hat schon ein Konto und sieht „Mein Tag“.": "{name} zaten bir hesaba sahip ve “Günüm” sayfasını görüyor.",
    "{name} ist deaktiviert. Hol sie zuerst zurück ins Team.": "{name} devre dışı. Önce ekibe geri alın.",
    "Für die E-Mail fehlt die Adresse. Trag sie unter „Bearbeiten“ ein und speichere.": "E-posta için adres eksik. Adresi “Düzenle” bölümünde girin ve kaydedin.",
    "Diese Einladung wurde schon mit einem anderen Konto angenommen.": "Bu davet zaten başka bir hesapla kabul edildi.",
    "Die Einladung gilt nicht mehr. Bitte deinen Laden um einen neuen Link.": "Davet artık geçerli değil. Lütfen salonunuzdan yeni bir bağlantı isteyin.",
    "Du bist mit dem Konto des Ladens angemeldet. Den Link öffnet die eingeladene Person mit ihrem eigenen Konto.":
        "Salonun hesabıyla giriş yaptınız. Bu bağlantıyı davet edilen kişi kendi hesabıyla açmalıdır.",
    "Dein Konto steht im Team von {laden} schon als {name}.": "Hesabınız {laden} ekibinde zaten {name} olarak kayıtlı.",
    # Start-Mails an neue Läden (app/libs/onboarding_mail.py)
    "Willkommen bei Dranzeit – {laden} ist startklar": "Dranzeit'a hoş geldiniz – {laden} hazır",
    "Schön, dass du da bist.": "Aramıza hoş geldiniz.",
    "{laden} ist eingerichtet. Ab jetzt ziehen deine Kunden per QR-Code eine Nummer und warten, wo sie wollen.":
        "{laden} kuruldu. Artık müşterileriniz QR kod ile sıra numarası alıyor ve istedikleri yerde bekliyor.",
    "Drei Dinge, dann läuft es:": "Üç adım, sonra her şey hazır:",
    "<strong>1. Einmal selbst ausprobieren:</strong> Mit dem Handy den QR-Code am Tresen scannen, eine Nummer ziehen und am Tresen "
    "aufrufen. Auf dem Handy erscheint „Du bist dran“.":
        "<strong>1. Bir kez kendiniz deneyin:</strong> Telefonla resepsiyondaki QR kodu tarayın, bir numara alın ve resepsiyonda "
        "çağırın. Telefonda “Sıra sizde” görünür.",
    "<strong>2. QR-Plakat aufhängen:</strong> Am Tresen unter „…“ → „QR-Plakat drucken“, dann an Tür oder Tresen.":
        "<strong>2. QR afişini asın:</strong> Resepsiyonda “…” → “QR afişini yazdır”, sonra kapıya veya resepsiyona asın.",
    "<strong>3. Team einladen:</strong> Arbeitest du nicht allein, schick jeder Person ihren Einladungslink (unter „Team“).":
        "<strong>3. Ekibi davet edin:</strong> Tek başınıza çalışmıyorsanız, her kişiye kendi davet bağlantısını gönderin (“Ekip” bölümünde).",
    "Als Gründer kannst du bis zum {datum} alles kostenlos nutzen.": "Kurucu olarak {datum} tarihine kadar her şeyi ücretsiz kullanabilirsiniz.",
    "Die nächsten {n} Tage kannst du alles kostenlos nutzen, ohne Zahlungsdaten.": {
        "one": "Bir gün daha her şeyi ödeme bilgisi olmadan ücretsiz kullanabilirsiniz.",
        "other": "Önümüzdeki {n} gün boyunca her şeyi ödeme bilgisi olmadan ücretsiz kullanabilirsiniz.",
    },
    "Zum Tresen": "Resepsiyona git",
    "In zwei Minuten ausprobiert: deine erste Nummer": "İki dakikada deneyin: ilk numaranız",
    "Schon ausprobiert?": "Denediniz mi?",
    "Bei {laden} wurde noch keine Nummer gezogen. Am schnellsten siehst du, wie Dranzeit funktioniert, wenn du es einmal selbst machst:":
        "{laden} salonunda henüz numara alınmadı. Dranzeit'ın nasıl çalıştığını görmenin en hızlı yolu bir kez kendiniz denemektir:",
    "Scann mit deinem Handy den QR-Code am Tresen, zieh eine Nummer und tipp am Tresen auf „Nächste Nummer aufrufen“. Auf dem Handy "
    "steht dann „Du bist dran“. Das dauert zwei Minuten.":
        "Telefonunuzla resepsiyondaki QR kodu tarayın, bir numara alın ve resepsiyonda “Sıradaki numarayı çağır” düğmesine dokunun. "
        "Telefonda “Sıra sizde” yazar. Bu iki dakika sürer.",
    "Hängt es irgendwo, zum Beispiel bei Öffnungszeiten oder Leistungen? Antworte auf diese E-Mail, wir helfen dir.":
        "Bir yerde takıldınız mı, örneğin çalışma saatlerinde veya hizmetlerde? Bu e-postayı yanıtlayın, size yardımcı olalım.",
    "Diese Erinnerung bekommst du nur einmal.": "Bu hatırlatmayı yalnızca bir kez alırsınız.",
    "Deine Testphase endet am {datum}": "Deneme süreniz {datum} tarihinde bitiyor",
    "Noch {n} Tage alles testen": "Her şeyi denemek için {n} gün kaldı",
    "Als Gründer bekommst du danach den Laden-Tarif dauerhaft für 19 € im Monat (netto). Wähl dafür unter „Mein Tarif“ das Abo. Ohne "
    "Abo läuft dein Laden im Gratis-Tarif weiter.":
        "Kurucu olarak ardından Salon paketini kalıcı olarak ayda 19 € (net) karşılığında alırsınız. Bunun için “Paketim” bölümünde "
        "aboneliği seçin. Abonelik olmadan salonunuz Ücretsiz pakette devam eder.",
    "Danach läuft dein Laden automatisch im Gratis-Tarif weiter: {personen} Person, bis {kunden} Kunden im Monat, Nummer ziehen per "
    "QR-Code. Online-Termine, Benachrichtigungen, Team, Wartezimmer-Bildschirm und Auswertung gibt es dann mit einem Abo.":
        "Ardından salonunuz otomatik olarak Ücretsiz pakette devam eder: {personen} kişi, ayda {kunden} müşteriye kadar, QR kod ile "
        "sıra numarası. Online randevular, bildirimler, ekip, bekleme alanı ekranı ve istatistikler o zaman abonelikle kullanılabilir.",
    "Am {datum} endet die Testphase von {laden}.": "{laden} için deneme süresi {datum} tarihinde bitiyor.",
    "Reicht dir Gratis, musst du nichts tun. Ohne Abo entstehen keine Kosten.":
        "Ücretsiz paket size yetiyorsa hiçbir şey yapmanız gerekmez. Abonelik olmadan hiçbir ücret oluşmaz.",
    "Tarife ansehen": "Paketleri görüntüle",
    "Fragen? Antworte einfach auf diese E-Mail oder schreib an {kontakt}. Anleitungen findest du unter {hilfe}.":
        "Sorularınız mı var? Bu e-postayı yanıtlayın veya {kontakt} adresine yazın. Kılavuzları {hilfe} adresinde bulabilirsiniz.",
    "Fragen? {kontakt}": "Sorularınız mı var? {kontakt}",
    # Fehlermeldungen: Nummer, Benachrichtigungen, Früher dran
    "Diese Nummer gibt es nicht.": "Bu numara mevcut değil.",
    "Diese Nummer lässt sich hier nicht ändern. Nimm das Handy, mit dem du sie gezogen hast, oder sag am Tresen Bescheid.":
        "Bu numara burada değiştirilemez. Numarayı aldığınız telefonu kullanın veya resepsiyona haber verin.",
    "Du bist schon dran oder fertig – sag bitte am Tresen Bescheid.": "Sıranız zaten geldi veya işleminiz bitti – lütfen resepsiyona haber verin.",
    # Fester Termin ohne Konto und Platz ändern (app/apis/nummer)
    "Diese Leistung gibt es hier nicht mehr. Wähl bitte eine andere.": "Bu hizmet burada artık yok. Lütfen başka birini seçin.",
    "Dieser Laden vergibt online keine festen Termine.": "Bu salon çevrimiçi sabit randevu vermiyor.",
    "Diese Zeit ist zu kurzfristig. Such dir bitte eine spätere aus.": "Bu saat çok yakın. Lütfen daha geç bir saat seçin.",
    "Diese Zeit ist gerade weggegangen. Such dir bitte eine andere aus.": "Bu saat az önce alındı. Lütfen başka bir saat seçin.",
    "Dieser Laden bietet keine Benachrichtigungen an.": "Bu salon bildirim sunmuyor.",
    "Benachrichtigungen für diese Nummer gehen nur auf dem Handy, mit dem sie gezogen wurde, oder mit deinem Konto.":
        "Bu numara için bildirimler yalnızca numaranın alındığı telefonda veya hesabınızla çalışır.",
    "Diese Nummer ist schon erledigt oder abgesagt.": "Bu numara zaten tamamlandı veya iptal edildi.",
    "Diese Nummer liegt in der Vergangenheit.": "Bu numara geçmişte kaldı.",
    "Benachrichtigungen sind gerade nicht eingerichtet.": "Bildirimler şu anda kurulu değil.",
    "Ungültige Push-Adresse.": "Geçersiz bildirim adresi.",
    "Für diese Nummer sind schon genug Geräte angemeldet.": "Bu numara için zaten yeterli sayıda cihaz kayıtlı.",
    "E-Mails sind gerade nicht eingerichtet.": "E-postalar şu anda kurulu değil.",
    "Das ist nicht dein Termin.": "Bu sizin randevunuz değil.",
    "Diesen Termin gibt es nicht mehr.": "Bu randevu artık yok.",
    "Für diesen Termin geht „Früher dran“ nicht mehr: Er hat schon angefangen oder ist abgesagt.":
        "Bu randevu için “Erken sıra” artık mümkün değil: Randevu başladı veya iptal edildi.",
    "Dieser Laden bietet „Früher dran“ gerade nicht an.": "Bu salon şu anda “Erken sıra” sunmuyor.",
    "Nur die eigenen Benachrichtigungen.": "Yalnızca kendi bildirimleriniz.",
    "Zu viele Anfragen. Versuch es gleich noch einmal.": "Çok fazla istek. Lütfen birazdan tekrar deneyin.",
    # Fehlermeldungen: Kunden-Link, Datenschutz, Zugriff
    "Diesen Link gibt es nicht. Bitte den Laden um einen neuen.": "Bu bağlantı mevcut değil. Lütfen salondan yeni bir bağlantı isteyin.",
    "Diesen Kunden gibt es nicht mehr. Lade die Seite neu.": "Bu müşteri artık yok. Lütfen sayfayı yenileyin.",
    "{name} hat das Konto schon verbunden und braucht keinen Link.": "{name} hesabını zaten bağladı, bağlantıya ihtiyacı yok.",
    "Dieser Link ist schon mit einem anderen Konto verbunden.": "Bu bağlantı zaten başka bir hesaba bağlı.",
    "Der Link ist abgelaufen. Bitte den Laden um einen neuen.": "Bağlantının süresi doldu. Lütfen salondan yeni bir bağlantı isteyin.",
    "Du bist mit dem Konto des Ladens angemeldet. Den Link öffnet die Kundin oder der Kunde mit dem eigenen Konto.":
        "Salonun hesabıyla giriş yaptınız. Bu bağlantıyı müşteri kendi hesabıyla açmalıdır.",
    "Diesen Laden gibt es nicht.": "Bu salon mevcut değil.",
    "Diesen Kunden gibt es nicht mehr.": "Bu müşteri artık yok.",
    "Konten von Läden und Teams löschen wir auf Anfrage. Schreib uns an {kontakt}.":
        "Salon ve ekip hesaplarını talep üzerine siliyoruz. Bize {kontakt} adresinden yazın.",
    "Nur für den Betreiber der App.": "Yalnızca uygulamanın işletmecisi için.",
    "Das ist nicht dein Laden.": "Bu sizin salonunuz değil.",
    "Diesen Laden gibt es nicht mehr.": "Bu salon artık yok.",
    "Nur für Betriebe.": "Yalnızca işletmeler için.",
    # Fehlermeldungen: Abo und Rechnungen
    "Laden nicht gefunden.": "Salon bulunamadı.",
    "Stripe meldet: {grund}": "Stripe bildiriyor: {grund}",
    "Die Bezahlung klappt gerade nicht. Bitte versuch es später noch einmal.": "Ödeme şu anda çalışmıyor. Lütfen daha sonra tekrar deneyin.",
    "Die Bezahlung ist noch nicht fertig eingerichtet. Schreib uns, wir schalten dich frei.":
        "Ödeme henüz tam olarak kurulmadı. Bize yazın, hesabınızı etkinleştirelim.",
    "Die Bezahlung ist noch nicht eingerichtet. Schreib uns, wir schalten dich frei.": "Ödeme henüz kurulmadı. Bize yazın, hesabınızı etkinleştirelim.",
    "Unbekannter Tarif.": "Bilinmeyen paket.",
    "Für diesen Laden gibt es noch kein Abo.": "Bu salonun henüz aboneliği yok.",
    "Das Gründerangebot gilt nur für Läden ohne laufendes Abo.": "Kurucu teklifi yalnızca aktif aboneliği olmayan salonlar için geçerlidir.",
    "Die 100 Gründerplätze sind vergeben.": "100 kurucu yerinin tamamı doldu.",
    "Die Rechnung lässt sich gerade nicht laden.": "Fatura şu anda yüklenemiyor.",
    "Die Rechnung lässt sich gerade nicht laden. Bitte versuch es gleich noch einmal.": "Fatura şu anda yüklenemiyor. Lütfen birazdan tekrar deneyin.",
    "Rechnung nicht gefunden.": "Fatura bulunamadı.",
    "Für diese Rechnung gibt es noch kein PDF.": "Bu fatura için henüz PDF yok.",
    "Für diese Rechnung gibt es keine E-Rechnung: {grund}": "Bu fatura için e-fatura yok: {grund}",
    # Fehlermeldungen: Laden einrichten (app/apis/shop_setup) und Verzeichnis
    "Zu viele Anfragen. Bitte in einer Stunde noch einmal.": "Çok fazla istek. Lütfen bir saat sonra tekrar deneyin.",
    "Das ist keine Webadresse.": "Bu bir web adresi değil.",
    "Diese Webadresse wird nicht gelesen.": "Bu web adresi okunmuyor.",
    "Diese Webseite gibt es nicht (Adresse nicht gefunden).": "Bu web sitesi mevcut değil (adres bulunamadı).",
    "Die Webseite antwortet zu langsam.": "Web sitesi çok yavaş yanıt veriyor.",
    "Das ist keine Webseite.": "Bu bir web sitesi değil.",
    "Zu viele Weiterleitungen.": "Çok fazla yönlendirme.",
    "Die Auswertung ist gerade ausgelastet. Bitte gleich noch einmal.": "Değerlendirme şu anda yoğun. Lütfen birazdan tekrar deneyin.",
    "Die Preisliste konnte gerade nicht ausgewertet werden.": "Fiyat listesi şu anda değerlendirilemedi.",
    "Die Google-Suche ist nicht eingerichtet.": "Google araması kurulu değil.",
    "Google ist gerade nicht erreichbar.": "Google'a şu anda ulaşılamıyor.",
    "Die Google-Suche hat nicht geklappt.": "Google araması başarısız oldu.",
    "Unbekannter Eintrag.": "Bilinmeyen kayıt.",
    "Der Eintrag konnte nicht geladen werden.": "Kayıt yüklenemedi.",
    "Das Auslesen der Preisliste ist nicht eingerichtet.": "Fiyat listesinin okunması kurulu değil.",
    "Gerade lesen viele gleichzeitig. Bitte in einer Minute noch einmal.": "Şu anda birçok kişi aynı anda okuyor. Lütfen bir dakika sonra tekrar deneyin.",
    "Zu viele Anfragen. Bitte später noch einmal.": "Çok fazla istek. Lütfen daha sonra tekrar deneyin.",
    "Diesen Eintrag gibt es nicht.": "Bu kayıt mevcut değil.",
    "Dieser Laden hat keine Seite im Verzeichnis.": "Bu salonun rehberde sayfası yok.",
    "Bitte bestätigen, dass du zu diesem Salon gehörst.": "Lütfen bu salona ait olduğunuzu onaylayın.",
    # Übernahme per Code (app/libs/uebernahme.py)
    "Diese Seite gehört schon zu einem Dranzeit-Laden.": "Bu sayfa zaten bir Dranzeit dükkânına ait.",
    "Diesen Code kennen wir nicht. Prüf ihn bitte noch einmal.": "Bu kodu tanımıyoruz. Lütfen bir kez daha kontrol et.",
    "Dieser Code ist schon eingelöst. Melde dich mit dem Konto an, mit dem du deinen Laden eingerichtet hast.": "Bu kod zaten kullanıldı. Dükkânını kurduğun hesapla giriş yap.",
    "Dieser Code ist abgelaufen. Schreib uns an hilfe@dranzeit.de, dann bekommst du einen neuen.": "Bu kodun süresi doldu. hilfe@dranzeit.de adresine yaz, sana yenisini gönderelim.",
    # Nachrichten an das Team (app/libs/team_notify.py, app/apis/team_push)
    "Neue Nummer {nummer}": "Yeni numara {nummer}",
    "Neue Nummer": "Yeni numara",
    "Neue Buchung": "Yeni randevu",
    "Nummer {nummer} zurückgegeben": "{nummer} numarası sıradan çıktı",
    "Nummer zurückgegeben": "Bir numara sıradan çıktı",
    "Termin abgesagt": "Randevu iptal edildi",
    "{wann} gegen {zeit}": "{wann} saat {zeit} civarı",
    "{wann} um {zeit}": "{wann} saat {zeit}",
    "(per Telefon)": "(telefonla)",
    "{n} neue Nummern": "{n} yeni numara",
    "{n} neue Buchungen": "{n} yeni randevu",
    "{n} Absagen": "{n} iptal",
    "Neu bei {laden}": "{laden}: yeni bildirimler",
    "Dieses Konto gehört zu keinem Laden.": "Bu hesap hiçbir dükkâna ait değil.",
}
