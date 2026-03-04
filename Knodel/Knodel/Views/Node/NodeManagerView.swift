import SwiftUI

struct NodeManagerView: View {
    @EnvironmentObject var vm: NodeManagerViewModel
    @EnvironmentObject var settingsVM: SettingsViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSection
                errorBanner
                serviceSection
                bootstrapSection
                outputSection
            }
            .padding(16)
        }
        .sheet(isPresented: $vm.showingLogs) {
            LogSheetView(service: vm.logsService, nodeVM: vm)
                .frame(minWidth: 700, minHeight: 500)
        }
    }

    private var headerSection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Local Koinos Node")
                    .font(.title2)
                    .fontWeight(.semibold)
                Text("Docker Compose orchestration. Requires Docker Desktop on macOS.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            StatusPillView(
                status: vm.errorMessage != nil ? .error : vm.runningCount > 0 ? .live : .idle,
                text: vm.statusText
            )

            Button("Refresh") {
                Task { await vm.refreshStatus() }
            }
            .disabled(vm.isLoading || vm.actionInProgress != nil)

            Button(vm.isCloning ? "Syncing..." : "Sync Repo") {
                Task { await vm.cloneRepo() }
            }
            .disabled(vm.isCloning || vm.actionInProgress != nil)

            Button(vm.actionInProgress == .start ? "Starting..." : "Start Node") {
                Task { await vm.startNode() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(vm.actionInProgress != nil || vm.isCloning)

            Button(vm.actionInProgress == .stop ? "Stopping..." : "Stop Node") {
                Task { await vm.stopNode() }
            }
            .buttonStyle(.bordered)
            .tint(.red)
            .disabled(vm.actionInProgress != nil || vm.isCloning)
        }
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = vm.errorMessage {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.yellow)
                Text(error)
                    .font(.callout)
                    .lineLimit(3)
                Spacer()
            }
            .padding(10)
            .background(.red.opacity(0.1))
            .cornerRadius(8)
        }
    }

    private var serviceSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Services")
                        .font(.headline)
                    Spacer()
                    Text("\(vm.services.count) detected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if vm.services.isEmpty {
                    Text(vm.isLoading ? "Querying services..." : "No services detected for this compose.")
                        .foregroundStyle(.secondary)
                        .font(.callout)
                        .padding(.vertical, 8)
                } else {
                    ServiceListView(services: vm.services) { service in
                        vm.openLogs(for: service)
                    }
                }
            }
            .padding(4)
        }
    }

    private var bootstrapSection: some View {
        GroupBox {
            BootstrapView()
                .environmentObject(settingsVM)
        }
    }

    @ViewBuilder
    private var outputSection: some View {
        if !vm.commandOutput.isEmpty {
            GroupBox {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Command Output")
                        .font(.headline)
                    ScrollView {
                        Text(vm.commandOutput)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 150)
                }
                .padding(4)
            }
        }
    }
}
