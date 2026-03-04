import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var vm: SettingsViewModel

    var body: some View {
        TabView {
            explorerTab
                .tabItem { Label("Explorer", systemImage: "globe") }

            nodeTab
                .tabItem { Label("Node", systemImage: "server.rack") }
        }
        .frame(width: 500, height: 420)
    }

    private var explorerTab: some View {
        Form {
            Section("RPC Connection") {
                TextField("RPC URL", text: $vm.explorerSettings.rpcUrl)
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Text("Polling Interval (ms)")
                    Spacer()
                    TextField("ms", value: $vm.explorerSettings.pollMs, format: .number)
                        .frame(width: 80)
                        .textFieldStyle(.roundedBorder)
                }

                HStack {
                    Text("Row Limit")
                    Spacer()
                    TextField("Rows", value: $vm.explorerSettings.rowLimit, format: .number)
                        .frame(width: 80)
                        .textFieldStyle(.roundedBorder)
                }
            }

            Section {
                Button("Reset to Defaults") {
                    vm.explorerSettings = .default
                }
            }
        }
        .padding(20)
    }

    private var nodeTab: some View {
        Form {
            Section("Koinos Repository") {
                TextField("Repo Path", text: $vm.nodeSettings.repoPath)
                    .textFieldStyle(.roundedBorder)

                TextField("Compose File", text: $vm.nodeSettings.composeFile)
                    .textFieldStyle(.roundedBorder)

                TextField("Env File", text: $vm.nodeSettings.envFile)
                    .textFieldStyle(.roundedBorder)
            }

            Section("Runtime") {
                TextField("Base Data Dir (BASEDIR)", text: $vm.nodeSettings.baseDir)
                    .textFieldStyle(.roundedBorder)

                TextField("Profiles (CSV)", text: $vm.nodeSettings.profilesCSV)
                    .textFieldStyle(.roundedBorder)
            }

            Section("Bootstrap") {
                TextField("Backup URL", text: $vm.nodeSettings.backupUrl)
                    .textFieldStyle(.roundedBorder)
            }

            Section {
                HStack {
                    Button("Edit Config File") {
                        NotificationCenter.default.post(name: .openConfigEditor, object: nil)
                    }

                    Spacer()

                    Button("Reset to Defaults") {
                        vm.nodeSettings = .default
                    }
                }
            }
        }
        .padding(20)
    }
}

extension Notification.Name {
    static let openConfigEditor = Notification.Name("openConfigEditor")
}
