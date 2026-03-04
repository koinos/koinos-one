import SwiftUI

struct BootstrapView: View {
    @EnvironmentObject var settingsVM: SettingsViewModel
    @StateObject private var vm = BootstrapViewModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Bootstrap")
                .font(.headline)
            Text("Download a blockchain backup to speed up initial sync.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                TextField("Backup URL", text: $vm.backupUrl)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.caption, design: .monospaced))
                    .disabled(vm.bootstrapService.state.isActive)

                if vm.bootstrapService.state.isActive {
                    Button("Cancel") {
                        vm.cancel()
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                } else {
                    Button("Download") {
                        vm.startDownload(targetDir: settingsVM.nodeSettings.expandedBaseDir)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }

            statusView
        }
        .padding(4)
        .onAppear {
            vm.backupUrl = settingsVM.nodeSettings.backupUrl
        }
    }

    @ViewBuilder
    private var statusView: some View {
        switch vm.bootstrapService.state {
        case .idle:
            EmptyView()
        case .downloading(let progress):
            VStack(alignment: .leading, spacing: 4) {
                ProgressView(value: progress) {
                    Text("Downloading... \(Int(progress * 100))%")
                        .font(.caption)
                }
            }
        case .extracting:
            HStack(spacing: 6) {
                ProgressView()
                    .controlSize(.small)
                Text("Extracting backup...")
                    .font(.caption)
            }
        case .completed:
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Bootstrap completed successfully.")
                    .font(.caption)
            }
        case .failed(let message):
            HStack(spacing: 6) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.red)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }
}
