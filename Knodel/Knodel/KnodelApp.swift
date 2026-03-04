import SwiftUI

@main
struct KnodelApp: App {
    @StateObject private var settingsVM = SettingsViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settingsVM)
                .frame(minWidth: 960, minHeight: 640)
        }
        .defaultSize(width: 960, height: 640)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Navigation") {
                Button("Explorer") {
                    NotificationCenter.default.post(name: .switchTab, object: AppTab.explorer)
                }
                .keyboardShortcut("1", modifiers: .command)

                Button("Node") {
                    NotificationCenter.default.post(name: .switchTab, object: AppTab.node)
                }
                .keyboardShortcut("2", modifiers: .command)
            }
        }

        Settings {
            SettingsView()
                .environmentObject(settingsVM)
        }
    }
}

extension Notification.Name {
    static let switchTab = Notification.Name("switchTab")
}
