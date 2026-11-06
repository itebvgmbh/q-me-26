import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Firebase nur mit GoogleService-Info.plist: Sie liegt nicht im Repo, das CI legt sie aus einem Secret an
        // (mobile/README.md). Ohne sie läuft die App, nur ohne Push.
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
        }
        return true
    }

    // Push: iOS liefert ein APNs-Token, das Backend schickt über Firebase Cloud Messaging
    // (backend/app/libs/fcm.py) – also gegen ein FCM-Token tauschen und das an @capacitor/push-notifications geben.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard FirebaseApp.app() != nil else {
            let error = NSError(domain: "Dranzeit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Firebase ist in dieser App nicht eingerichtet."])
            NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            return
        }
        Messaging.messaging().apnsToken = deviceToken
        // token(completion:) ist seit Firebase 13 als veraltet markiert (Nachfolger: Anmeldung über die Installations-ID).
        // Das Backend schickt aber an Registrierungs-Tokens (firebase_admin, Message.token) – deshalb bleibt es dabei.
        Messaging.messaging().token { token, error in
            if let token = token {
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            } else {
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
