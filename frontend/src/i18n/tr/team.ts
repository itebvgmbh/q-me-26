import type { Texte } from "../typen.ts";

// Team, Arbeitszeiten, Leistungen, Pausen, Auswertung
const texte: Texte = {
  // pages/StaffManagement.tsx
  "Das Team konnte nicht geladen werden.": "Ekip yüklenemedi.",
  "Deine Läden konnten nicht geladen werden.": "Salonlarınız yüklenemedi.",
  "{name} ist wieder im Team.": "{name} yeniden ekipte.",
  "Zurückholen hat nicht geklappt. Bitte noch einmal.": "Geri alınamadı. Lütfen tekrar deneyin.",
  "Wer arbeitet wann und bietet was an. Nur so entstehen freie Zeiten.": "Kim ne zaman çalışıyor, hangi hizmeti sunuyor? Boş saatler ancak böyle oluşur.",
  "Im Tarif {tarif} sind {n} Personen dabei.": { one: "{tarif} paketine bir kişi dahildir.", other: "{tarif} paketine {n} kişi dahildir." },
  "Tarif wechseln": "Paketi değiştir",
  "Laden wählen": "Salon seç",
  "Team wird geladen": "Ekip yükleniyor",
  "Richte zuerst deinen Laden ein.": "Önce salonunuzu kurun.",
  "Laden einrichten": "Salonu kur",
  "Noch niemand im Team.": "Ekipte henüz kimse yok.",
  "Arbeitest du selbst mit, leg dich mit deiner E-Mail als erste Person an. Mitarbeiter lädst du mit „Per E-Mail einladen“ ein, oder du legst sie an und schickst ihnen danach den Link, z. B. per WhatsApp.":
    "Siz de çalışıyorsanız, önce kendinizi e-posta adresinizle ekleyin. Çalışanları “E-postayla davet et” ile davet edin ya da onları ekleyip ardından bağlantıyı gönderin, örn. WhatsApp ile.",
  "Deaktiviert ({anzahl})": "Devre dışı ({anzahl})",
  "Bei diesen Personen kann niemand buchen, und sie sehen „Mein Tag“ nicht. Zurückgeholt ist alles wieder wie vorher.":
    "Bu kişilerden kimse randevu alamaz ve onlar “Günüm” sayfasını göremez. Geri alındığında her şey eskisi gibi olur.",
  "Zurückholen": "Geri al",
  "Dein Tarif ist voll. Deaktiviere erst jemand anderen oder <tarif>wechsle den Tarif</tarif>.": "Paketiniz dolu. Önce başka birini devre dışı bırakın ya da <tarif>paketi değiştirin</tarif>.",
  "Dein Tarif ist voll. Deaktiviere erst jemand anderen.": "Paketiniz dolu. Önce başka birini devre dışı bırakın.",

  // pages/StaffRegistration.tsx
  "In diesem Link fehlt etwas. Bitte deinen Laden, ihn noch einmal zu schicken.": "Bu bağlantıda bir şey eksik. Lütfen salondan bağlantıyı tekrar göndermesini isteyin.",
  "Willkommen im Team von {laden}!": "{laden} ekibine hoş geldiniz!",
  "Das hat nicht geklappt.": "İşlem başarısız oldu.",
  "Mit dieser E-Mail gibt es schon ein Konto. Melde dich damit an, dann nimmst du die Einladung an.": "Bu e-posta adresiyle zaten bir hesap var. Bu hesapla giriş yapın, ardından daveti kabul edin.",
  "Dieser Link klappt nicht.": "Bu bağlantı çalışmıyor.",
  "Zur Startseite": "Ana sayfaya git",
  "Einladung wird geprüft …": "Davet kontrol ediliyor …",
  "Die Einladung gilt nicht mehr.": "Bu davetin süresi doldu.",
  "Bitte {laden} um einen neuen Link. Im Team unter „Bearbeiten“ geht das in einer Minute.": "Yeni bir bağlantı için {laden} ile iletişime geçin. Ekip sayfasında “Düzenle” altından bir dakikada yapılır.",
  "Schon angenommen.": "Zaten kabul edildi.",
  "Diese Einladung ist schon mit einem Konto verbunden. Melde dich damit an, dann siehst du deinen Tag bei {laden}.":
    "Bu davet zaten bir hesaba bağlı. O hesapla giriş yaptığınızda {laden} salonundaki gününüzü görürsünüz.",
  "Zu Mein Tag": "Günüm sayfasına git",
  "Willkommen im Team von {laden}.": "{laden} ekibine hoş geldiniz.",
  "So arbeitest du mit Dranzeit": "Dranzeit ile nasıl çalışılır",
  "{laden} hat dich als {name} ins Team eingeladen. Nimm die Einladung mit deinem Konto an, dann siehst du unter „Mein Tag“ deine Kunden.":
    "{laden} sizi ekibe {name} olarak davet etti. Daveti hesabınızla kabul ettiğinizde müşterilerinizi “Günüm” altında görürsünüz.",
  "{laden} hat dich ins Team eingeladen. Nimm die Einladung mit deinem Konto an, dann siehst du unter „Mein Tag“ deine Kunden.":
    "{laden} sizi ekibe davet etti. Daveti hesabınızla kabul ettiğinizde müşterilerinizi “Günüm” altında görürsünüz.",
  "Nicht dein Konto?": "Bu sizin hesabınız değil mi?",
  "Angemeldet als <konto>{email}</konto>": "<konto>{email}</konto> olarak giriş yapıldı",
  "Wird angenommen …": "Kabul ediliyor …",
  "Einladung annehmen": "Daveti kabul et",
  "{laden} hat dich als {name} ins Team eingeladen. Leg dein Konto an, danach siehst du unter „Mein Tag“ deine Kunden.":
    "{laden} sizi ekibe {name} olarak davet etti. Hesabınızı oluşturun, ardından müşterilerinizi “Günüm” altında görürsünüz.",
  "{laden} hat dich ins Team eingeladen. Leg dein Konto an, danach siehst du unter „Mein Tag“ deine Kunden.":
    "{laden} sizi ekibe davet etti. Hesabınızı oluşturun, ardından müşterilerinizi “Günüm” altında görürsünüz.",
  "Schon ein Konto bei Dranzeit?": "Zaten bir Dranzeit hesabınız var mı?",
  "Anmelden und annehmen": "Giriş yap ve kabul et",
  "Wird angelegt …": "Oluşturuluyor …",
  "Konto anlegen": "Hesap oluştur",

  // components/AddStaffDialog.tsx
  "Fehler beim Hochladen des Profilbilds": "Profil fotoğrafı yüklenemedi",
  "Bitte trag einen Namen ein.": "Lütfen bir ad girin.",
  "Die E-Mail stimmt nicht. Bitte prüf sie noch einmal.": "E-posta adresi doğru değil. Lütfen tekrar kontrol edin.",
  "Du bist jetzt im Team und siehst deine Termine unter „Mein Tag“.": "Artık ekiptesiniz; randevularınızı “Günüm” altında görebilirsiniz.",
  "Anlegen hat nicht geklappt. Bitte noch einmal.": "Eklenemedi. Lütfen tekrar deneyin.",
  "Person anlegen": "Kişi ekle",
  "{name} ist im Team.": "{name} artık ekipte.",
  "Soll {name} den eigenen Tag sehen? Dann schick eine Einladung. Sonst tipp auf „Fertig“, einladen geht auch später unter „Bearbeiten“.":
    "{name} kendi gününü görsün mü? O zaman bir davet gönderin. Aksi halde “Bitti” düğmesine dokunun; davet daha sonra “Düzenle” altından da gönderilebilir.",
  "Für dich selbst (mit deiner E-Mail) oder jemanden aus dem Team. Danach kannst du die Person per Link oder E-Mail einladen.":
    "Kendiniz (e-posta adresinizle) veya ekipten biri için. Ardından kişiyi bağlantı veya e-postayla davet edebilirsiniz.",
  "Name": "Ad",
  "Max Mustermann": "Ayşe Yılmaz",
  "E-Mail (freiwillig, für die Einladung)": "E-posta (isteğe bağlı, davet için)",
  "Telefon (freiwillig)": "Telefon (isteğe bağlı)",
  "Aufgabe (freiwillig)": "Görev (isteğe bağlı)",
  "z. B. Friseurin": "örn. Kuaför",
  "{dauer} Min. | {preis} €": "{dauer} dk | {preis} €",
  "Arbeitszeiten": "Mesai saatleri",
  "bis": "bitiş",
  "Anlegen": "Ekle",

  // components/EditStaffDialog.tsx
  "Gespeichert.": "Kaydedildi.",
  "Speichern hat nicht geklappt. Bitte noch einmal.": "Kaydedilemedi. Lütfen tekrar deneyin.",
  "{name} bearbeiten": "Düzenle: {name}",
  "Leistungen, Arbeitszeiten und Kontakt. Hat die Person noch kein Konto, lädst du sie hier ein.":
    "Hizmetler, mesai saatleri ve iletişim bilgileri. Kişinin henüz hesabı yoksa onu buradan davet edin.",
  "Profil": "Profil",
  "Einzelne Pausen": "Tek seferlik molalar",
  "Wöchentliche Pausen": "Haftalık molalar",
  "Profilbild": "Profil fotoğrafı",
  "{name} Profilbild": "Profil fotoğrafı: {name}",
  "Einladung": "Davet",
  "Änderungen speichern": "Değişiklikleri kaydet",
  "Gilt nur an einem bestimmten Tag, z. B. für einen Arzttermin. Für jede Woche gleich: „Wöchentliche Pausen“. Die Mittagspause des ganzen Ladens steht bei den Öffnungszeiten.":
    "Yalnızca belirli bir gün için geçerlidir, örn. bir doktor randevusu için. Her hafta aynıysa: “Haftalık molalar”. Tüm salonun öğle molası çalışma saatlerinde ayarlanır.",
  "Jede Woche zur selben Zeit, z. B. dienstags 12–13 Uhr. In dieser Zeit bekommt die Person keine Kunden.":
    "Her hafta aynı saatte, örn. salı günleri 12:00–13:00. Bu sürede kişiye müşteri verilmez.",

  // components/InviteStaffDialog.tsx
  "Bitte trag einen Namen ein. So sehen Kunden die Person bei der Buchung.": "Lütfen bir ad girin. Müşteriler kişiyi rezervasyon sırasında bu adla görür.",
  "Per E-Mail einladen": "E-postayla davet et",
  "Die Einladung ist an {email} unterwegs.": "Davet şu adrese gönderildi: {email}",
  "Die Einladung ist noch nicht angekommen. Unten steht, was du tun kannst.": "Davet henüz ulaşmadı. Neler yapabileceğinizi aşağıda bulabilirsiniz.",
  "Leistungen und Arbeitszeiten passt du unter „Bearbeiten“ an.": "Hizmetleri ve mesai saatlerini “Düzenle” altından ayarlayabilirsiniz.",
  "Die Einladung konnte nicht erstellt werden. Versuch es unten noch einmal.": "Davet oluşturulamadı. Aşağıdan tekrar deneyin.",
  "Die Person steht sofort im Team und bekommt einen Link. Damit legt sie ihr Konto an (oder meldet sich mit ihrem an) und sieht unter „Mein Tag“ ihre Kunden.":
    "Kişi hemen ekibe eklenir ve bir bağlantı alır. Bu bağlantıyla hesabını oluşturur (veya kendi hesabıyla giriş yapar) ve müşterilerini “Günüm” altında görür.",
  "E-Mail": "E-posta",
  "Wird verschickt …": "Gönderiliyor …",
  "Einladung senden": "Davet gönder",

  // components/StaffInvitePanel.tsx
  "Hat ein Konto und sieht „Mein Tag“.": "Hesabı var ve “Günüm” sayfasını görüyor.",
  "Einladung an {email} verschickt.": "Davet gönderildi: {email}",
  "Die E-Mail ging nicht raus. Schick den Link selbst.": "E-posta gönderilemedi. Bağlantıyı kendiniz gönderin.",
  "Einladungslink erstellt.": "Davet bağlantısı oluşturuldu.",
  "Link kopiert.": "Bağlantı kopyalandı.",
  "Kopieren ging nicht. Markier den Link und kopier ihn von Hand.": "Kopyalanamadı. Bağlantıyı seçip elle kopyalayın.",
  "Einladung ins Team": "Ekibe davet",
  "Damit siehst du deinen Tag bei Dranzeit:": "Bu bağlantıyla gününüzü Dranzeit üzerinde görebilirsiniz:",
  "Die Einladung vom {datum} ist abgelaufen.": "{datum} tarihli davetin süresi doldu.",
  "Eingeladen am {datum} per E-Mail an {email}, gilt bis {bis}. Noch nicht angenommen.": "Davet tarihi: {datum}, e-posta: {email}, son geçerlilik: {bis}. Henüz kabul edilmedi.",
  "Eingeladen am {datum}, gilt bis {bis}. Noch nicht angenommen.": "Davet tarihi: {datum}, son geçerlilik: {bis}. Henüz kabul edilmedi.",
  "Mit dem Link legt die Person ihr Konto an (oder meldet sich mit ihrem an) und sieht danach unter „Mein Tag“ ihre Kunden.":
    "Kişi bu bağlantıyla hesabını oluşturur (veya kendi hesabıyla giriş yapar) ve ardından müşterilerini “Günüm” altında görür.",
  "E-Mail an {email} ist verschickt. Du kannst den Link auch selbst weitergeben:": "E-posta gönderildi: {email}. Bağlantıyı kendiniz de paylaşabilirsiniz:",
  "Schick {name} den Link selbst, z. B. per WhatsApp oder SMS:": "Bağlantıyı kendiniz gönderin (kişi: {name}), örn. WhatsApp veya SMS ile:",
  "Schick {name} diesen Link, z. B. per WhatsApp oder SMS:": "Bu bağlantıyı gönderin (kişi: {name}), örn. WhatsApp veya SMS ile:",
  "Link kopieren": "Bağlantıyı kopyala",
  "Teilen": "Paylaş",
  "Wird erstellt …": "Oluşturuluyor …",
  "Neuen Link erstellen": "Yeni bağlantı oluştur",
  "Einladungslink erstellen": "Davet bağlantısı oluştur",
  "Neu per E-Mail schicken": "E-postayla yeniden gönder",
  "Per E-Mail schicken": "E-postayla gönder",
  "Speichere zuerst die geänderte E-Mail. Die Einladung geht an die gespeicherte Adresse.": "Önce değiştirilen e-posta adresini kaydedin. Davet kayıtlı adrese gider.",
  "Für die E-Mail trag eine Adresse ein und speichere. Den Link kannst du auch ohne weitergeben.": "E-posta için bir adres girip kaydedin. Bağlantıyı adres olmadan da paylaşabilirsiniz.",
  "Ein neuer Link ersetzt den alten, der alte gilt dann nicht mehr. Jeder Link gilt 14 Tage.": "Yeni bağlantı eskisinin yerini alır; eskisi artık geçerli olmaz. Her bağlantı 14 gün geçerlidir.",
  "Der Link gilt 14 Tage.": "Bağlantı 14 gün geçerlidir.",

  // components/StaffCard.tsx
  "Hat Zugang": "Erişimi var",
  "Eingeladen": "Davet edildi",
  "{name} ist deaktiviert.": "{name} devre dışı bırakıldı.",
  "Deaktivieren hat nicht geklappt.": "Devre dışı bırakılamadı.",
  "{n} Tage pro Woche": { one: "Haftada {n} gün", other: "Haftada {n} gün" },
  "keine Arbeitszeiten": "mesai saati yok",
  "Keine Leistung zugeordnet – taucht bei der Buchung nicht auf.": "Atanmış hizmet yok – rezervasyonda görünmez.",
  "Deaktivieren": "Devre dışı bırak",
  "{name} deaktivieren?": "{name} devre dışı bırakılsın mı?",
  "Für {name} kann dann niemand mehr buchen, bestehende Termine bleiben.": "Bundan sonra kimse {name} için randevu alamaz; mevcut randevular kalır.",
  "{name} sieht „Mein Tag“ nicht mehr.": "{name} artık “Günüm” sayfasını göremez.",
  "Unter „Deaktiviert“ holst du die Person jederzeit zurück.": "Kişiyi istediğiniz zaman “Devre dışı” altından geri alabilirsiniz.",

  // components/WorkingHoursForm.tsx, utils/staff-utils.ts, components/RecurringBreakManager.tsx (Wochentage)
  "Sonntag": "Pazar",
  "Montag": "Pazartesi",
  "Dienstag": "Salı",
  "Mittwoch": "Çarşamba",
  "Donnerstag": "Perşembe",
  "Freitag": "Cuma",
  "Samstag": "Cumartesi",
  "Arbeitszeiten erfolgreich aktualisiert": "Mesai saatleri güncellendi",
  "Fehler beim Aktualisieren: {fehler}": "Güncellenemedi: {fehler}",
  "Unbekannter Fehler": "Bilinmeyen hata",
  "Von": "Başlangıç",
  "Bis": "Bitiş",
  "Speichern...": "Kaydediliyor...",

  // pages/ServiceManagement.tsx
  "Was man bei {laden} buchen kann – mit Dauer und Preis.": "{laden} salonunda rezerve edilebilen hizmetler – süre ve fiyatıyla.",
  "Was man bei dir buchen kann – mit Dauer und Preis.": "Salonunuzda rezerve edilebilen hizmetler – süre ve fiyatıyla.",
  "Leistungen werden geladen": "Hizmetler yükleniyor",
  "Deine Läden konnten nicht geladen werden. Bitte lade die Seite neu.": "Salonlarınız yüklenemedi. Lütfen sayfayı yenileyin.",

  // components/ServiceDialogs.tsx
  "Leistung angelegt.": "Hizmet eklendi.",
  "Die Leistung konnte nicht angelegt werden.": "Hizmet eklenemedi.",
  "Leistung anlegen": "Hizmet ekle",
  "Neue Leistung": "Yeni hizmet",
  "Was kann man bei dir buchen? Dauer und Preis bestimmen die freien Zeiten.": "Salonunuzda neler rezerve edilebilir? Süre ve fiyat boş saatleri belirler.",
  "Leistung gespeichert.": "Hizmet kaydedildi.",
  "Die Leistung konnte nicht gespeichert werden.": "Hizmet kaydedilemedi.",
  "Leistung bearbeiten": "Hizmeti düzenle",
  "Änderungen gelten für neue Buchungen.": "Değişiklikler yeni rezervasyonlar için geçerlidir.",
  "„{name}“ ist gelöscht.": "“{name}” silindi.",
  "Rückgängig": "Geri al",
  "Löschen hat nicht geklappt.": "Silinemedi.",
  "„{name}“ löschen?": "“{name}” silinsin mi?",
  "Kunden können die Leistung dann nicht mehr buchen, und sie verschwindet bei den Personen im Team.":
    "Müşteriler bu hizmeti artık rezerve edemez ve hizmet ekip üyelerinden kaldırılır.",
  "Termine, die schon gebucht sind, bleiben.": "Önceden alınmış randevular kalır.",
  "Es ist kein kommender Termin damit gebucht.": "Bu hizmetle alınmış yaklaşan randevu yok.",
  "{n} kommende Termine sind damit gebucht. Sie bleiben bestehen.": {
    one: "Bu hizmetle alınmış {n} yaklaşan randevu var. Randevu geçerli kalır.",
    other: "Bu hizmetle alınmış {n} yaklaşan randevu var. Randevular geçerli kalır.",
  },
  "Unter „Gelöschte Leistungen“ kannst du sie jederzeit zurückholen.": "Hizmeti istediğiniz zaman “Silinen hizmetler” altından geri alabilirsiniz.",

  // components/ServiceForm.tsx
  "Name ist erforderlich": "Ad gerekli",
  "Dauer ist erforderlich": "Süre gerekli",
  "Dauer muss eine positive Zahl sein": "Süre pozitif bir sayı olmalı",
  "Preis ist erforderlich": "Fiyat gerekli",
  "Preis muss eine nicht-negative Zahl sein": "Fiyat negatif olamaz",
  "Vor- und Nachbereitung muss 0 oder mehr Minuten sein": "Hazırlık ve toparlanma süresi 0 dakika veya daha fazla olmalı",
  "z.B. Haarschnitt": "örn. Saç kesimi",
  "Beschreibung": "Açıklama",
  "z. B. Waschen, Schneiden, Föhnen": "örn. Yıkama, kesim, fön",
  "Dauer (Minuten)": "Süre (dakika)",
  "Vor- und Nachbereitung (Minuten)": "Hazırlık ve toparlanma (dakika)",
  "Zeit zum Aufräumen und Vorbereiten. Bei Nummern und Online-Terminen wird sie zur Dauer dazugerechnet, damit zwischen zwei Kunden Luft bleibt.":
    "Toparlanma ve hazırlık süresi. Sıra numaralarında ve online randevularda süreye eklenir, böylece iki müşteri arasında biraz zaman kalır.",
  "Preis (€)": "Fiyat (€)",
  "Kategorie": "Kategori",
  "z.B. Haare": "örn. Saç",
  "Wird gespeichert...": "Kaydediliyor...",

  // components/ServicesList.tsx
  "„{name}“ ist wieder buchbar.": "“{name}” yeniden rezerve edilebilir.",
  "Zurückholen hat nicht geklappt.": "Geri alınamadı.",
  "Noch keine Leistung.": "Henüz hizmet yok.",
  "Leg mindestens eine an, zum Beispiel „Haarschnitt, 30 Minuten“. Ohne Leistung kann niemand buchen.":
    "En az bir hizmet ekleyin, örneğin “Saç kesimi, 30 dakika”. Hizmet olmadan kimse rezervasyon yapamaz.",
  "{dauer} Min + {vorbereitung} Vor-/Nachbereitung": "{dauer} dk + {vorbereitung} hazırlık/toparlanma",
  "{dauer} Min": "{dauer} dk",
  "Gelöschte Leistungen ({anzahl})": "Silinen hizmetler ({anzahl})",
  "Nicht mehr buchbar. Termine, die schon damit gebucht waren, behalten sie.": "Artık rezerve edilemez. Bu hizmetle önceden alınmış randevular onu korur.",

  // components/BreakManager.tsx
  "Mittagspause": "Öğle molası",
  "Kaffeepause": "Kahve molası",
  "Persönliche Pause": "Kişisel mola",
  "Sonstige Pause": "Diğer mola",
  "Fehler beim Laden der Pausen": "Molalar yüklenemedi",
  "Pause erfolgreich gelöscht": "Mola silindi",
  "Fehler beim Löschen der Pause": "Mola silinemedi",
  "Bitte Start- und Endzeit auswählen": "Lütfen başlangıç ve bitiş saatini seçin",
  "Die Endzeit muss nach der Startzeit liegen": "Bitiş saati başlangıç saatinden sonra olmalı",
  "Diese Pause überschneidet sich mit einer bestehenden Pause": "Bu mola mevcut bir molayla çakışıyor",
  "Pause erfolgreich aktualisiert": "Mola güncellendi",
  "Pause erfolgreich erstellt": "Mola oluşturuldu",
  "Fehler beim Speichern der Pause": "Mola kaydedilemedi",
  "Pausenverwaltung für {name}": "Molalar: {name}",
  "Datum": "Tarih",
  "Datum auswählen": "Tarih seçin",
  "Neue Pause hinzufügen": "Yeni mola ekle",
  "Pause bearbeiten": "Molayı düzenle",
  "Startzeit": "Başlangıç saati",
  "Endzeit": "Bitiş saati",
  "Pausentyp": "Mola türü",
  "Pausentyp auswählen": "Mola türü seçin",
  "Pausen am {datum}": "Molalar – {datum}",
  "Lädt...": "Yükleniyor...",
  "Keine Pausen für diesen Tag eingetragen.": "Bu gün için girilmiş mola yok.",
  "Pause": "Mola",
  "{start} - {ende} Uhr": "{start} - {ende}",

  // components/RecurringBreakManager.tsx
  "Persönlich": "Kişisel",
  "Sonstige": "Diğer",
  "Fehler beim Laden der wiederkehrenden Pausen": "Tekrarlanan molalar yüklenemedi",
  "Diese Pause wirklich löschen?": "Bu mola gerçekten silinsin mi?",
  "Pause aktiviert": "Mola etkinleştirildi",
  "Pause deaktiviert": "Mola devre dışı bırakıldı",
  "Fehler beim Ändern des Pausenstatus": "Mola durumu değiştirilemedi",
  "Bitte gib Start- und Endzeit ein.": "Lütfen başlangıç ve bitiş saatini girin.",
  "Die Startzeit muss vor der Endzeit liegen": "Başlangıç saati bitiş saatinden önce olmalı",
  "Diese Pause überschneidet sich mit einer bereits existierenden Pause": "Bu mola mevcut bir molayla çakışıyor",
  "Wöchentliche Pausen für {name}": "Haftalık molalar: {name}",
  "Regelmäßige Pausen – in dieser Zeit kann niemand buchen.": "Düzenli molalar – bu sürede kimse randevu alamaz.",
  "Pausen für {tag}": "Molalar – {tag}",
  "Pause hinzufügen": "Mola ekle",
  "Keine Pausen für diesen Tag eingerichtet.": "Bu gün için ayarlanmış mola yok.",

  // pages/Auswertung.tsx
  "7 Tage": "7 gün",
  "30 Tage": "30 gün",
  "Auswertung wird geladen …": "İstatistikler yükleniyor …",
  "Auswertung": "İstatistikler",
  "Wie viele Kunden kommen, wie lange sie warten und wann am meisten los ist: Das gehört zum Tarif Laden.":
    "Kaç müşteri geliyor, ne kadar bekliyor ve en yoğun saatler ne zaman: Bunlar “Laden” paketine dahildir.",
  "Tarif ansehen": "Paketi görüntüle",
  "Zeitraum": "Zaman aralığı",
  "Auswertung wird berechnet": "İstatistikler hesaplanıyor",
  "Kunden": "Müşteriler",
  "Davon per Nummer": "Sıra numarasıyla",
  "{prozent} %": "%{prozent}",
  "Ø Wartezeit (Nummer)": "Ort. bekleme (sıra numarası)",
  "{minuten} Min.": "{minuten} dk",
  "erst ab Aufruf am Tresen messbar": "ancak resepsiyonda çağrıldıktan sonra ölçülebilir",
  "aus {n} Nummern": { one: "{n} numaraya göre", other: "{n} numaraya göre" },
  "Abgesagt": "İptal edildi",
  "Umsatz (erledigt)": "Ciro (tamamlanan)",
  "Kunden pro Tag": "Günlük müşteri",
  "Nummer": "Numara",
  "Termin": "Randevu",
  "{tag}: {nummern} Nummern, {termine} Termine": "{tag} – numara: {nummern}, randevu: {termine}",
  "Stoßzeiten": "Yoğun saatler",
  "Am meisten los ist zwischen {von} und {bis} Uhr.": "En yoğun saatler {von}:00 ile {bis}:00 arası.",
  "{stunde} Uhr: {anzahl}": "{stunde}:00 – {anzahl}",

  // utils/stats.ts (date-fns)
  "EEEEEE d.M.": "EEEEEE d.M",

  // utils/firestore/staff.ts
  "{name} mit dieser E-Mail ist deaktiviert. Hol sie unten unter „Deaktiviert“ zurück ins Team.":
    "Bu e-posta adresine sahip kişi ({name}) devre dışı. Aşağıda “Devre dışı” altından onu ekibe geri alın.",
  "{name} hat diese E-Mail schon im Team.": "Bu e-posta adresi ekipte zaten kullanılıyor: {name}",

  // utils/hooks/useServiceManagement.ts
  "Fehler beim Laden der Services": "Hizmetler yüklenirken hata oluştu",
  "Kein Shop ausgewählt": "Salon seçilmedi",
  "Service erfolgreich erstellt": "Hizmet oluşturuldu",
  "Fehler beim Erstellen des Services": "Hizmet oluşturulamadı",
  "Service erfolgreich aktualisiert": "Hizmet güncellendi",
  "Fehler beim Aktualisieren des Services": "Hizmet güncellenemedi",

  // utils/hooks/useStaff.ts, utils/hooks/useStaffData.ts
  "Fehler beim Laden der Mitarbeiter": "Çalışanlar yüklenirken hata oluştu",

  // utils/staff-invitation.ts
  "Keine Verbindung zum Server. Bitte prüf dein Internet.": "Sunucuya bağlanılamıyor. Lütfen internet bağlantınızı kontrol edin.",
  "Das hat nicht geklappt (Fehler {status}).": "İşlem başarısız oldu (hata {status}).",
};

export default texte;
